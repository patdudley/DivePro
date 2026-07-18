import datetime as dt
import json
import pathlib
import sys
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import scripps_camera as camera  # noqa: E402


def _fixed_utc(monkeypatch, local_hour, minute=5):
    # Build a UTC instant whose America/Los_Angeles hour equals local_hour.
    base = dt.datetime(2026, 7, 18, 12, minute, tzinfo=dt.timezone.utc)
    local = base.astimezone(camera.LOCAL_TZ)
    delta = local_hour - local.hour
    fixed = base + dt.timedelta(hours=delta)
    monkeypatch.setattr(camera, "utc_now", lambda: fixed)
    return fixed.astimezone(camera.LOCAL_TZ)


def _capture_writes_frame(monkeypatch, payload=b"jpegbytes-fresh"):
    def fake_capture(output, attempts=3):
        pathlib.Path(output).write_bytes(payload)
        return {"width": 1920, "height": 1081}

    monkeypatch.setattr(camera, "capture_feed", fake_capture)


def _refresh_args(tmp_path, existing):
    return SimpleNamespace(
        attempts=1,
        model="test-model",
        public_image=str(tmp_path / "frame.jpg"),
        public_status=str(tmp_path / "out-status.json"),
        existing_status=str(existing),
        public_image_url="https://example.com/scripps-pier.jpg",
    )


def _graded_status(date, slot="08:00", extra=None):
    status = {
        "capture_ok": True,
        "observation_date": date,
        "slot": slot,
        "image_url": "https://example.com/scripps-pier.jpg?v=aaa",
        "captured_at_local": f"{date}T08:07:00-07:00",
    }
    status.update(extra or {})
    return status


def test_display_refresh_publishes_frame_and_carries_slot_map(tmp_path, monkeypatch):
    local = _fixed_utc(monkeypatch, 10)
    _capture_writes_frame(monkeypatch)
    today = local.date().isoformat()
    existing = tmp_path / "existing.json"
    existing.write_text(json.dumps(_graded_status(today)))

    args = _refresh_args(tmp_path, existing)
    assert camera.run_display_refresh(args) == 0
    written = json.loads(pathlib.Path(args.public_status).read_text())
    assert written["status"] == "display_refresh"
    assert written["capture_ok"] is True
    assert written["slot"] == "10:00"
    assert written["image_url"].startswith("https://example.com/scripps-pier.jpg?v=")
    # Graded-slot completion survives the hourly overwrite (legacy inference).
    assert written["slots_completed"] == {"08:00": True}
    assert camera.slot_already_captured(pathlib.Path(args.public_status), today, "08:00")
    assert not camera.slot_already_captured(pathlib.Path(args.public_status), today, "12:00")


def test_display_refresh_skips_outside_daylight_and_same_hour(tmp_path, monkeypatch):
    _capture_writes_frame(monkeypatch)
    # Outside daylight window: nothing produced.
    _fixed_utc(monkeypatch, 22)
    args = _refresh_args(tmp_path, tmp_path / "missing.json")
    assert camera.run_display_refresh(args) == 0
    assert not pathlib.Path(args.public_status).exists()

    # Fresh capture already published this hour: nothing produced.
    local = _fixed_utc(monkeypatch, 10, minute=40)
    today = local.date().isoformat()
    existing = tmp_path / "hourly.json"
    existing.write_text(json.dumps({
        "capture_ok": True,
        "observation_date": today,
        "slot": "10:00",
        "image_url": "https://example.com/x.jpg?v=bbb",
        "captured_at_local": local.replace(minute=2).isoformat(),
    }))
    args = _refresh_args(tmp_path, existing)
    assert camera.run_display_refresh(args) == 0
    assert not pathlib.Path(args.public_status).exists()


def test_display_refresh_failure_produces_nothing(tmp_path, monkeypatch):
    _fixed_utc(monkeypatch, 10)

    def boom(output, attempts=3):
        raise RuntimeError("feed down")

    monkeypatch.setattr(camera, "capture_feed", boom)
    args = _refresh_args(tmp_path, tmp_path / "missing.json")
    assert camera.run_display_refresh(args) == 0
    assert not pathlib.Path(args.public_status).exists()


def test_completed_slots_reads_map_and_legacy_and_ignores_hourly_slots(tmp_path):
    today = "2026-07-18"
    path = tmp_path / "status.json"
    # Hourly status with map: map wins, hourly slot label never counts.
    path.write_text(json.dumps({
        "capture_ok": True,
        "observation_date": today,
        "slot": "13:00",
        "slots_completed": {"08:00": True, "12:00": True, "13:00": True},
    }))
    assert camera.completed_slots(path, today) == {"08:00": True, "12:00": True}
    # Wrong day: empty.
    assert camera.completed_slots(path, "2026-07-17") == {}
    # Legacy graded status without map: inferred.
    path.write_text(json.dumps(_graded_status(today, slot="12:00")))
    assert camera.completed_slots(path, today) == {"12:00": True}


def test_hourly_workflow_never_marks_slots_and_serializes_with_graded():
    workflow = (ROOT / ".github/workflows/scripps-camera-hourly.yml").read_text()
    assert "--display-refresh" in workflow
    assert "group: scripps-camera-grade" in workflow
    assert "cancel-in-progress: false" in workflow
    # Hourly refresh must not run the graded pipeline or eval collection.
    assert "--force-slot" not in workflow
    assert "--eval" not in workflow
    assert "Check out private evaluation repository" not in workflow
    # No workflow_run trigger: the hourly job must never join the chain loop.
    assert "workflow_run:" not in workflow
