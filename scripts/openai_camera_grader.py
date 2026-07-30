#!/usr/bin/env python3
"""Grade a Scripps camera frame from calibrated pylon visibility."""

from __future__ import annotations

import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any

import requests

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4.1-mini-2025-04-14"
GRADER_VERSION = "openai-scripps-pylon-v1"
PROMPT_VERSION = "openai-scripps-pylon-reference-v1"
RUBRIC_VERSION = "scripps-pylon-distances-v1"
PYLON_STATES = {"not_visible", "faint", "visible", "clear"}
GRADE_ORDER = ("F", "D", "C", "B", "A", "A+")
GRADE_RANGES = {
    "F": (0, 4),
    "D": (5, 9),
    "C": (10, 14),
    "B": (15, 24),
    "A": (25, 35),
    "A+": (35, 40),
}

GRADE_PROMPT = """Grade the CURRENT Scripps Pier underwater camera image using pixels only.
The first image is an annotated REFERENCE showing fixed pylon distances. The second
image is the CURRENT frame to grade. Do not use the date, weather, tides, swell,
forecast, prior grade, filename, or water-condition metadata.

Use these fixed visual anchors:
- The nearest right pylon is about 4 ft from the camera.
- The middle-right/back pylon is about 11 ft away.
- The left pylon is about 14 ft away.
- The back-center pylon is about 30 ft away.

Canonical grades:
- F = 0-4 ft: even the nearest 4 ft pylon is not reliably resolved.
- D = 5-9 ft: the 4 ft pylon is resolved, but the 11/14 ft pylons are not reliable.
- C = 10-14 ft: the 14 ft left pylon is identifiable; the 30 ft pylon is not.
- B = 15-24 ft: the 30 ft back-center pylon is faint or partially identifiable.
- A = 25-35 ft: the 30 ft pylon is clearly resolved, comparable to the reference.
- A+ = 35-40 ft: exceptional clarity with clear detail beyond the 30 ft pylon.

Hard constraints:
- Seeing the 14 ft left pylon makes the grade at least C.
- Identifying the 30 ft back-center pylon makes the grade at least B.
- A requires the 30 ft pylon to be clear, not merely guessed from its expected position.
- A+ requires visible detail beyond the 30 ft anchor, not just a clear 30 ft pylon.
- If darkness, glare, player chrome, loading state, obstruction, or changed framing
  prevents a defensible comparison, return status=unusable and do not guess a grade.

Return only the requested JSON. Keep visual_justification to one short sentence
describing pylon visibility, water color, and suspended particles."""

RESPONSE_SCHEMA = {
    "name": "scripps_visibility_grade",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["valid", "unusable"]},
            "grade": {
                "anyOf": [
                    {"type": "string", "enum": list(GRADE_ORDER)},
                    {"type": "null"},
                ],
            },
            "visibility_midpoint_ft": {
                "anyOf": [{"type": "number"}, {"type": "null"}],
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "pylon_4ft": {"type": "string", "enum": sorted(PYLON_STATES)},
            "pylon_11ft": {"type": "string", "enum": sorted(PYLON_STATES)},
            "pylon_14ft": {"type": "string", "enum": sorted(PYLON_STATES)},
            "pylon_30ft": {"type": "string", "enum": sorted(PYLON_STATES)},
            "water_color": {
                "type": "string",
                "enum": ["clear_blue", "blue_green", "green", "brown", "unknown"],
            },
            "particle_level": {
                "type": "string",
                "enum": ["low", "medium", "high", "unknown"],
            },
            "visual_justification": {"type": "string"},
        },
        "required": [
            "status",
            "grade",
            "visibility_midpoint_ft",
            "confidence",
            "pylon_4ft",
            "pylon_11ft",
            "pylon_14ft",
            "pylon_30ft",
            "water_color",
            "particle_level",
            "visual_justification",
        ],
    },
}


