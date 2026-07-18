import hashlib
import json
import pathlib
import sys

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from archive_scripps_capture import archive_capture  # noqa: E402


def _status(image: bytes, **updates):
    payload = {
        "capture_ok": True,
        "observation_date": "2026-07-18",
        "captured_at_utc": "2026-07-18T19:09:57Z",
        "image_sha256": hashlib.sha256(image).hexdigest(),
    }
    payload.update(updates)
    return payload


def test_archives_with_timestamp_and_hash_without_overwriting(tmp_path):
    image_bytes = b"validated-camera-jpeg"
    image = tmp_path / "frame.jpg"
    image.write_bytes(image_bytes)
    status = tmp_path / "status.json"
    status.write_text(json.dumps(_status(image_bytes)))

    archived = archive_capture(image, status, tmp_path / "history")

    assert archived.relative_to(tmp_path).as_posix() == (
        "history/2026-07-18/scripps-pier-190957-"
        f"{hashlib.sha256(image_bytes).hexdigest()[:12]}.jpg"
    )
    assert archived.read_bytes() == image_bytes
    assert archive_capture(image, status, tmp_path / "history") == archived


def test_rejects_failed_or_hash_mismatched_capture(tmp_path):
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"frame")
    status = tmp_path / "status.json"
    status.write_text(json.dumps(_status(b"other")))
    with pytest.raises(ValueError, match="hash"):
        archive_capture(image, status, tmp_path / "history")

    status.write_text(json.dumps(_status(b"frame", capture_ok=False)))
    with pytest.raises(ValueError, match="capture_ok"):
        archive_capture(image, status, tmp_path / "history")
