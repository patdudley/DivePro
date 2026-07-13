#!/usr/bin/env python3
"""Train preregistered physics-focused La Jolla visibility candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import HuberRegressor
from sklearn.metrics import mean_absolute_error, mean_pinball_loss
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from visibility_v2_features import FEATURE_NAMES, MONOTONIC_CONSTRAINTS


LABEL_COLUMNS = ["date", "vis_min_ft", "vis_max_ft"]
FORBIDDEN_FEATURES = {"month", "sin_doy", "cos_doy"}


def load_training_data(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    required = set(LABEL_COLUMNS + FEATURE_NAMES)
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(
            "training data is not v2-ready; missing columns: " + ", ".join(missing)
        )
    if FORBIDDEN_FEATURES & set(FEATURE_NAMES):
        raise AssertionError("calendar features entered the v2 schema")
    frame["date"] = pd.to_datetime(frame["date"], errors="raise")
    if "vis_value_type" in frame:
        frame = frame[frame["vis_value_type"] == "closed_range"]
    frame = frame.dropna(subset=LABEL_COLUMNS).sort_values("date").reset_index(drop=True)
    frame["target_mid_ft"] = (frame["vis_min_ft"] + frame["vis_max_ft"]) / 2.0
    frame["target_width_ft"] = frame["vis_max_ft"] - frame["vis_min_ft"]
    frame = frame[(frame["target_width_ft"] >= 0) & (frame["target_width_ft"] <= 20)]
    frame["sample_weight"] = 1.0 / (1.0 + frame["target_width_ft"] / 5.0)
    return frame


def audit(frame: pd.DataFrame) -> dict:
    def grade(value):
        if value < 5: return "F"
        if value < 10: return "D"
        if value < 15: return "C"
        if value < 25: return "B"
        if value < 35: return "A"
        return "A+"
    grades = Counter(grade(value) for value in frame["target_mid_ft"])
    monthly = Counter(frame["date"].dt.to_period("M").astype(str))
    summer = frame[frame["date"].dt.month.isin((6, 7, 8))].copy()
    summer["target_grade"] = summer["target_mid_ft"].map(grade)
    summer_grade_support = {
        str(year): dict(Counter(group["target_grade"]))
        for year, group in summer.groupby(summer["date"].dt.year)
        if year in (2024, 2025, 2026)
    }
    correlations = frame[FEATURE_NAMES].corr().abs()
    highly_correlated = []
    for i, left in enumerate(FEATURE_NAMES):
        for right in FEATURE_NAMES[i + 1:]:
            value = correlations.loc[left, right]
            if value >= 0.9:
                highly_correlated.append({"left": left, "right": right, "abs_correlation": round(float(value), 4)})
    return {
        "rows": len(frame),
        "date_min": frame["date"].min().date().isoformat(),
        "date_max": frame["date"].max().date().isoformat(),
        "grade_support": dict(grades),
        "unsupported_grades": [name for name in ("F", "D", "C", "B", "A", "A+") if grades[name] == 0],
        "monthly_rows": dict(sorted(monthly.items())),
        "summer_grade_support": summer_grade_support,
        "missing_features": {name: int(frame[name].isna().sum()) for name in FEATURE_NAMES},
        "highly_correlated_features": highly_correlated,
        "duplicate_date_rows": int(frame.duplicated(subset=["date"], keep=False).sum()),
        "location_classes": (
            dict(Counter(frame["location_class"].fillna("missing")))
            if "location_class" in frame else {"unknown_not_exported": len(frame)}
        ),
        "source_parity": (
            dict(Counter(frame["source_parity_status"].fillna("missing")))
            if "source_parity_status" in frame else {"not_auditable_from_export": len(frame)}
        ),
    }


def linear_candidate():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
        ("model", HuberRegressor(alpha=1.0, epsilon=1.35, max_iter=1000)),
    ])


def boosting_candidate(quantile: float):
    return HistGradientBoostingRegressor(
        loss="quantile",
        quantile=quantile,
        learning_rate=0.05,
        max_iter=200,
        max_leaf_nodes=15,
        min_samples_leaf=20,
        l2_regularization=1.0,
        monotonic_cst=[MONOTONIC_CONSTRAINTS[name] for name in FEATURE_NAMES],
        random_state=42,
    )


def _folds(n_rows: int):
    test_size = max(28, min(45, n_rows // 8))
    possible = (n_rows - 120) // test_size
    if possible < 2:
        raise ValueError("at least 176 time-ordered closed-range rows are required")
    return TimeSeriesSplit(n_splits=min(5, possible), test_size=test_size)


def cross_validate(frame: pd.DataFrame) -> dict:
    X = frame[FEATURE_NAMES].to_numpy(float)
    y = frame["target_mid_ft"].to_numpy(float)
    weights = frame["sample_weight"].to_numpy(float)
    results = {"linear": [], "boosting": []}
    for fold, (train, test) in enumerate(_folds(len(frame)).split(X), start=1):
        linear = linear_candidate()
        linear.fit(X[train], y[train], model__sample_weight=weights[train])
        linear_mid = linear.predict(X[test])
        train_residual = y[train] - linear.predict(X[train])
        linear_lo = linear_mid + np.quantile(train_residual, 0.2)
        linear_hi = linear_mid + np.quantile(train_residual, 0.8)

        boost_models = {q: boosting_candidate(q).fit(X[train], y[train], sample_weight=weights[train]) for q in (0.2, 0.5, 0.8)}
        boost_pred = {q: boost_models[q].predict(X[test]) for q in boost_models}
        boost_ordered = np.sort(np.vstack([boost_pred[0.2], boost_pred[0.5], boost_pred[0.8]]), axis=0)

        def metrics(mid, lo, hi):
            return {
                "fold": fold,
                "n": len(test),
                "mae": float(mean_absolute_error(y[test], mid)),
                "pinball_20": float(mean_pinball_loss(y[test], lo, alpha=0.2)),
                "pinball_80": float(mean_pinball_loss(y[test], hi, alpha=0.8)),
                "coverage": float(np.mean((y[test] >= lo) & (y[test] <= hi))),
                "mean_width": float(np.mean(hi - lo)),
            }
        results["linear"].append(metrics(linear_mid, linear_lo, linear_hi))
        results["boosting"].append(metrics(boost_ordered[1], boost_ordered[0], boost_ordered[2]))

    summary = {}
    for name, folds in results.items():
        summary[name] = {
            key: round(float(np.mean([fold[key] for fold in folds])), 5)
            for key in ("mae", "pinball_20", "pinball_80", "coverage", "mean_width")
        }
        summary[name]["folds"] = folds
        summary[name]["selection_score"] = round(
            summary[name]["mae"] + (summary[name]["pinball_20"] + summary[name]["pinball_80"]) / 2,
            5,
        )
    boost_score = summary["boosting"]["selection_score"]
    summary["selected"] = "linear" if summary["linear"]["selection_score"] <= boost_score * 1.05 else "boosting"
    return summary


def fit_final(frame: pd.DataFrame, selected: str) -> dict:
    X = frame[FEATURE_NAMES].to_numpy(float)
    y = frame["target_mid_ft"].to_numpy(float)
    weights = frame["sample_weight"].to_numpy(float)
    if selected == "linear":
        model = linear_candidate().fit(X, y, model__sample_weight=weights)
        residual = y - model.predict(X)
        return {"kind": "linear", "model": model, "residual_q20": float(np.quantile(residual, 0.2)), "residual_q80": float(np.quantile(residual, 0.8))}
    return {"kind": "boosting", "models": {q: boosting_candidate(q).fit(X, y, sample_weight=weights) for q in (0.2, 0.5, 0.8)}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("training_csv", type=Path)
    parser.add_argument("--out-model", type=Path, default=Path("model_lajolla_v2.pkl"))
    parser.add_argument("--out-report", type=Path, default=Path("model_lajolla_v2_report.json"))
    parser.add_argument("--audit-only", action="store_true")
    args = parser.parse_args()
    frame = load_training_data(args.training_csv)
    report = {"audit": audit(frame), "feature_names": FEATURE_NAMES, "monotonic_constraints": MONOTONIC_CONSTRAINTS}
    if not args.audit_only:
        report["cross_validation"] = cross_validate(frame)
        selected = report["cross_validation"]["selected"]
        artifact = {
            "schema_version": "visibility-v2-physics-14",
            "feature_schema_hash": hashlib.sha256(
                json.dumps(FEATURE_NAMES, separators=(",", ":")).encode()
            ).hexdigest(),
            "policy_version": "shadow-v1",
            "trained_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "feature_names": FEATURE_NAMES,
            "monotonic_constraints": MONOTONIC_CONSTRAINTS,
            "training_date_min": report["audit"]["date_min"],
            "training_date_max": report["audit"]["date_max"],
            "training_rows": report["audit"]["rows"],
            "training_data_hash": hashlib.sha256(args.training_csv.read_bytes()).hexdigest(),
            "candidate": fit_final(frame, selected),
        }
        joblib.dump(artifact, args.out_model)
    args.out_report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
