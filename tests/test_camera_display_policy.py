import copy
import datetime as dt
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import camera_display_policy as policy  # noqa: E402
import scripps_camera as camera  # noqa: E402
from ingest_camera_evaluation import ingest  # noqa: E402


def _forecast(day, grade, score):
    return {
        "date": day,
        "grade": grade,
        "estimated_visibility_range_ft": policy.canonical_range(grade),
        "estimated_visibility_mid_ft": score,
        "guarded_visibility_score_ft": score,
    }


def _observation(confidence=0.9, status="valid"):
    return {
        "status": status,
        "observation_date": "2026-07-14",
        "grade": "D" if status == "valid" else None,
        "visibility_midpoint_ft": 7.0 if status == "valid" else None,
        "visibility_range_ft": [5, 9] if status == "valid" else None,
        "confidence": confidence if status == "valid" else None,
        "image_sha256": "a" * 64,
    }


def test_camera_replaces_today_and_extreme_day_one_uses_slew_backstop():
    forecasts = [
        _forecast("2026-07-14", "C", 12),
        _forecast("2026-07-15", "A+", 40),
    ]
    display, audit = policy.couple_forecasts(forecasts, _observation(confidence=1.0), "2026-07-14")
    assert display[0]["grade"] == "D"
    assert display[0]["estimated_visibility_range_ft"] == [5, 9]
    assert display[1]["grade"] == "B"
    assert display[1]["estimated_visibility_mid_ft"] == 24
    assert audit[0]["slew_override"] is True
    assert audit[0]["slew_exceeded_pull_cap"] is True


def test_day_three_is_only_marginally_pulled_and_day_four_is_raw():
    forecasts = [
        _forecast("2026-07-14", "D", 7),
        _forecast("2026-07-15", "D", 7),
        _forecast("2026-07-16", "D", 7),
        _forecast("2026-07-17", "B", 20),
        _forecast("2026-07-18", "A", 28),
    ]
    display, audit = policy.couple_forecasts(forecasts, _observation(confidence=1.0), "2026-07-14")
    assert display[3]["estimated_visibility_mid_ft"] == pytest.approx(19.35)
    assert display[4]["grade"] == "A"
    assert display[4]["estimated_visibility_mid_ft"] == 28
    day_four = next(row for row in audit if row["lead_days"] == 4)
    assert day_four["effective_weight"] == 0
    assert day_four["s_display"] == day_four["s_algo"]


@pytest.mark.parametrize("observation", [_observation(confidence=0.64), _observation(status="unusable"), None])
def test_ineligible_camera_keeps_pure_algorithm_forecast(observation):
    forecasts = [_forecast("2026-07-14", "C", 12), _forecast("2026-07-15", "A", 28)]
    original = copy.deepcopy(forecasts)
    display, audit = policy.couple_forecasts(forecasts, observation, "2026-07-14")
    assert display == original
    assert forecasts == original
    assert audit == []


def test_pull_cap_is_applied_before_grade_slew():
    forecasts = [_forecast("2026-07-14", "D", 7), _forecast("2026-07-15", "A+", 40)]
    _, audit = policy.couple_forecasts(forecasts, _observation(confidence=1.0), "2026-07-14")
    row = audit[0]
    assert row["pre_cap_blended_score"] == pytest.approx(28.45)
    assert row["pull_capped_score"] == pytest.approx(35.0)
    assert row["pull_cap_applied"] is True


def test_out_of_vocab_algorithm_grade_does_not_break_later_coupling():
    unknown = [
        _forecast("2026-07-14", "D", 7),
        _forecast("2026-07-15", "C", None),
        _forecast("2026-07-16", "C", 12),
    ]
    unknown[1]["grade"] = "UNKNOWN"
    reference = copy.deepcopy(unknown)
    reference[1]["grade"] = "C"

    display, audit = policy.couple_forecasts(unknown, _observation(), "2026-07-14")
    expected_display, expected_audit = policy.couple_forecasts(
        reference, _observation(), "2026-07-14"
    )

    assert display[1]["grade"] == "UNKNOWN"
    assert display[2]["grade"] == expected_display[2]["grade"]
    assert display[2]["estimated_visibility_mid_ft"] == expected_display[2]["estimated_visibility_mid_ft"]
    assert audit[-1]["s_display"] == expected_audit[-1]["s_display"]
    assert policy._clamp_grade_step("UNKNOWN", "D", 2) == "UNKNOWN"
    assert policy._clamp_grade_step("C", "UNKNOWN", 2) == "C"


