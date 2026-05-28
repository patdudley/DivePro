#!/usr/bin/env python3
"""
Append-only prospective forecast logging helper for DivePro SD1.

Integration target:
    Import this from build_location_forecasts.py only after the runtime emits
    the same F/D/C/B/A/A+ probability vector that will be evaluated with RPS.

This helper deliberately logs forecasts only. Outcomes belong in the separate
observation table after the dive.
"""

from __future__ import annotations

import csv
import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path


FIELDS = [
    "forecast_id", "forecast_run_ts_utc", "target_date",
    "valid_window_start_local", "valid_window_end_local", "lead_time_hours",
    "model_version_hash", "feature_schema_version", "guardrail_version",
    "displayed_grade", "displayed_range_min_ft", "displayed_range_max_ft",
    "prob_F", "prob_D", "prob_C", "prob_B", "prob_A", "prob_Aplus",
    "raw_expected_vis_ft", "guardrail_applied", "guardrail_reason",
    "guarded_expected_vis_ft", "input_source_run_id",
    "in_p1_height_ft", "in_p1_period_s", "in_p1_direction_deg",
    "in_p2_height_ft", "in_p2_period_s", "in_p2_direction_deg",
    "in_windwave_height_ft", "in_windwave_period_s",
    "in_wind_max_mph", "in_gust_max_mph",
    "in_rain_target_day_forecast_in", "in_rain_prior_3day_in",
    "in_rain_prior_7day_in", "in_sst_f", "in_tide_range_ft",
    "in_wave_yesterday_ft", "input_source_notes", "fallback_flags",
]

PROB_FIELDS = ["prob_F", "prob_D", "prob_C", "prob_B", "prob_A", "prob_Aplus"]
REQUIRED = {
    "forecast_id", "forecast_run_ts_utc", "target_date",
    "valid_window_start_local", "valid_window_end_local", "lead_time_hours",
    "model_version_hash", "feature_schema_version", "guardrail_version",
    "displayed_grade", "displayed_range_min_ft", "displayed_range_max_ft",
    *PROB_FIELDS, "raw_expected_vis_ft", "guardrail_applied",
    "guarded_expected_vis_ft", "input_source_run_id",
}
ALLOWED_GRADES = {"F", "D", "C", "B", "A", "A+"}


def file_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def utc_timestamp_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _as_float(row: dict, key: str) -> float:
    try:
        value = float(row[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"`{key}` must be numeric") from exc
    if not math.isfinite(value):
        raise ValueError(f"`{key}` must be finite")
    return value


def validate_forecast_row(row: dict) -> dict:
    missing = sorted(k for k in REQUIRED if row.get(k) in (None, ""))
    if missing:
        raise ValueError(f"Missing required forecast log fields: {missing}")
    if row["displayed_grade"] not in ALLOWED_GRADES:
        raise ValueError(f"Invalid displayed_grade: {row['displayed_grade']}")
    probabilities = [_as_float(row, key) for key in PROB_FIELDS]
    if any(p < 0 or p > 1 for p in probabilities):
        raise ValueError("Grade probabilities must each be between 0 and 1")
    if abs(sum(probabilities) - 1.0) > 1e-6:
        raise ValueError(f"Grade probabilities must sum to 1.0, got {sum(probabilities):.8f}")
    run_ts = str(row["forecast_run_ts_utc"])
    if not (run_ts.endswith("Z") or "+00:00" in run_ts):
        raise ValueError("forecast_run_ts_utc must explicitly use UTC")
    if str(row["guardrail_applied"]) not in {"0", "1"} and row["guardrail_applied"] not in {0, 1, False, True}:
        raise ValueError("guardrail_applied must be 0 or 1")
    cleaned = {field: row.get(field, "") for field in FIELDS}
    return cleaned


def append_forecast_row(path: str | Path, row: dict) -> None:
    """Append a validated forecast record; reject duplicate immutable IDs."""
    output = Path(path)
    cleaned = validate_forecast_row(row)
    output.parent.mkdir(parents=True, exist_ok=True)
    exists = output.exists() and output.stat().st_size > 0
    if exists:
        with output.open(newline="", encoding="utf-8") as handle:
            for old in csv.DictReader(handle):
                if old.get("forecast_id") == str(cleaned["forecast_id"]):
                    raise ValueError(f"Duplicate forecast_id rejected: {cleaned['forecast_id']}")
    with output.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerow(cleaned)

