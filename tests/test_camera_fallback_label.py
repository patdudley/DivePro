import json
import pathlib
import sys
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import scripps_camera as camera  # noqa: E402


def _success_status(observation_date, slot="08:00"):
    return {
        "schema_version": "1",
        "status": "grading_skipped",
        "capture_ok": True,
        "observation_date": observation_date,
        "slot": slot,
        "image_url": "https://example.com/scripps-pier.jpg?v=abc123",
        "image_sha256": "a" * 64,
    }


def _run_args(tmp_path, existing_status):
    return SimpleNamespace(
        force_slot="12:00",
        attempts=1,
        model="test-model",
        api_key="",
        public_image=str(tmp_path / "captured.jpg"),
        public_status=str(tmp_path / "public-status.json"),
        existing_status=str(existing_status),
        public_image_url="https://example.com/scripps-pier.jpg",
        forecast_json=str(tmp_path / "missing-forecast.json"),
        batch_output=str(tmp_path / "batch.json"),
    )


def _fail_capture(monkeypatch):
    def boom(output, attempts=3):
        raise RuntimeError("camera unreachable")

    monkeypatch.setattr(camera, "capture_feed", boom)


def test_capture_failure_preserves_same_day_success(tmp_path, monkeypatch):
    _fail_capture(monkeypatch)
    today = camera.utc_now().astimezone(camera.LOCAL_TZ).date().isoformat()
    existing = tmp_path / "existing-status.json"
    original_text = json.dumps(_success_status(today), indent=2, sort_keys=True) + "\n"
    existing.write_text(original_text)

    args = _run_args(tmp_path, existing)
    assert camera.run(args) == 0

    # Public status is byte-identical to the earlier success so the workflow
    # commit step is a no-op and the homepage keeps the valid morning photo.
    assert pathlib.Path(args.public_status).read_text() == original_text
    # The failure is still recorded for evaluation.
    batch = json.loads(pathlib.Path(args.batch_output).read_text())
    assert batch["camera_record"]["status"] == "capture_failure"


def test_capture_failure_overwrites_stale_or_failed_status(tmp_path, monkeypatch):
    _fail_capture(monkeypatch)
    today = camera.utc_now().astimezone(camera.LOCAL_TZ).date().isoformat()

    stale = tmp_path / "stale.json"
    stale.write_text(json.dumps(_success_status("2020-01-01")))
    args = _run_args(tmp_path, stale)
    assert camera.run(args) == 0
    written = json.loads(pathlib.Path(args.public_status).read_text())
    assert written["capture_ok"] is False
    assert written["status"] == "capture_failure"
    assert written["observation_date"] == today

    same_day_failure = tmp_path / "same-day-failure.json"
    failed = _success_status(today)
    failed["capture_ok"] = False
    failed["image_url"] = None
    same_day_failure.write_text(json.dumps(failed))
    args = _run_args(tmp_path, same_day_failure)
    assert camera.run(args) == 0
    written = json.loads(pathlib.Path(args.public_status).read_text())
    assert written["capture_ok"] is False
    assert written["status"] == "capture_failure"


def test_camera_workflow_chains_off_other_scheduled_workflows():
    workflow = (ROOT / ".github/workflows/scripps-camera-grade.yml").read_text()
    # Cron alone is throttled/dropped; completed sibling workflows are extra
    # trigger attempts and the slot gate keeps redundant triggers as no-ops.
    assert "workflow_run:" in workflow
    assert '"Camera snapshots"' in workflow
    assert '"Update La Jolla Forecast"' in workflow
    assert '"Update Wind Grid"' in workflow
    assert "types: [completed]" in workflow
    # The gate must keep routing non-dispatch events through the slot check.
    assert 'if [ "$EVENT_NAME" = "workflow_dispatch" ]' in workflow


def test_homepage_labels_reference_image_when_not_live():
    source = (ROOT / "app.js").read_text()
    styles = (ROOT / "styles.css").read_text()
    camera_block = source[source.index("function renderCamera"):source.index("function hourLabel")]

    # The fallback branch must surface a visible label instead of hiding the badge.
    assert "badge.hidden = true" not in camera_block
    assert "is-reference" in camera_block
    assert "live photo pending" in camera_block
    assert "Camera offline" in camera_block
    # Live captures must not carry the reference styling.
    assert 'badge.classList.remove("is-reference")' in camera_block
    # The load path distinguishes pending vs offline vs unavailable.
    assert "scrippsCameraFallbackReason" in source
    assert ".camera-observed-badge.is-reference" in styles
