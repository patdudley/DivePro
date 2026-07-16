#!/usr/bin/env python3
"""Capture the Scripps underwater feed, grade it, and emit auditable records."""

from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageStat

from camera_display_policy import (
    LEAD_WEIGHTS,
    MAX_PULL_FT,
    MAX_STEP_PER_DAY,
    MIN_CAMERA_CONFIDENCE,
    POLICY_VERSION,
    canonical_range,
    couple_forecasts,
)


ROOT = Path(__file__).resolve().parents[1]
LOCAL_TZ = ZoneInfo("America/Los_Angeles")
SCHEDULED_HOURS = {8: "08:00", 12: "12:00", 16: "16:00"}
SLOT_GRACE_HOURS = 2
CAMERA_PAGE_URL = "https://coollab.ucsd.edu/pierviz/"
CAMERA_IFRAME_SELECTOR = 'iframe[src*="scripps_pier-underwater"]'
PUBLIC_IMAGE = ROOT / "camera-snapshots" / "scripps-pier.jpg"
PUBLIC_STATUS = ROOT / "camera-snapshots" / "scripps-pier-latest.json"
DEFAULT_PUBLIC_IMAGE_URL = "https://github.com/patdudley/DivePro/releases/download/scripps-camera-latest/scripps-pier.jpg"
FORECAST_JSON = ROOT / "model_outputs" / "forecast_10day.json"
FORECAST_LOG = ROOT / "forecast_log.csv"
GRADER_VERSION = "scripps-piling-rubric-v1-reconstructed"
PROMPT_VERSION = "scripps-piling-rubric-v1-reconstructed"
DEFAULT_GRADER_MODEL = "claude-sonnet-4-20250514"


GRADE_PROMPT = """You grade underwater visibility at the Scripps Pier camera from this image only.
Do not infer from weather, swell, season, date, or any forecast. Use visible evidence:
- the nearest piling tier is approximately 4 ft away;
- the middle piling tier is approximately 11 ft away;
- the rear support/piling tier is approximately 14 ft away;
- the far structure is approximately 30 ft away;
- water color, suspended particles, piling edges, and structural clarity.

Grade bands are canonical: F=0-4 ft, D=5-9 ft, C=10-14 ft, B=15-24 ft,
A=25-34 ft, A+=35-45 ft. Do not use plus/minus modifiers except A+.
F means the nearest tier is barely identifiable. D means the nearest tier is
visible but the 11 ft tier is not reliably identifiable. C requires the 4 ft and
11 ft tiers to be independently visible, while the 14 ft tier is not clearly
resolved. B requires the 4, 11, and 14 ft tiers to be independently identifiable.
A requires clear structure around 25-34 ft. A+ is exceptional clarity beyond 35 ft.

If the image is black, frozen-looking, loading, obscured, mostly player chrome,
or does not show the underwater scene, return status=unusable.

Return JSON only with exactly these keys:
status (valid or unusable), grade, visibility_midpoint_ft, confidence,
nearest_tier_visible, middle_tier_visible, rear_tier_visible,
far_tier_visible, water_color (clear_blue, blue_green, green, brown, unknown),
particle_level (low, medium, high, unknown).
For unusable images, grade and visibility_midpoint_ft must be null and confidence
must describe confidence that the image is unusable."""


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def scheduled_slot(now: dt.datetime | None = None) -> tuple[str, dt.datetime] | None:
    """Return the newest slot whose grace window contains the current local time.

    GitHub Actions cron triggers are frequently delayed (or dropped and retried
    later), so requiring the exact slot hour silently skips captures. Each slot
    instead stays eligible for SLOT_GRACE_HOURS after it starts; the committed
    status file keeps reruns idempotent per (date, slot).
    """
    current = (now or utc_now()).astimezone(LOCAL_TZ)
    for hour in sorted(SCHEDULED_HOURS, reverse=True):
        if hour <= current.hour < hour + SLOT_GRACE_HOURS:
            return (SCHEDULED_HOURS[hour], current)
    return None