def test_low_confidence_capture_writes_disabled_coupling_audit():
    forecasts = [_forecast("2026-07-14", "C", 12), _forecast("2026-07-15", "A", 28)]
    status = _observation(confidence=0.64)
    records = camera.build_coupling_audit(forecasts, status, "capture-revision")
    assert len(records) == 1
    assert records[0]["effective_weight"] == 0
    assert records[0]["s_display"] == records[0]["s_algo"]
    assert records[0]["coupling_disabled_reason"] == "low_confidence"


@pytest.mark.parametrize(
    ("utc_time", "expected_slot"),
    [
        (dt.datetime(2026, 1, 15, 16, 7, tzinfo=dt.UTC), "08:00"),
        (dt.datetime(2026, 1, 15, 20, 52, tzinfo=dt.UTC), "12:00"),
        (dt.datetime(2026, 1, 16, 0, 37, tzinfo=dt.UTC), "16:00"),
        (dt.datetime(2026, 7, 15, 15, 7, tzinfo=dt.UTC), "08:00"),
        (dt.datetime(2026, 7, 15, 19, 52, tzinfo=dt.UTC), "12:00"),
        (dt.datetime(2026, 7, 15, 23, 37, tzinfo=dt.UTC), "16:00"),
    ],
)
def test_schedule_gate_handles_redundant_pst_and_pdt_hours(utc_time, expected_slot):
    result = camera.scheduled_slot(utc_time)
    assert result and result[0] == expected_slot


def test_schedule_gate_accepts_full_slot_hour_and_rejects_outside_window():
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 15, 0, tzinfo=dt.UTC))[0] == "08:00"
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 15, 59, tzinfo=dt.UTC))[0] == "08:00"
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 14, 59, tzinfo=dt.UTC)) is None


def test_schedule_gate_allows_delayed_cron_within_grace_window():
    # 16:38 UTC on 2026-07-16 is 9:38 AM PDT: a real delayed trigger that the
    # old exact-hour gate skipped, leaving the site on the fallback image.
    assert camera.scheduled_slot(dt.datetime(2026, 7, 16, 16, 38, tzinfo=dt.UTC))[0] == "08:00"
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 20, 59, tzinfo=dt.UTC))[0] == "12:00"
    assert camera.scheduled_slot(dt.datetime(2026, 7, 16, 0, 59, tzinfo=dt.UTC))[0] == "16:00"


def test_schedule_gate_rejects_times_past_grace_window():
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 17, 0, tzinfo=dt.UTC)) is None   # 10:00 AM PDT
    assert camera.scheduled_slot(dt.datetime(2026, 7, 15, 21, 30, tzinfo=dt.UTC)) is None  # 2:30 PM PDT
    assert camera.scheduled_slot(dt.datetime(2026, 7, 16, 1, 30, tzinfo=dt.UTC)) is None   # 6:30 PM PDT


def test_redundant_runs_capture_only_once_per_date_and_slot(tmp_path, monkeypatch):
    now = dt.datetime(2026, 7, 15, 23, 22, tzinfo=dt.UTC)
    monkeypatch.setattr(camera, "utc_now", lambda: now)
    monkeypatch.setattr(camera, "FORECAST_JSON", tmp_path / "missing-forecast.json")
    capture_calls = 0

    def fake_capture(path, attempts):
        nonlocal capture_calls
        capture_calls += 1
        Image.new("RGB", (1280, 720), (20, 90, 120)).save(path)
        return {"width": 1280, "height": 720, "motion_score": 12.0}

    monkeypatch.setattr(camera, "capture_feed", fake_capture)
    status_path = tmp_path / "scripps-pier-latest.json"
    args = SimpleNamespace(
        force_slot=None,
        existing_status=str(status_path),
        public_image=str(tmp_path / "scripps-pier.jpg"),
        public_status=str(status_path),
        public_image_url=camera.DEFAULT_PUBLIC_IMAGE_URL,
        forecast_json=str(tmp_path / "missing-forecast.json"),
        batch_output=str(tmp_path / "batch.json"),
        attempts=1,
        api_key="",
        model="test-model",
    )

    assert camera.run(args) == 0
    assert camera.run(args) == 0
    assert capture_calls == 1
    status = json.loads(status_path.read_text())
    assert status["capture_ok"] is True
    assert status["observation_date"] == "2026-07-15"
    assert status["slot"] == "16:00"


