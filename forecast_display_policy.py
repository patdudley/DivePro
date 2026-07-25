#!/usr/bin/env python3
"""Versioned display-policy evaluation for La Jolla visibility forecasts."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, Mapping, Sequence


GRADE_ORDER = ("F", "D", "C", "B", "A", "A+")
ALLOWED_POLICIES = ("v3", "v4")
V3_VERSION = "v3-guarded-expected-vis"
V4_VERSION = "v4-bimodal-aware"
BIMODAL_TOP1_CEILING = 0.45
BIMODAL_MIN_CLASS_GAP = 2
PROBABILITY_SUM_TOLERANCE = 1e-6
REASON_CODES = frozenset({
    "v3_unchanged",
    "c_to_mode_bimodal",
    "blocked_by_guardrail_cap",
    "malformed_scores_fallback",
})


def load_display_policy(config_path: str | Path) -> str:
    """Load and validate the configured publication policy."""
    path = Path(config_path)
    config = json.loads(path.read_text(encoding="utf-8"))
    policy = config.get("display_policy", "v3")
    if policy not in ALLOWED_POLICIES:
        raise ValueError(
            f"Invalid display_policy {policy!r}; expected one of {ALLOWED_POLICIES}"
        )
    return policy


def _validated_scores(
    probabilities: Mapping[str, float] | Sequence[float] | None,
) -> list[float] | None:
    if isinstance(probabilities, Mapping):
        if set(probabilities) != set(GRADE_ORDER):
            return None
        values = [probabilities[grade] for grade in GRADE_ORDER]
    elif isinstance(probabilities, Sequence) and not isinstance(
        probabilities, (str, bytes)
    ):
        if len(probabilities) != len(GRADE_ORDER):
            return None
        values = list(probabilities)
    else:
        return None

    try:
        scores = [float(value) for value in values]
    except (TypeError, ValueError):
        return None
    if any(not math.isfinite(value) or value < 0.0 or value > 1.0 for value in scores):
        return None
    if abs(sum(scores) - 1.0) > PROBABILITY_SUM_TOLERANCE:
        return None
    return scores


def evaluate_display_policy(
    *,
    probabilities: Mapping[str, float] | Sequence[float] | None,
    raw_expected_vis_ft: float | None,
    guarded_vis_ft: float,
    guardrail_fired: bool,
    active_policy: str,
    grade_from_visibility: Callable[[float], str],
    visibility_range_from_grade: Callable[[str], list[int]],
) -> dict:
    """Compute v3 and v4 without changing the underlying model output."""
    if active_policy not in ALLOWED_POLICIES:
        raise ValueError(
            f"Invalid active_policy {active_policy!r}; expected one of {ALLOWED_POLICIES}"
        )

    v3_grade = grade_from_visibility(guarded_vis_ft)
    scores = _validated_scores(probabilities)
    result = {
        "raw_class_scores": None,
        "raw_expected_vis_ft": raw_expected_vis_ft,
        "guarded_vis_ft": guarded_vis_ft,
        "v3_grade": v3_grade,
        "v4_grade": v3_grade,
        "top1_idx": None,
        "top1_p": None,
        "top2_idx": None,
        "top2_p": None,
        "class_gap": None,
        "is_bimodal": False,
        "guardrail_fired": bool(guardrail_fired),
        "confidence": "standard",
        "active_policy": active_policy,
        "display_policy_version": V3_VERSION if active_policy == "v3" else V4_VERSION,
        "reason": "malformed_scores_fallback",
    }

    if scores is not None:
        ranked = sorted(range(len(scores)), key=lambda index: (-scores[index], index))
        top1_idx, top2_idx = ranked[:2]
        top1_p, top2_p = scores[top1_idx], scores[top2_idx]
        class_gap = abs(top1_idx - top2_idx)
        is_bimodal = (
            top1_p < BIMODAL_TOP1_CEILING
            and class_gap >= BIMODAL_MIN_CLASS_GAP
        )
        result.update({
            "raw_class_scores": {
                grade: round(scores[index], 4)
                for index, grade in enumerate(GRADE_ORDER)
            },
            "top1_idx": top1_idx,
            "top1_p": round(top1_p, 4),
            "top2_idx": top2_idx,
            "top2_p": round(top2_p, 4),
            "class_gap": class_gap,
            "is_bimodal": is_bimodal,
            "confidence": "low" if is_bimodal else "standard",
            "reason": "v3_unchanged",
        })

        if v3_grade == "C" and is_bimodal and top1_idx != GRADE_ORDER.index("C"):
            candidate = GRADE_ORDER[top1_idx]
            if guardrail_fired and top1_idx > GRADE_ORDER.index(v3_grade):
                result["reason"] = "blocked_by_guardrail_cap"
            else:
                result["v4_grade"] = candidate
                result["reason"] = "c_to_mode_bimodal"

    displayed_grade = (
        result["v4_grade"] if active_policy == "v4" else result["v3_grade"]
    )
    result["display_grade"] = displayed_grade
    result["vis_range"] = visibility_range_from_grade(displayed_grade)
    if result["reason"] not in REASON_CODES:
        raise AssertionError(f"Unexpected display-policy reason: {result['reason']}")
    return result
