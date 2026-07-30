import json
import pathlib
import sys

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from publish_scripps_status import publish_statuses  # noqa: E402


def _write(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _valid_status():
    return {
        "capture_ok": True,
        "captured_at_local": "2026-07-30T08:07:00-07:00",
        "image_url": (
            "/camera-snapshot-history/scripps-pier/2026-07-30/"
            "scripps-pier-150700-abc123.jpg?v=abc123"
        ),
        "observation_date": "2026-07-30",
        "source_freshness_verified": True,
        "status": "display_refresh",
    }


def test_failed_attempt_cannot_replace_last_valid_or_legacy_pointer(tmp_path):
    attempt = tmp_path / "attempt-input.json"
    attempt_destination = tmp_path / "latest-attempt.json"
    last_valid = tmp_path / "last-valid.json"
    legacy = tmp_path / "latest.json"
    existing = _valid_status()
    _write(last_valid, existing)
    _write(legacy, existing)
    last_valid_before = last_valid.read_bytes()
    legacy_before = legacy.read_bytes()
    _write(attempt, {
        "capture_ok": False,
        "image_url": None,
        "observation_date": "2026-07-30",
        "source_freshness_verified": False,
        "status": "capture_failure",
    })

    result = publish_statuses(
        attempt,
        attempt_destination,
        last_valid,
        legacy_destination=legacy,
    )

    assert result == {"attempt_updated": True, "last_valid_updated": False}
    assert json.loads(attempt_destination.read_text())["status"] == "capture_failure"
    assert last_valid.read_bytes() == last_valid_before
    assert legacy.read_bytes() == legacy_before


def test_valid_archived_capture_updates_both_display_pointers(tmp_path):
    attempt = tmp_path / "attempt-input.json"
    attempt_destination = tmp_path / "latest-attempt.json"
    last_valid = tmp_path / "last-valid.json"
    legacy = tmp_path / "latest.json"
    archive = tmp_path / "archive.jpg"
    archive.write_bytes(b"verified frame")
    status = _valid_status()
    _write(attempt, status)

    result = publish_statuses(
        attempt,
        attempt_destination,
        last_valid,
        archive_path=archive,
        legacy_destination=legacy,
    )

    assert result == {"attempt_updated": True, "last_valid_updated": True}
    assert json.loads(attempt_destination.read_text()) == status
    assert json.loads(last_valid.read_text()) == status
    assert json.loads(legacy.read_text()) == status


@pytest.mark.parametrize(
    "updates",
    [
        {"capture_ok": False},
        {"source_freshness_verified": False},
        {"image_url": None},
    ],
)
def test_invalid_capture_cannot_be_promoted(tmp_path, updates):
    attempt = tmp_path / "attempt-input.json"
    status = _valid_status()
    status.update(updates)
    _write(attempt, status)
    archive = tmp_path / "archive.jpg"
    archive.write_bytes(b"frame")

    with pytest.raises(ValueError, match="cannot promote"):
        publish_statuses(
            attempt,
            tmp_path / "latest-attempt.json",
            tmp_path / "last-valid.json",
            archive_path=archive,
        )