def _data_url(path: Path) -> str:
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def validate_openai_grade(payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status")
    if status not in {"valid", "unusable"}:
        raise ValueError("grader status must be valid or unusable")
    confidence = float(payload.get("confidence"))
    if not 0 <= confidence <= 1:
        raise ValueError("grader confidence must be between 0 and 1")

    pylons = {
        key: str(payload.get(key) or "")
        for key in ("pylon_4ft", "pylon_11ft", "pylon_14ft", "pylon_30ft")
    }
    if any(value not in PYLON_STATES for value in pylons.values()):
        raise ValueError("grader returned an invalid pylon visibility state")

    common = {
        "confidence": round(confidence, 4),
        **pylons,
        "water_color": str(payload.get("water_color") or "unknown"),
        "particle_level": str(payload.get("particle_level") or "unknown"),
        "visual_justification": str(payload.get("visual_justification") or "").strip(),
    }
    if not common["visual_justification"]:
        raise ValueError("grader must provide a visual justification")
    if status == "unusable":
        if payload.get("grade") is not None or payload.get("visibility_midpoint_ft") is not None:
            raise ValueError("unusable frame must not include a grade or midpoint")
        return {
            "status": "unusable",
            "grade": None,
            "visibility_midpoint_ft": None,
            "visibility_range_ft": None,
            **common,
        }

    grade = str(payload.get("grade") or "").upper()
    if grade not in GRADE_ORDER:
        raise ValueError(f"invalid camera grade: {grade!r}")
    midpoint = float(payload.get("visibility_midpoint_ft"))
    low, high = GRADE_RANGES[grade]
    if not low <= midpoint <= high:
        raise ValueError(
            f"camera midpoint {midpoint} is outside grade {grade} range {low}-{high}"
        )
    if grade in {"C", "B", "A", "A+"} and pylons["pylon_14ft"] == "not_visible":
        raise ValueError(f"grade {grade} contradicts an invisible 14 ft pylon")
    if grade in {"B", "A", "A+"} and pylons["pylon_30ft"] == "not_visible":
        raise ValueError(f"grade {grade} contradicts an invisible 30 ft pylon")
    if grade in {"A", "A+"} and pylons["pylon_30ft"] != "clear":
        raise ValueError(f"grade {grade} requires a clear 30 ft pylon")
    return {
        "status": "valid",
        "grade": grade,
        "visibility_midpoint_ft": round(midpoint, 2),
        "visibility_range_ft": [low, high],
        **common,
    }


def grade_image_with_openai(
    image_path: Path,
    reference_path: Path,
    api_key: str,
    model: str = DEFAULT_MODEL,
    attempts: int = 3,
) -> dict[str, Any]:
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required")
    if not reference_path.is_file():
        raise FileNotFoundError(f"Scripps pylon reference not found: {reference_path}")

    request_body = {
        "model": model,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": GRADE_PROMPT},
                {
                    "type": "image_url",
                    "image_url": {"url": _data_url(reference_path), "detail": "high"},
                },
                {
                    "type": "image_url",
                    "image_url": {"url": _data_url(image_path), "detail": "high"},
                },
            ],
        }],
        "response_format": {
            "type": "json_schema",
            "json_schema": RESPONSE_SCHEMA,
        },
    }
    failures: list[str] = []
    for attempt in range(1, attempts + 1):
        try:
            response = requests.post(
                OPENAI_CHAT_COMPLETIONS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
                timeout=90,
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            if message.get("refusal"):
                raise RuntimeError(f"OpenAI grader refused: {message['refusal']}")
            content = message.get("content")
            if not isinstance(content, str):
                raise ValueError("OpenAI grader returned no JSON text")
            return validate_openai_grade(json.loads(content))
        except Exception as exc:  # noqa: BLE001
            failures.append(f"attempt {attempt}: {exc}")
            if attempt < attempts:
                time.sleep(attempt * 3)
    raise RuntimeError("; ".join(failures))
