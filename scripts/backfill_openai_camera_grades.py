#!/usr/bin/env python3
"""Grade every archived Scripps frame and emit resumable dashboard inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from openai_camera_grader import (
    DEFAULT_MODEL,
    GRADER_VERSION,
    PROMPT_VERSION,
    RUBRIC_VERSION,
    grade_image_with_openai,
)


PACIFIC = ZoneInfo("America/Los_Angeles")
CAPTURE_NAME = re.compile(r"^scripps-pier-(\d{6})-[a-f0-9]{12}\.(?:jpe?g|png)$", re.I)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _write_outputs(output_dir: Path, captures: list[dict], grades: dict[str, dict]) -> None:
    _write_json(output_dir / "index.json", {
        "schema_version": "2",
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "captures": captures,
    })
    _write_json(output_dir / "grades.json", {
        "schema_version": "2",
        "rubric_version": RUBRIC_VERSION,
        "prompt_version": PROMPT_VERSION,
        "grader_version": GRADER_VERSION,
        "method": "OpenAI image-only grading against fixed Scripps pylon references.",
        "grades": grades,
    })
    records_path = output_dir / "grade-records.jsonl"
    records_path.write_text(
        "".join(
            json.dumps({"image_sha256": image_hash, **record}, sort_keys=True) + "\n"
            for image_hash, record in sorted(grades.items())
        )
    )


def capture_record(path: Path, archive_root: Path) -> dict:
    relative = path.relative_to(archive_root.parent.parent).as_posix()
    image_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    observation_date = path.parent.name
    captured_at_utc = None
    captured_at_local = None
    slot = None
    match = CAPTURE_NAME.match(path.name)
    if match:
        captured = datetime.strptime(
            f"{observation_date} {match.group(1)}", "%Y-%m-%d %H%M%S"
        ).replace(tzinfo=timezone.utc)
        local = captured.astimezone(PACIFIC)
        captured_at_utc = captured.isoformat().replace("+00:00", "Z")
        captured_at_local = local.isoformat()
        slot = local.strftime("%H:00")
    return {
        "capture_state": "valid",
        "captured_at_local": captured_at_local,
        "captured_at_utc": captured_at_utc,
        "image_path": relative,
        "image_sha256": image_hash,
        "observation_date": observation_date,
        "slot": slot,
        "status": "openai_archive_backfill",
    }


def run(
    archive_root: Path,
    reference_path: Path,
    output_dir: Path,
    api_key: str,
    model: str = DEFAULT_MODEL,
) -> tuple[list[dict], dict[str, dict]]:
    images = sorted(
        path for path in archive_root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    captures = [capture_record(path, archive_root) for path in images]
    existing_path = output_dir / "grades.json"
    grades = {}
    if existing_path.exists():
        grades = json.loads(existing_path.read_text()).get("grades") or {}

    path_by_hash = {item["image_sha256"]: archive_root.parent.parent / item["image_path"] for item in captures}
    _write_outputs(output_dir, captures, grades)
    for index, (image_hash, image_path) in enumerate(path_by_hash.items(), start=1):
        if image_hash in grades and grades[image_hash].get("status") in {"valid", "unusable"}:
            print(f"[{index}/{len(path_by_hash)}] cached {image_path}")
            continue
        print(f"[{index}/{len(path_by_hash)}] grading {image_path}", flush=True)
        try:
            result = grade_image_with_openai(image_path, reference_path, api_key, model)
            grades[image_hash] = {
                **result,
                "grader_provider": "openai",
                "grader_model": model,
                "grader_version": GRADER_VERSION,
                "prompt_version": PROMPT_VERSION,
                "rubric_version": RUBRIC_VERSION,
                "graded_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        except Exception as exc:  # noqa: BLE001
            grades[image_hash] = {
                "status": "grading_error",
                "error": str(exc),
                "grader_provider": "openai",
                "grader_model": model,
                "grader_version": GRADER_VERSION,
                "prompt_version": PROMPT_VERSION,
                "rubric_version": RUBRIC_VERSION,
                "graded_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        _write_outputs(output_dir, captures, grades)
    return captures, grades


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-root", type=Path, default=Path("camera-snapshot-history/scripps-pier"))
    parser.add_argument(
        "--reference-image",
        type=Path,
        default=Path("camera-reference/scripps-piling-distance-reference.png"),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()
    captures, grades = run(
        args.archive_root,
        args.reference_image,
        args.output_dir,
        os.environ.get("OPENAI_API_KEY", ""),
        args.model,
    )
    counts: dict[str, int] = {}
    for record in grades.values():
        key = str(record.get("status") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    print(json.dumps({"captures": len(captures), "unique_images": len(grades), "statuses": counts}, sort_keys=True))
    return 1 if counts.get("grading_error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