def slot_already_captured(status_path: Path, observation_date: str, slot: str) -> bool:
    try:
        status = json.loads(status_path.read_text())
    except (OSError, json.JSONDecodeError, TypeError):
        return False
    return (
        status.get("capture_ok") is True
        and status.get("observation_date") == observation_date
        and status.get("slot") == slot
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_feed_image(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        width, height = image.size
        if width < 640 or height < 360:
            raise ValueError(f"camera image is too small: {width}x{height}")
        ratio = width / height
        if abs(ratio - (16 / 9)) > 0.04:
            raise ValueError(f"camera image is not 16:9: {width}x{height}")
        grayscale = image.convert("L").resize((160, 90))
        stats = ImageStat.Stat(grayscale)
        mean = float(stats.mean[0])
        standard_deviation = float(stats.stddev[0])
        histogram = grayscale.histogram()
        pixel_count = sum(histogram)
        dark_fraction = sum(histogram[:8]) / pixel_count
        light_fraction = sum(histogram[248:]) / pixel_count
        if standard_deviation < 7 or dark_fraction > 0.94 or light_fraction > 0.94:
            raise ValueError("camera image is blank or visually unusable")
        return {
            "width": width,
            "height": height,
            "luminance_mean": round(mean, 3),
            "luminance_stddev": round(standard_deviation, 3),
            "dark_fraction": round(dark_fraction, 5),
            "light_fraction": round(light_fraction, 5),
        }


def capture_feed(output: Path, attempts: int = 3) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.stem}.capture{output.suffix}")
    failures: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        try:
            for attempt in range(1, attempts + 1):
                page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
                try:
                    page.goto(CAMERA_PAGE_URL, wait_until="domcontentloaded", timeout=90_000)
                    iframe = page.locator(CAMERA_IFRAME_SELECTOR).first
                    iframe.wait_for(state="visible", timeout=60_000)
                    iframe_handle = iframe.element_handle()
                    camera_frame = iframe_handle.content_frame() if iframe_handle else None
                    if camera_frame is None:
                        raise RuntimeError("UCSD camera iframe did not expose a content frame")
                    camera_frame.wait_for_selector("video", state="visible", timeout=60_000)
                    videos = camera_frame.locator("video")
                    best_index = max(
                        range(videos.count()),
                        key=lambda index: videos.nth(index).evaluate("el => el.videoWidth * el.videoHeight"),
                    )
                    video = videos.nth(best_index)
                    video.evaluate("el => { el.controls = false; el.muted = true; return el.play(); }")
                    camera_frame.wait_for_function(
                        "el => el.readyState >= 3 && el.videoWidth >= 640 && el.videoHeight >= 360",
                        arg=video.element_handle(),
                        timeout=45_000,
                    )
                    before = float(video.evaluate("el => el.currentTime"))
                    page.wait_for_timeout(2500)
                    after = float(video.evaluate("el => el.currentTime"))
                    if after - before < 0.75:
                        raise RuntimeError(f"video did not advance ({before:.2f}s to {after:.2f}s)")
                    video.screenshot(path=str(temp), type="jpeg", quality=90)
                    metrics = validate_feed_image(temp)
                    temp.replace(output)
                    return {
                        **metrics,
                        "video_time_before": round(before, 3),
                        "video_time_after": round(after, 3),
                        "capture_attempt": attempt,
                        "capture_source": CAMERA_PAGE_URL,
                        "capture_method": "playwright_ucsd_embedded_video_element_screenshot",
                    }
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"attempt {attempt}: {exc}")
                    temp.unlink(missing_ok=True)
                    if attempt < attempts:
                        time.sleep(attempt * 2)
                finally:
                    page.close()
        finally:
            browser.close()
    raise RuntimeError("; ".join(failures))


def _parse_json_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    payload = json.loads(stripped)
    if not isinstance(payload, dict):
        raise ValueError("grader response must be a JSON object")
    return payload


