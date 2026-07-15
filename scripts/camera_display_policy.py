#!/usr/bin/env python3
"""Pure display-only coupling between a camera observation and raw forecasts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any


POLICY_VERSION = "camera-coupling-v1"
MIN_CAMERA_CONFIDENCE = 0.65
MAX_PULL_FT = 5.0
MAX_STEP_PER_DAY = 2
LEAD_WEIGHTS = {1: 0.35, 2: 0.15, 3: 0.05}
GRADE_ORDER = ("F", "D", "C", "B", "A", "A+")
GRADE_RANGES = {
    "F": (0.0, 4.0),
    "D": (5.0, 9.0),
    "C": (10.0, 14.0),
    "B": (15.0, 24.0),
    "A": (25.0, 34.0),
    "A+": (35.0, 45.0),
}


@dataclass(frozen=True)
class PolicyParameters:
    minimum_camera_confidence: float = MIN_CAMERA_CONFIDENCE
    maximum_pull_ft: float = MAX_PULL_FT
    maximum_step_per_day: int = MAX_STEP_PER_DAY


def grade_from_visibility(score_ft: float) -> str:
    if score_ft < 5:
        return "F"
    if score_ft < 10:
        return "D"
    if score_ft < 15:
        return "C"
    if score_ft < 25:
        return "B"
    if score_ft < 35:
        return "A"
    return "A+"


def canonical_range(grade: str) -> list[int]:
    lo, hi = GRADE_RANGES.get(grade, GRADE_RANGES["F"])
    return [int(lo), int(hi)]


def _nearest_score_in_grade(score_ft: float, grade: str) -> float:
    lo, hi = GRADE_RANGES[grade]
    return min(max(score_ft, lo), hi)


def _clamp_grade_step(grade: str, previous_grade: str, max_step: int) -> str:
    if grade not in GRADE_ORDER or previous_grade not in GRADE_ORDER:
        return grade
    current_index = GRADE_ORDER.index(grade)
    previous_index = GRADE_ORDER.index(previous_grade)
    bounded_index = min(max(current_index, previous_index - max_step), previous_index + max_step)
    return GRADE_ORDER[bounded_index]


def camera_is_eligible(observation: dict[str, Any] | None, local_date: str, params: PolicyParameters = PolicyParameters()) -> bool:
    if not observation:
        return False
    try:
        confidence = float(observation.get("confidence"))
    except (TypeError, ValueError):
        return False
    return (
        observation.get("status") == "valid"
        and observation.get("observation_date") == local_date
        and confidence >= params.minimum_camera_confidence
        and observation.get("grade") in GRADE_ORDER
        and observation.get("visibility_midpoint_ft") is not None
    )


def couple_forecasts(
    forecasts: list[dict[str, Any]],
    observation: dict[str, Any] | None,
    local_date: str,
    params: PolicyParameters = PolicyParameters(),
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return display copies and reconstructable audit records.

    Forecast objects are never mutated. The first/current day is replaced by a
    valid same-day camera observation. Future forecasts retain their immutable
    algorithm fields under ``algorithm_*`` keys before any display transform.
    """
    copied = [dict(row) for row in forecasts]
    if not camera_is_eligible(observation, local_date, params):
        return copied, []

    obs = observation or {}
    obs_score = float(obs["visibility_midpoint_ft"])
    obs_grade = str(obs["grade"])
    confidence = float(obs["confidence"])
    anchor_date = date.fromisoformat(local_date)
    previous_display_grade = obs_grade
    audit: list[dict[str, Any]] = []

    for row in copied:
        target_date = date.fromisoformat(str(row["date"]))
        lead_days = (target_date - anchor_date).days
        row["algorithm_grade"] = row.get("grade")
        row["algorithm_visibility_range_ft"] = row.get("estimated_visibility_range_ft")
        row["algorithm_visibility_score_ft"] = row.get("guarded_visibility_score_ft")

        if lead_days == 0:
            row["grade"] = obs_grade
            row["estimated_visibility_range_ft"] = canonical_range(obs_grade)
            row["estimated_visibility_mid_ft"] = obs_score
            # Display-only cosmetic score; it is never used by the model or forecasts.
            row["numeric_score_0_100"] = max(0, min(100, round(50 + (obs_score - 5) * 1.6)))
            row["display_source"] = "camera_observation"
            row["camera_observation"] = dict(obs)
            continue

        if lead_days < 1:
            continue

        score_raw = row.get("guarded_visibility_score_ft")
        try:
            score_algo = float(score_raw)
        except (TypeError, ValueError):
            previous_display_grade = str(row.get("grade") or previous_display_grade)
            continue

        w_lead = LEAD_WEIGHTS.get(lead_days, 0.0)
        if w_lead == 0:
            raw_grade = str(row.get("grade") or grade_from_visibility(score_algo))
            audit.append({
                "schema_version": "1",
                "record_type": "camera_coupling_audit",
                "display_policy_version": POLICY_VERSION,
                "target_date": row["date"],
                "lead_days": lead_days,
                "s_algo": round(score_algo, 4),
                "s_obs": round(obs_score, 4),
                "camera_confidence": confidence,
                "w_lead": 0.0,
                "effective_weight": 0.0,
                "pre_cap_blended_score": round(score_algo, 4),
                "pull_capped_score": round(score_algo, 4),
                "s_display": round(score_algo, 4),
                "raw_grade": raw_grade,
                "provisional_grade": raw_grade,
                "final_grade": raw_grade,
                "pull_cap_applied": False,
                "slew_override": False,
                "slew_exceeded_pull_cap": False,
                "parameters": {
                    "minimum_camera_confidence": params.minimum_camera_confidence,
                    "maximum_pull_ft": params.maximum_pull_ft,
                    "maximum_step_per_day": params.maximum_step_per_day,
                    "lead_weights": {str(key): value for key, value in LEAD_WEIGHTS.items()},
                },
            })
            previous_display_grade = raw_grade
            continue

        effective_weight = w_lead * confidence
        blended = (1 - effective_weight) * score_algo + effective_weight * obs_score
        pull_delta = blended - score_algo
        pull_capped = score_algo + min(max(pull_delta, -params.maximum_pull_ft), params.maximum_pull_ft)
        pull_cap_applied = abs(pull_delta) > params.maximum_pull_ft
        raw_grade = str(row.get("grade") or grade_from_visibility(score_algo))
        provisional_grade = grade_from_visibility(pull_capped)
        final_grade = _clamp_grade_step(provisional_grade, previous_display_grade, params.maximum_step_per_day)
        slew_override = final_grade != provisional_grade
        display_score = _nearest_score_in_grade(pull_capped, final_grade) if slew_override else pull_capped
        slew_exceeded_pull_cap = abs(display_score - score_algo) > params.maximum_pull_ft + 1e-9

        row["grade"] = final_grade
        row["estimated_visibility_range_ft"] = canonical_range(final_grade)
        row["estimated_visibility_mid_ft"] = round(display_score, 2)
        row["display_source"] = "camera_coupled_forecast" if effective_weight > 0 or slew_override else "algorithm_forecast"
        row["camera_adjusted"] = bool(effective_weight > 0 or slew_override)
        row["camera_observation"] = dict(obs)

        audit.append({
            "schema_version": "1",
            "record_type": "camera_coupling_audit",
            "display_policy_version": POLICY_VERSION,
            "target_date": row["date"],
            "lead_days": lead_days,
            "s_algo": round(score_algo, 4),
            "s_obs": round(obs_score, 4),
            "camera_confidence": confidence,
            "w_lead": w_lead,
            "effective_weight": round(effective_weight, 6),
            "pre_cap_blended_score": round(blended, 4),
            "pull_capped_score": round(pull_capped, 4),
            "s_display": round(display_score, 4),
            "raw_grade": raw_grade,
            "provisional_grade": provisional_grade,
            "final_grade": final_grade,
            "pull_cap_applied": pull_cap_applied,
            "slew_override": slew_override,
            "slew_exceeded_pull_cap": slew_exceeded_pull_cap,
            "parameters": {
                "minimum_camera_confidence": params.minimum_camera_confidence,
                "maximum_pull_ft": params.maximum_pull_ft,
                "maximum_step_per_day": params.maximum_step_per_day,
                "lead_weights": {str(key): value for key, value in LEAD_WEIGHTS.items()},
            },
        })
        previous_display_grade = final_grade

    return copied, audit
