import csv
import json
import math
import pathlib
import sys

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from forecast_display_policy import evaluate_display_policy, load_display_policy
from forecast_policy_audit import append_audit_record, make_audit_record
import build_location_forecasts as blf


def normalized(values):
    total = sum(values)
    return [value / total for value in values]


def evaluate(
    values,
    *,
    guarded=12.0,
    guardrail=False,
    active="v4",
    raw_expected=12.0,
):
    return evaluate_display_policy(
        probabilities=values,
        raw_expected_vis_ft=raw_expected,
        guarded_vis_ft=guarded,
        guardrail_fired=guardrail,
        active_policy=active,
        grade_from_visibility=blf.grade_from_visibility,
        visibility_range_from_grade=blf.visibility_range_from_grade,
    )


def test_jul_23_bimodal_c_changes_to_d():
    result = evaluate(normalized([0, 0.4311, 0.1953, 0.3735, 0, 0]))
    assert result["v3_grade"] == "C"
    assert result["v4_grade"] == "D"
    assert result["reason"] == "c_to_mode_bimodal"
    assert result["is_bimodal"] is True
    assert result["confidence"] == "low"


def test_jul_24_bimodal_c_changes_to_d():
    result = evaluate(normalized([0.0478, 0.3441, 0.2784, 0.3296, 0, 0]))
    assert result["v3_grade"] == "C"
    assert result["v4_grade"] == "D"
    assert result["reason"] == "c_to_mode_bimodal"


def test_unimodal_c_stays_c():
    result = evaluate([0.02, 0.08, 0.70, 0.15, 0.04, 0.01])
    assert result["v4_grade"] == "C"
    assert result["reason"] == "v3_unchanged"
    assert result["is_bimodal"] is False


def test_adjacent_c_b_split_stays_c():
    result = evaluate([0, 0.14, 0.44, 0.42, 0, 0])
    assert result["top1_idx"] == 2
    assert result["top2_idx"] == 3
    assert result["class_gap"] == 1
    assert result["v4_grade"] == "C"


def test_top1_at_ceiling_is_not_bimodal():
    result = evaluate([0, 0.50, 0.10, 0.40, 0, 0])
    assert result["class_gap"] == 2
    assert result["is_bimodal"] is False
    assert result["v4_grade"] == "C"


def test_better_b_mode_is_blocked_by_c_guardrail_cap():
    result = evaluate(
        [0, 0.40, 0.16, 0.44, 0, 0],
        guarded=10.0,
        guardrail=True,
    )
    assert result["v3_grade"] == "C"
    assert result["v4_grade"] == "C"
    assert result["reason"] == "blocked_by_guardrail_cap"


def test_worse_d_mode_is_allowed_through_c_guardrail_cap():
    result = evaluate(
        [0, 0.44, 0.16, 0.40, 0, 0],
        guarded=10.0,
        guardrail=True,
    )
    assert result["v3_grade"] == "C"
    assert result["v4_grade"] == "D"
    assert result["reason"] == "c_to_mode_bimodal"


@pytest.mark.parametrize(
    "values",
    [
        [],
        [0, math.nan, 0.5, 0.5, 0, 0],
        [0, 0.3, 0.3, 0.3, 0],
        [0, 0.1, 0.1, 0.2, 0, 0],
    ],
)
def test_malformed_vectors_fall_back_to_v3_without_crashing(values):
    result = evaluate(values, guarded=12.3)
    assert result["display_grade"] == "C"
    assert result["v4_grade"] == "C"
    assert result["reason"] == "malformed_scores_fallback"
    assert result["raw_class_scores"] is None


def test_v3_active_publishes_v3_and_preserves_standard_confidence():
    result = evaluate(
        normalized([0, 0.4311, 0.1953, 0.3735, 0, 0]),
        active="v3",
    )
    assert result["v4_grade"] == "D"
    assert result["display_grade"] == "C"
    assert result["display_policy_version"] == "v3-guarded-expected-vis"


def test_config_defaults_to_v3_and_rejects_unknown_value(tmp_path):
    config = tmp_path / "forecast-config.json"
    config.write_text('{"schema_version":1}')
    assert load_display_policy(config) == "v3"
    config.write_text('{"display_policy":"v4"}')
    assert load_display_policy(config) == "v4"
    config.write_text('{"display_policy":"v5"}')
    with pytest.raises(ValueError, match="Invalid display_policy"):
        load_display_policy(config)


def test_last_70_logged_rows_are_identical_under_v3():
    with (ROOT / "forecast_log.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))[-70:]
    assert len(rows) == 70
    for row in rows:
        result = evaluate_display_policy(
            probabilities={
                "F": row["prob_F"],
                "D": row["prob_D"],
                "C": row["prob_C"],
                "B": row["prob_B"],
                "A": row["prob_A"],
                "A+": row["prob_Aplus"],
            },
            raw_expected_vis_ft=float(row["raw_expected_vis_ft"]),
            guarded_vis_ft=float(row["guarded_expected_vis_ft"]),
            guardrail_fired=row["guardrail_applied"] == "1",
            active_policy="v3",
            grade_from_visibility=blf.grade_from_visibility,
            visibility_range_from_grade=blf.visibility_range_from_grade,
        )
        assert result["display_grade"] == row["displayed_grade"]
        assert result["vis_range"] == [
            int(float(row["displayed_range_min_ft"])),
            int(float(row["displayed_range_max_ft"])),
        ]


def _audit_record(forecast_id, run_ts="2026-07-01T06:30:00Z"):
    policy = evaluate([0, 0.1, 0.7, 0.2, 0, 0], active="v3")
    return make_audit_record(
        forecast_id=forecast_id,
        forecast_run_ts_utc=run_ts,
        target_date="2026-07-01",
        lead_time_hours=6,
        policy=policy,
    )


def test_audit_routes_by_pacific_month_and_rejects_duplicate_uuid(tmp_path):
    record = _audit_record("fc-1")
    output = append_audit_record(tmp_path, record)
    assert output.name == "2026-06.jsonl"
    stored = json.loads(output.read_text())
    assert stored["forecast_id"] == "fc-1"
    with pytest.raises(ValueError, match="Duplicate forecast_id"):
        append_audit_record(tmp_path, record)