def test_grade_validation_rejects_bucket_mismatch_and_accepts_structured_result():
    valid = camera.validate_grade({
        "status": "valid", "grade": "C", "visibility_midpoint_ft": 12,
        "confidence": 0.83, "nearest_tier_visible": True,
        "middle_tier_visible": True, "rear_tier_visible": False,
        "far_tier_visible": False, "water_color": "green", "particle_level": "high",
    })
    assert valid["visibility_range_ft"] == [10, 14]
    with pytest.raises(ValueError, match="outside grade"):
        camera.validate_grade({**valid, "grade": "D", "visibility_midpoint_ft": 12})


def test_feed_image_validation_requires_real_16_by_9_pixels(tmp_path):
    image = Image.new("RGB", (1280, 720))
    for x in range(1280):
        color = (x % 255, (x * 3) % 255, (x * 7) % 255)
        for y in range(720):
            image.putpixel((x, y), color)
    path = tmp_path / "feed.jpg"
    image.save(path, quality=85)
    metrics = camera.validate_feed_image(path)
    assert metrics["width"] == 1280
    assert metrics["height"] == 720


def test_feed_image_validation_rejects_black_frame(tmp_path):
    path = tmp_path / "black.jpg"
    Image.new("RGB", (1280, 720), (0, 0, 0)).save(path)
    with pytest.raises(ValueError, match="blank or visually unusable"):
        camera.validate_feed_image(path)


def test_private_ingestion_is_append_only_and_idempotent(tmp_path):
    image = tmp_path / "camera.jpg"
    Image.new("RGB", (16, 9), (20, 80, 120)).save(image)
    image_hash = __import__("hashlib").sha256(image.read_bytes()).hexdigest()
    camera_record = {
        "schema_version": "1", "record_type": "camera_observation",
        "observation_id": "slot-id", "source_reference_hash": "slot-id",
        "content_hash": "content-id", "observation_date": "2026-07-14",
        "captured_at_utc": "2026-07-14T15:00:00Z",
        "captured_at_local": "2026-07-14T08:00:00-07:00", "slot": "08:00",
        "status": "valid", "grade": "C", "visibility_range_ft": [10, 14],
        "visibility_midpoint_ft": 12, "confidence": 0.8,
        "image_sha256": image_hash, "grader_model": "test",
        "grader_version": "test", "prompt_version": "test", "rubric_version": "test",
    }
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps({"camera_record": camera_record, "coupling_records": []}))
    assert ingest(tmp_path / "private", batch, image) == (1, 0)
    assert ingest(tmp_path / "private", batch, image) == (0, 1)

    corrected = dict(camera_record)
    corrected["content_hash"] = "corrected-content-id"
    corrected["confidence"] = 0.85
    batch.write_text(json.dumps({"camera_record": corrected, "coupling_records": []}))
    assert ingest(tmp_path / "private", batch, image) == (1, 0)
    records_path = tmp_path / "private/camera-observations/la-jolla/2026/camera-observations-2026-07.jsonl"
    records = [json.loads(line) for line in records_path.read_text().splitlines()]
    assert len(records) == 2
    assert records[1]["supersedes_observation_id"] == records[0]["observation_id"]


def test_camera_grade_contract_accepts_only_image_and_grader_configuration():
    names = tuple(camera.grade_image.__annotations__)
    assert "forecast" not in names
    assert "weather" not in names
    assert camera.GRADE_PROMPT.lower().count("weather") == 1  # only the explicit prohibition


def test_capture_opens_ucsd_camera_page_instead_of_direct_vendor_embed():
    source = (ROOT / "scripts/scripps_camera.py").read_text()
    assert camera.CAMERA_PAGE_URL == "https://coollab.ucsd.edu/pierviz/"
    assert "page.goto(CAMERA_PAGE_URL" in source
    assert "CAMERA_EMBED_URL" not in source
    assert "portal.hdontap.com" not in source
