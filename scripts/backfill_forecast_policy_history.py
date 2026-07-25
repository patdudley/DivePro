#!/usr/bin/env python3
"""Backfill immutable v3/v4 policy decisions from forecast_log.csv."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from build_location_forecasts import (  # noqa: E402
    grade_from_visibility,
    visibility_range_from_grade,
)
from forecast_display_policy import evaluate_display_policy, load_display_policy  # noqa: E402
from forecast_policy_audit import append_audit_record, make_audit_record  # noqa: E402


PACIFIC = ZoneInfo("America/Los_Angeles")
PROB_FIELDS = ("prob_F", "prob_D", "prob_C", "prob_B", "prob_A", "prob_Aplus")
GRADES = ("F", "D", "C", "B", "A", "A+")
SEGMENTS = ("day_0", "days_1_3", "days_4_9", "outside_0_9")


def _parse_run(row: dict) -> datetime:
    parsed = datetime.fromisoformat(row["forecast_run_ts_utc"].replace("Z", "+00:00"))
    return parsed.astimezone(PACIFIC)


def calendar_day_out(row: dict) -> int:
    return (date.fromisoformat(row["target_date"]) - _parse_run(row).date()).days


def day_out_segment(day_out: int) -> str:
    if day_out == 0:
        return "day_0"
    if 1 <= day_out <= 3:
        return "days_1_3"
    if 4 <= day_out <= 9:
        return "days_4_9"
    return "outside_0_9"


def canonical_run_timestamps(rows: list[dict]) -> tuple[set[str], list[str]]:
    by_issue_date: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        local = _parse_run(row)
        by_issue_date[local.date().isoformat()].add(row["forecast_run_ts_utc"])

    selected: set[str] = set()
    omitted: list[str] = []
    for issue_date, timestamps in sorted(by_issue_date.items()):
        runs = sorted(timestamps, key=lambda value: _parse_run({
            "forecast_run_ts_utc": value
        }))
        morning = [value for value in runs if 7 <= _parse_run({
            "forecast_run_ts_utc": value
        }).hour <= 9]
        before_ten = [value for value in runs if _parse_run({
            "forecast_run_ts_utc": value
        }).hour < 10]
        if morning:
            selected.add(morning[0])
        elif before_ten:
            selected.add(before_ten[-1])
        else:
            omitted.append(issue_date)
    return selected, omitted


def _policy_for_row(row: dict, active_policy: str) -> dict:
    probabilities = {
        grade: row[field]
        for grade, field in zip(GRADES, PROB_FIELDS)
    }
    return evaluate_display_policy(
        probabilities=probabilities,
        raw_expected_vis_ft=float(row["raw_expected_vis_ft"]),
        guarded_vis_ft=float(row["guarded_expected_vis_ft"]),
        guardrail_fired=str(row["guardrail_applied"]) == "1",
        active_policy=active_policy,
        grade_from_visibility=grade_from_visibility,
        visibility_range_from_grade=visibility_range_from_grade,
    )


def row_shape(rows: list[dict]) -> dict:
    issue_dates = {_parse_run(row).date().isoformat() for row in rows}
    issue_runs = {row["forecast_run_ts_utc"] for row in rows}
    target_dates = {row["target_date"] for row in rows}
    forecast_ids = [row["forecast_id"] for row in rows]
    rows_per_run = Counter(row["forecast_run_ts_utc"] for row in rows)
    day_outs = Counter(calendar_day_out(row) for row in rows)
    canonical, omitted = canonical_run_timestamps(rows)
    return {
        "total_rows": len(rows),
        "pacific_issue_dates": len(issue_dates),
        "issue_runs": len(issue_runs),
        "target_dates": len(target_dates),
        "forecast_ids": len(forecast_ids),
        "unique_forecast_ids": len(set(forecast_ids)),
        "duplicate_forecast_ids": len(forecast_ids) - len(set(forecast_ids)),
        "rows_per_issue_run": {
            str(count): occurrences
            for count, occurrences in sorted(Counter(rows_per_run.values()).items())
        },
        "calendar_day_out_distribution": {
            str(day_out): count for day_out, count in sorted(day_outs.items())
        },
        "canonical_runs": len(canonical),
        "canonical_rows": sum(
            1 for row in rows if row["forecast_run_ts_utc"] in canonical
        ),
        "omitted_issue_dates": omitted,
    }


def _view_report(rows: list[dict], active_policy: str) -> dict:
    v3 = Counter()
    v4 = Counter()
    changed_by_segment = Counter()
    rows_by_segment = Counter()
    changed_rows = []
    malformed_rows = []

    for row in rows:
        policy = _policy_for_row(row, active_policy)
        day_out = calendar_day_out(row)
        segment = day_out_segment(day_out)
        rows_by_segment[segment] += 1
        v3[policy["v3_grade"]] += 1
        v4[policy["v4_grade"]] += 1
        if policy["reason"] == "malformed_scores_fallback":
            malformed_rows.append({
                "forecast_id": row["forecast_id"],
                "forecast_run_ts_utc": row["forecast_run_ts_utc"],
                "target_date": row["target_date"],
                "day_out": day_out,
            })
        if policy["v3_grade"] != policy["v4_grade"]:
            changed_by_segment[segment] += 1
            changed_rows.append({
                "forecast_id": row["forecast_id"],
                "forecast_run_ts_utc": row["forecast_run_ts_utc"],
                "target_date": row["target_date"],
                "day_out": day_out,
                "v3_grade": policy["v3_grade"],
                "v4_grade": policy["v4_grade"],
                "reason": policy["reason"],
            })

    return {
        "rows": len(rows),
        "v3_distribution": {grade: v3[grade] for grade in GRADES},
        "v4_distribution": {grade: v4[grade] for grade in GRADES},
        "rows_by_day_out_segment": {
            segment: rows_by_segment[segment] for segment in SEGMENTS
        },
        "changed_rows_by_day_out_segment": {
            segment: changed_by_segment[segment] for segment in SEGMENTS
        },
        "changed_rows": changed_rows,
        "malformed_rows": malformed_rows,
    }


def build_report(rows: list[dict], active_policy: str) -> dict:
    canonical_runs, omitted = canonical_run_timestamps(rows)
    canonical_rows = [
        row for row in rows if row["forecast_run_ts_utc"] in canonical_runs
    ]
    return {
        "report_schema_version": 1,
        "policy_parameters": {
            "active_policy": active_policy,
            "bimodal_top1_ceiling": 0.45,
            "bimodal_min_class_gap": 2,
        },
        "shape": row_shape(rows),
        "canonical_headline": {
            "selection": (
                "first run from 07:00 through 09:59 Pacific; otherwise latest "
                "run before 10:00 Pacific"
            ),
            "omitted_issue_dates": omitted,
            **_view_report(canonical_rows, active_policy),
        },
        "all_call_diagnostic": {
            "independence_warning": (
                "Repeated intraday forecasts; rows are not independent samples."
            ),
            **_view_report(rows, active_policy),
        },
    }


def existing_forecast_ids(history_dir: Path) -> set[str]:
    identifiers: set[str] = set()
    for path in history_dir.glob("*.jsonl"):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    identifiers.add(str(json.loads(line)["forecast_id"]))
    return identifiers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--forecast-log", type=Path, default=ROOT / "forecast_log.csv")
    parser.add_argument(
        "--history-dir", type=Path, default=ROOT / "forecast-policy-history"
    )
    parser.add_argument(
        "--config", type=Path, default=ROOT / "forecast-config.json"
    )
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    with args.forecast_log.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    shape = row_shape(rows)
    print("PRE-WRITE SHAPE")
    print(json.dumps(shape, indent=2, sort_keys=True))
    if shape["duplicate_forecast_ids"]:
        raise ValueError("forecast_log.csv contains duplicate forecast_id values")

    active_policy = load_display_policy(args.config)
    report = build_report(rows, active_policy)
    if args.write:
        known_ids = existing_forecast_ids(args.history_dir)
        appended = 0
        for row in rows:
            if row["forecast_id"] in known_ids:
                continue
            policy = _policy_for_row(row, active_policy)
            record = make_audit_record(
                forecast_id=row["forecast_id"],
                forecast_run_ts_utc=row["forecast_run_ts_utc"],
                target_date=row["target_date"],
                lead_time_hours=int(float(row["lead_time_hours"])),
                policy=policy,
            )
            append_audit_record(args.history_dir, record)
            known_ids.add(row["forecast_id"])
            appended += 1
        report_path = args.history_dir / "backfill-report.json"
        report_path.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"APPENDED_RECORDS {appended}")
        print(f"REPORT_PATH {report_path}")
    print("BACKFILL REPORT")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