def validate_grade(payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status")
    if status not in {"valid", "unusable"}:
        raise ValueError("grader status must be valid or unusable")
    confidence = float(payload.get("confidence"))
    if not 0 <= confidence <= 1:
        raise ValueError("grader confidence must be between 0 and 1")
    if status == "unusable":
        return {
            "status": status,
            "grade": None,
            "visibility_midpoint_ft": None,
            "visibility_range_ft": None,
            "confidence": confidence,
            "nearest_tier_visible": bool(payload.get("nearest_tier_visible")),
            "middle_tier_visible": bool(payload.get("middle_tier_visible")),
            "rear_tier_visible": bool(payload.get("rear_tier_visible")),
            "far_tier_visible": bool(payload.get("far_tier_visible")),
            "water_color": str(payload.get("water_color") or "unknown"),
            "particle_level": str(payload.get("particle_level") or "unknown"),
        }
    grade = str(payload.get("grade") or "").strip().upper()
    if grade not in {"F", "D", "C", "B", "A", "A+"}:
        raise ValueError(f"invalid camera grade: {grade!r}")
    midpoint = float(payload.get("visibility_midpoint_ft"))
    low, high = canonical_range(grade)
    if not low <= midpoint <= high:
        raise ValueError(f"camera midpoint {midpoint} is outside grade {grade} range {low}-{high}")
    return {
        "status": status,
        "grade": grade,
        "visibility_midpoint_ft": round(midpoint, 2),
        "visibility_range_ft": [low, high],
        "confidence": confidence,
        "nearest_tier_visible": bool(payload.get("nearest_tier_visible")),
        "middle_tier_visible": bool(payload.get("middle_tier_visible")),
        "rear_tier_visible": bool(payload.get("rear_tier_visible")),
        "far_tier_visible": bool(payload.get("far_tier_visible")),
        "water_color": str(payload.get("water_color") or "unknown"),
        "particle_level": str(payload.get("particle_level") or "unknown"),
    }


def grade_image(image_path: Path, api_key: str, model: str, attempts: int = 3) -> dict[str, Any]:
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    request_body = {
        "model": model,
        "max_tokens": 700,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": encoded}},
                {"type": "text", "text": GRADE_PROMPT},
            ],
        }],
    }
    failures: list[str] = []
    for attempt in range(1, attempts + 1):
        try:
            response = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=request_body,
                timeout=90,
            )
            response.raise_for_status()
            data = response.json()
            text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
            return validate_grade(_parse_json_text(text))
        except Exception as exc:  # noqa: BLE001
            failures.append(f"attempt {attempt}: {exc}")
            if attempt < attempts:
                time.sleep(attempt * 3)
    raise RuntimeError("; ".join(failures))


