#!/usr/bin/env python3
"""Append-only monthly audit storage for forecast display-policy decisions."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


PACIFIC = ZoneInfo("America/Los_Angeles")
AUDIT_SCHEMA_VERSION = 1


def _issue_month(forecast_run_ts_utc: str) -> str:
    parsed = datetime.fromisoformat(forecast_run_ts_utc.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("forecast_run_ts_utc must include a timezone")
    return parsed.astimezone(PACIFIC).strftime("%Y-%m")


def audit_path_for_run(history_dir: str | Path, forecast_run_ts_utc: str) -> Path:
    return Path(history_dir) / f"{_issue_month(forecast_run_ts_utc)}.jsonl"


def make_audit_record(
    *,
    forecast_id: str,
    forecast_run_ts_utc: str,
    target_date: str,
    lead_time_hours: int,
    policy: dict,
) -> dict:
    return {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "forecast_id": forecast_id,
        "forecast_run_ts_utc": forecast_run_ts_utc,
        "target_date": target_date,
        "lead_time_hours": lead_time_hours,
        "raw_class_scores": policy["raw_class_scores"],
        "raw_expected_vis_ft": policy["raw_expected_vis_ft"],
        "guarded_vis_ft": policy["guarded_vis_ft"],
        "v3_grade": policy["v3_grade"],
        "v4_grade": policy["v4_grade"],
        "top1_idx": policy["top1_idx"],
        "top1_p": policy["top1_p"],
        "top2_idx": policy["top2_idx"],
        "top2_p": policy["top2_p"],
        "class_gap": policy["class_gap"],
        "is_bimodal": policy["is_bimodal"],
        "guardrail_fired": policy["guardrail_fired"],
        "confidence": policy["confidence"],
        "active_policy": policy["active_policy"],
        "display_policy_version": policy["display_policy_version"],
        "reason": policy["reason"],
    }


def append_audit_record(history_dir: str | Path, record: dict) -> Path:
    """Append a record and reject an immutable UUID already present in history."""
    forecast_id = str(record.get("forecast_id") or "")
    if not forecast_id:
        raise ValueError("forecast_id is required")
    output = audit_path_for_run(history_dir, str(record["forecast_run_ts_utc"]))
    output.parent.mkdir(parents=True, exist_ok=True)
    for existing_path in sorted(output.parent.glob("*.jsonl")):
        with existing_path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                existing = json.loads(line)
                if existing.get("forecast_id") == forecast_id:
                    raise ValueError(f"Duplicate forecast_id rejected: {forecast_id}")
    with output.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    return output
