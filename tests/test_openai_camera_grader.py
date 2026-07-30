import json
import pathlib
import sys

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import openai_camera_grader as grader  # noqa: E402


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [{
                "message": {
                    "content": json.dumps(self.payload),
                },
            }],
        }


def _valid_payload(**updates):
    payload = {
        "status": "valid",
        "grade": "C",
        "visibility_midpoint_ft": 12,
        "confidence": 0.82,
        "pylon_4ft": "clear",
        "pylon_11ft": "visible",
        "pylon_14ft": "visible",
        "pylon_30ft": "not_visible",
        "water_color": "blue_green",
        "particle_level": "medium",
        "visual_justification": "The 14 ft pylon is visible but the 30 ft pylon is absent.",
    }
    payload.update(updates)
    return payload


def test_request_sends_reference_first_and_current_frame_second(tmp_path, monkeypatch):
    reference = tmp_path / "reference.png"
    current = tmp_path / "current.jpg"
    reference.write_bytes(b"reference-pixels")
    current.write_bytes(b"current-pixels")
    observed = {}

    def fake_post(url, **kwargs):
        observed["url"] = url
        observed.update(kwargs)
        return _Response(_valid_payload())

    monkeypatch.setattr(grader.requests, "post", fake_post)
    result = grader.grade_image_with_openai(
        current,
        reference,
        "test-key",
        attempts=1,
    )

    assert result["grade"] == "C"
    body = observed["json"]
    content = body["messages"][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert content[2]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "Do not use the date, weather, tides, swell" in content[0]["text"]
    assert body["response_format"]["json_schema"]["strict"] is True
    assert observed["headers"]["Authorization"] == "Bearer test-key"


def test_pylon_constraints_reject_inconsistent_high_grades():
    with pytest.raises(ValueError, match="invisible 30 ft"):
        grader.validate_openai_grade(_valid_payload(grade="B", visibility_midpoint_ft=20))

    with pytest.raises(ValueError, match="requires a clear 30 ft"):
        grader.validate_openai_grade(_valid_payload(
            grade="A",
            visibility_midpoint_ft=30,
            pylon_30ft="visible",
        ))


def test_unusable_frame_has_no_grade():
    result = grader.validate_openai_grade(_valid_payload(
        status="unusable",
        grade=None,
        visibility_midpoint_ft=None,
        confidence=0.95,
        pylon_4ft="not_visible",
        pylon_11ft="not_visible",
        pylon_14ft="not_visible",
        visual_justification="The frame is obscured by player chrome.",
    ))
    assert result["status"] == "unusable"
    assert result["grade"] is None


def test_missing_api_key_fails_before_network(tmp_path):
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        grader.grade_image_with_openai(
            tmp_path / "current.jpg",
            tmp_path / "reference.png",
            "",
        )