def _latest_forecast_identity_by_date(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    rows: dict[str, dict[str, Any]] = {}
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            target = row.get("target_date")
            if not target:
                continue
            if target not in rows or row.get("forecast_run_ts_utc", "") > rows[target].get("forecast_run_ts_utc", ""):
                rows[target] = row
    return rows


def _camera_record(status: dict[str, Any], capture_metrics: dict[str, Any] | None) -> dict[str, Any]:
    identity = f"scripps|{status['observation_date']}|{status['slot']}"
    source_reference_hash = hashlib.sha256(identity.encode()).hexdigest()
    content_payload = {key: value for key, value in status.items() if key not in {"generated_at_utc"}}
    content_hash = hashlib.sha256(json.dumps(content_payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {
        "schema_version": "1",
        "record_type": "camera_observation",
        "observation_id": source_reference_hash,
        "source_reference_hash": source_reference_hash,
        "content_hash": content_hash,
        "observation_date": status["observation_date"],
        "captured_at_utc": status["captured_at_utc"],
        "captured_at_local": status["captured_at_local"],
        "slot": status["slot"],
        "status": status["status"],
        "grade": status.get("grade"),
        "visibility_range_ft": status.get("visibility_range_ft"),
        "visibility_midpoint_ft": status.get("visibility_midpoint_ft"),
        "confidence": status.get("confidence"),
        "image_sha256": status.get("image_sha256"),
        "grader_model": status.get("grader_model"),
        "grader_version": status.get("grader_version"),
        "prompt_version": status.get("prompt_version"),
        "rubric_version": status.get("rubric_version"),
        "nearest_tier_visible": status.get("nearest_tier_visible"),
        "middle_tier_visible": status.get("middle_tier_visible"),
        "rear_tier_visible": status.get("rear_tier_visible"),
        "far_tier_visible": status.get("far_tier_visible"),
        "water_color": status.get("water_color"),
        "particle_level": status.get("particle_level"),
        "capture_metrics": capture_metrics,
    }


def build_coupling_audit(forecasts: list[dict[str, Any]], status: dict[str, Any], capture_id: str) -> list[dict[str, Any]]:
    _, records = couple_forecasts(forecasts, status, status["observation_date"])
    if not records:
        anchor = dt.date.fromisoformat(status["observation_date"])
        disabled_reason = (
            "low_confidence"
            if status.get("status") == "valid" and float(status.get("confidence") or 0) < MIN_CAMERA_CONFIDENCE
            else str(status.get("status") or "missing")
        )
        for forecast in forecasts:
            lead_days = (dt.date.fromisoformat(str(forecast["date"])) - anchor).days
            if lead_days < 1:
                continue
            score = forecast.get("guarded_visibility_score_ft")
            records.append({
                "schema_version": "1",
                "record_type": "camera_coupling_audit",
                "display_policy_version": POLICY_VERSION,
                "target_date": forecast["date"],
                "lead_days": lead_days,
                "s_algo": score,
                "s_obs": status.get("visibility_midpoint_ft"),
                "camera_confidence": status.get("confidence"),
                "w_lead": LEAD_WEIGHTS.get(lead_days, 0.0),
                "effective_weight": 0.0,
                "pre_cap_blended_score": score,
                "pull_capped_score": score,
                "s_display": score,
                "raw_grade": forecast.get("grade"),
                "provisional_grade": forecast.get("grade"),
                "final_grade": forecast.get("grade"),
                "pull_cap_applied": False,
                "slew_override": False,
                "slew_exceeded_pull_cap": False,
                "coupling_disabled_reason": disabled_reason,
                "parameters": {
                    "minimum_camera_confidence": MIN_CAMERA_CONFIDENCE,
                    "maximum_pull_ft": MAX_PULL_FT,
                    "maximum_step_per_day": MAX_STEP_PER_DAY,
                    "lead_weights": {str(key): value for key, value in LEAD_WEIGHTS.items()},
                },
            })
    identities = _latest_forecast_identity_by_date(FORECAST_LOG)
    for record in records:
        identity = identities.get(record["target_date"], {})
        record.update({
            "capture_id": capture_id,
            "camera_image_sha256": status.get("image_sha256"),
            "forecast_id": identity.get("forecast_id"),
            "forecast_issue_time_utc": identity.get("forecast_run_ts_utc"),
            "forecast_lead_time_hours": int(identity["lead_time_hours"]) if identity.get("lead_time_hours") else None,
            "input_source_run_id": identity.get("input_source_run_id"),
        })
    return records


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def run(args: argparse.Namespace) -> int:
    now_utc = utc_now()
    local_now = now_utc.astimezone(LOCAL_TZ)
    scheduled = scheduled_slot(now_utc)
    slot = args.force_slot or (scheduled[0] if scheduled else None)
    if not slot:
        print(f"Not a scheduled Scripps slot: {local_now.isoformat()}")
        return 3
    observation_date = local_now.date().isoformat()
    if slot_already_captured(Path(args.existing_status), observation_date, slot):
        print(json.dumps({
            "status": "already_captured",
            "slot": slot,
            "observation_date": observation_date,
        }))
        return 0

    status: dict[str, Any] = {
        "schema_version": "1",
        "status": "capture_failure",
        "capture_ok": False,
        "observation_date": observation_date,
        "captured_at_utc": now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "captured_at_local": local_now.replace(microsecond=0).isoformat(),
        "slot": slot,
        "source_url": CAMERA_PAGE_URL,
        "image_url": None,
        "grade": None,
        "visibility_range_ft": None,
        "visibility_midpoint_ft": None,
        "confidence": None,
        "image_sha256": None,
        "grader_model": args.model,
        "grader_version": GRADER_VERSION,
        "prompt_version": PROMPT_VERSION,
        "rubric_version": GRADER_VERSION,
        "display_policy_version": POLICY_VERSION,
    }
    capture_metrics = None
    batch_path = Path(args.batch_output)
    try:
        capture_metrics = capture_feed(Path(args.public_image), attempts=args.attempts)
        image_hash = _sha256(Path(args.public_image))
        status["image_sha256"] = image_hash
        status["capture_ok"] = True
        separator = "&" if "?" in args.public_image_url else "?"
        captured_image_url = f"{args.public_image_url}{separator}v={image_hash[:12]}"
        # Screenshot publishing depends only on capture + local validation.
        # Grading can veto (unusable frame) but its absence never blocks publishing.
        if not args.api_key:
            status["status"] = "grading_skipped"
            status["image_url"] = captured_image_url
        else:
            try:
                grade = grade_image(Path(args.public_image), args.api_key, args.model, attempts=args.attempts)
                status.update(grade)
                status["image_url"] = None if grade["status"] == "unusable" else captured_image_url
            except Exception as exc:  # noqa: BLE001
                status["status"] = "grading_failure"
                status["failure_code"] = type(exc).__name__
                status["image_url"] = captured_image_url
                print(f"Grading failed: {exc}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        status["status"] = "capture_failure"
        status["failure_code"] = type(exc).__name__
        print(f"Capture failed: {exc}", file=sys.stderr)

    write_json(Path(args.public_status), status)
    forecasts = json.loads(Path(args.forecast_json).read_text()) if Path(args.forecast_json).exists() else []
    camera_record = _camera_record(status, capture_metrics)
    batch = {
        "schema_version": "1",
        "camera_record": camera_record,
        "coupling_records": build_coupling_audit(forecasts, status, camera_record["content_hash"]),
    }
    write_json(batch_path, batch)
    print(json.dumps({"status": status["status"], "slot": slot, "observation_date": status["observation_date"]}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-slot", action="store_true")
    parser.add_argument("--force-slot", choices=sorted(SCHEDULED_HOURS.values()))
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--model", default=os.environ.get("SCRIPPS_GRADER_MODEL") or DEFAULT_GRADER_MODEL)
    parser.add_argument("--api-key", default=os.environ.get("ANTHROPIC_API_KEY", ""))
    parser.add_argument("--public-image", default=str(PUBLIC_IMAGE))
    parser.add_argument("--public-status", default=str(PUBLIC_STATUS))
    parser.add_argument("--existing-status", default=str(PUBLIC_STATUS))
    parser.add_argument("--public-image-url", default=DEFAULT_PUBLIC_IMAGE_URL)
    parser.add_argument("--forecast-json", default=str(FORECAST_JSON))
    parser.add_argument("--batch-output", default=str(ROOT / "scripps-camera-batch.json"))
    args = parser.parse_args()
    if args.check_slot:
        result = scheduled_slot()
        if result:
            observation_date = result[1].date().isoformat()
            if slot_already_captured(Path(args.existing_status), observation_date, result[0]):
                print(f"already captured slot {result[0]} on {observation_date}")
                return 4
            print(f"scheduled slot {result[0]} at {result[1].isoformat()}")
            return 0
        print(f"not scheduled at {utc_now().astimezone(LOCAL_TZ).isoformat()}")
        return 3
    if not args.api_key:
        print(
            "WARNING: ANTHROPIC_API_KEY is not set; capturing and publishing "
            "without grading (status will be grading_skipped)",
            file=sys.stderr,
        )
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
