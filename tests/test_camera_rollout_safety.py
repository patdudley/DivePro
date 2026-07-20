import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import camera_production_preflight as preflight  # noqa: E402


def _write_reviews(root: Path, capture_count: int, date_count: int) -> None:
    path = root / "camera-human-reviews/la-jolla/2026/camera-human-reviews-2026-07.jsonl"
    path.parent.mkdir(parents=True)
    rows = []
    for index in range(capture_count):
        rows.append({
            "source_reference_hash": f"review-{index}",
            "camera_observation_id": f"camera-{index}",
            "observation_date": f"2026-07-{14 + index % max(date_count, 1):02d}",
            "reviewed_at_utc": f"2026-07-20T{index:02d}:00:00Z",
        })
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def _live_config(tmp_path: Path) -> Path:
    config = json.loads((ROOT / "camera-config.json").read_text())
    config["mode"] = "live"
    path = tmp_path / "camera-config.json"
    path.write_text(json.dumps(config))
    return path


def test_camera_rollout_defaults_to_screenshot_only_mode():
    config = json.loads((ROOT / "camera-config.json").read_text())
    assert config["mode"] == "off"
    assert config["publish_screenshots"] is True
    assert config["public_image_release_tag"] == "scripps-camera-latest"
    assert config["public_image_url"].endswith(
        "/releases/download/scripps-camera-latest/scripps-pier.jpg"
    )


def test_workflow_archives_camera_jpeg_and_decouples_publish_from_grading():
    workflow = (ROOT / ".github/workflows/scripps-camera-grade.yml").read_text()
    assert "git add camera-snapshots/scripps-pier.jpg" not in workflow
    assert "scripts/archive_scripps_capture.py" in workflow
    assert 'git add "${{ steps.archive.outputs.path }}"' in workflow
    assert 'gh release upload "$RELEASE_TAG" "$RUNNER_TEMP/scripps-pier.jpg" --clobber' in workflow
    assert "git add camera-snapshots/scripps-pier-latest.json" in workflow
    # Screenshot publishing is gated only by the publish flag, never by grading mode.
    assert workflow.count("steps.config.outputs.publish == 'true'") >= 3
    assert workflow.count("steps.config.outputs.mode == 'live'") == 1
    archive = workflow.index("Commit immutable capture archive")
    release = workflow.index("Replace public latest-image release asset")
    status = workflow.index("Commit public latest status")
    live_gate = workflow.index("Require reviewed shadow evidence before live grade coupling")
    assert archive < release < status < live_gate
    assert "continue-on-error: true" in workflow[release:status]
    assert "steps.archive.outputs.path != ''" in workflow[status:live_gate]
    assert "--require-live" in workflow[live_gate:]
    assert "--require-secrets" in workflow[live_gate:]
    assert "--eval-data-dir \"$EVAL_DATA_DIR\"" in workflow[live_gate:]
    # A publishable image requires a validated capture (image_url is null otherwise).
    assert '["image_url"]' in workflow[release:status]
    # Missing grading secrets fail loudly, but only after the publish steps.
    missing_secrets = workflow.index("Fail when shadow grading credentials are missing")
    assert status < missing_secrets


def test_workflow_retries_each_pst_and_pdt_slot_without_duplicate_publishing():
    workflow = (ROOT / ".github/workflows/scripps-camera-grade.yml").read_text()
    assert 'cron: "7,27,47 15-23 * * *"' in workflow
    assert 'cron: "7,27,47 0-2 * * *"' in workflow
    assert "id: capture" in workflow
    assert 'echo "produced=false" >> "$GITHUB_OUTPUT"' in workflow
    publish_gate = "steps.capture.outputs.produced == 'true'"
    assert workflow.count(publish_gate) >= 2
    assert "steps.archive.outputs.path != ''" in workflow


