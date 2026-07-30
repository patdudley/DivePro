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
        return {
            "width": 1920,
            "height": 1081,
            "source_freshness_verified": True,
            "live_edge_lag_seconds": 1.0,
            "frame_motion_score": 4.0,
            "source_timestamp_verified": True,
            "source_timestamp_age_seconds": 8.0,
        }

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
    assert written["source_freshness_verified"] is True
    assert written["live_edge_lag_seconds"] == 1.0
    assert written["frame_motion_score"] == 4.0
    assert written["slot"] == "10:00"
    assert written["image_url"].startswith("https://example.com/scripps-pier.jpg?v=")
    # Graded-slot completion survives the hourly overwrite (legacy inference).
    assert written["slots_completed"] == {"08:00": True}
    assert camera.slot_already_captured(pathlib.Path(args.public_status), today, "08:00")
    assert not camera.slot_already_captured(pathlib.Path(args.public_status), today, "12:00")


def test_display_refresh_records_openai_grade_without_changing_capture_status(
    tmp_path,
    monkeypatch,
):
    _fixed_utc(monkeypatch, 11)
    _capture_writes_frame(monkeypatch)
    existing = tmp_path / "existing.json"
    args = _refresh_args(tmp_path, existing)
    args.openai_api_key = "test-key"
    args.openai_model = "test-openai-model"
    args.reference_image = str(tmp_path / "reference.png")
    pathlib.Path(args.reference_image).write_bytes(b"reference")
    monkeypatch.setattr(camera, "grade_image_with_openai", lambda *args, **kwargs: {
        "status": "valid",
        "grade": "B",
        "visibility_midpoint_ft": 20,
        "visibility_range_ft": [15, 24],
        "confidence": 0.8,
        "pylon_4ft": "clear",
        "pylon_11ft": "clear",
        "pylon_14ft": "clear",
        "pylon_30ft": "faint",
        "water_color": "clear_blue",
        "particle_level": "low",
        "visual_justification": "The 30 ft pylon is faintly identifiable.",
    })

    assert camera.run_display_refresh(args) == 0
    written = json.loads(pathlib.Path(args.public_status).read_text())
    assert written["status"] == "display_refresh"
    assert written["grade_status"] == "graded"
    assert written["grade"] == "B"
    assert written["grader_provider"] == "openai"
    assert written["grader_model"] == "test-openai-model"


def test_display_refresh_grading_failure_does_not_block_screenshot(
    tmp_path,
    monkeypatch,
):
    _fixed_utc(monkeypatch, 11)
    _capture_writes_frame(monkeypatch)
    args = _refresh_args(tmp_path, tmp_path / "missing.json")
    args.openai_api_key = "test-key"
    monkeypatch.setattr(
        camera,
        "grade_image_with_openai",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("API down")),
    )

    assert camera.run_display_refresh(args) == 0
    written = json.loads(pathlib.Path(args.public_status).read_text())
    assert written["capture_ok"] is True
    assert written["status"] == "display_refresh"
    assert written["grade_status"] == "grading_failure"
    assert written["image_url"]


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


def test_display_refresh_failure_records_attempt_without_an_image(tmp_path, monkeypatch):
    _fixed_utc(monkeypatch, 10)

    def boom(output, attempts=3):
        raise RuntimeError("feed down")

    monkeypatch.setattr(camera, "capture_feed", boom)
    args = _refresh_args(tmp_path, tmp_path / "missing.json")
    assert camera.run_display_refresh(args) == 0
    status = json.loads(pathlib.Path(args.public_status).read_text())
    assert status["capture_ok"] is False
    assert status["status"] == "capture_failure"
    assert status["image_url"] is None
    assert status["source_freshness_verified"] is False


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


def test_hourly_workflow_grades_without_coupling_and_serializes_with_shadow_job():
    workflow = (ROOT / ".github/workflows/scripps-camera-hourly.yml").read_text()
    assert "--display-refresh" in workflow
    assert "group: scripps-camera-grade" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "secrets.OPENAI_API_KEY" in workflow
    assert "gpt-4.1-2025-04-14" in workflow
    assert "scripps-piling-distance-reference.png" in workflow
    # Hourly refresh must not run coupling or private eval collection.
    assert "--force-slot" not in workflow
    assert "--eval" not in workflow
    assert "Check out private evaluation repository" not in workflow
    assert "camera_display_policy.py" not in workflow
    # No workflow_run trigger: the hourly job must never join the chain loop.
    assert "workflow_run:" not in workflow