def test_frontend_displays_screenshot_without_automated_grade_coupling():
    source = (ROOT / "app.js").read_text()
    html = (ROOT / "index.html").read_text()
    # Display requires the publish flag plus a validated same-day capture.
    assert "config.publish_screenshots !== true" in source
    assert "observation.capture_ok === true" in source
    assert "observation.observation_date === localTodayInLaJolla()" in source
    # Grade coupling stays out until the shadow review gate is passed.
    assert "applyCameraDisplayPolicy" not in source
    assert "camera-display-policy.js" not in source
    assert 'observation.status === "manual_observation"' in source
    assert 'id="cameraObservedBadge"' in html


def test_scripps_latest_camera_images_are_ignored_but_archive_is_tracked():
    ignored = (ROOT / ".gitignore").read_text()
    assert "camera-snapshots/scripps-pier*.jpg" in ignored
    assert "camera-snapshots/scripps-pier*.jpeg" in ignored
    assert "camera-snapshots/scripps-pier*.png" in ignored

    tracked = subprocess.run(
        ["git", "ls-files", "camera-snapshots/scripps-pier*"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.splitlines()
    assert tracked == ["camera-snapshots/scripps-pier-latest.json"]

    assert "camera-snapshot-history/scripps-pier" not in ignored


def test_camera_note_matches_scheduled_cadence():
    source = (ROOT / "build_location_forecasts.py").read_text()
    assert '"camera_note": "Updated a few times daily from the Scripps Pier cam."' in source
    assert "Screenshot refreshes every few minutes" not in source


def test_preflight_passes_in_screenshot_only_mode_without_printing_secret_values():
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("EVAL_REPO_TOKEN", None)
    completed = subprocess.run(
        ["python3", "scripts/camera_production_preflight.py"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    assert payload["mode"] == "off"
    assert payload["safe_to_change_public_display"] is False
    assert payload["required_secrets_present"] == {
        "ANTHROPIC_API_KEY": False,
        "EVAL_REPO_TOKEN": False,
    }


@pytest.mark.parametrize(
    ("capture_count", "date_count"),
    [(8, 3), (9, 2)],
)
def test_require_live_fails_closed_below_review_threshold(
    tmp_path, monkeypatch, capture_count, date_count
):
    eval_dir = tmp_path / "evaluation-data"
    eval_dir.mkdir()
    _write_reviews(eval_dir, capture_count, date_count)
    monkeypatch.setattr(preflight, "CONFIG", _live_config(tmp_path))

    with pytest.raises(ValueError, match="shadow review threshold is not met"):
        preflight.run(require_live=True, eval_data_dir=eval_dir)


def test_require_live_passes_at_review_threshold(tmp_path, monkeypatch):
    eval_dir = tmp_path / "evaluation-data"
    eval_dir.mkdir()
    _write_reviews(eval_dir, 9, 3)
    monkeypatch.setattr(preflight, "CONFIG", _live_config(tmp_path))

    result = preflight.run(require_live=True, eval_data_dir=eval_dir)

    assert result["live_eligibility"] == {
        "reviewed_captures": 9,
        "reviewed_dates": 3,
        "eligible_for_live_mode": True,
    }
    assert result["safe_to_change_public_display"] is False


def test_live_eligibility_does_not_double_count_one_reviewed_capture(tmp_path):
    eval_dir = tmp_path / "evaluation-data"
    eval_dir.mkdir()
    _write_reviews(eval_dir, 9, 3)
    path = next(eval_dir.glob("camera-human-reviews/la-jolla/*/*.jsonl"))
    duplicate_review = {
        "source_reference_hash": "second-reviewer-same-capture",
        "camera_observation_id": "camera-0",
        "observation_date": "2026-07-14",
        "reviewed_at_utc": "2026-07-21T00:00:00Z",
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(duplicate_review) + "\n")

    result = preflight.compute_live_eligibility(eval_dir)

    assert result["reviewed_captures"] == 9
    assert result["reviewed_dates"] == 3
    assert result["eligible_for_live_mode"] is True


def test_require_live_fails_closed_without_evaluation_checkout(tmp_path, monkeypatch):
    monkeypatch.setattr(preflight, "CONFIG", _live_config(tmp_path))
    with pytest.raises(ValueError, match="requires the private evaluation-data checkout"):
        preflight.run(require_live=True)
