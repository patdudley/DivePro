"""Optional shadow prediction and append-only logging for the v2 candidate."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from visibility_v2_features import FEATURE_NAMES


SHADOW_FIELDS = [
    "forecast_id", "forecast_run_ts_utc", "target_date", "lead_time_hours",
    "model_version_hash", "feature_schema_version", "candidate_policy_version",
    "q20_vis_ft", "median_vis_ft", "q80_vis_ft", "derived_grade",
    "input_source_run_id",
]


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _grade(value: float) -> str:
    if value < 5: return "F"
    if value < 10: return "D"
    if value < 15: return "C"
    if value < 25: return "B"
    if value < 35: return "A"
    return "A+"


def predict(artifact: dict, features: dict) -> tuple[float, float, float]:
    if artifact["feature_names"] != FEATURE_NAMES:
        raise ValueError("shadow feature schema mismatch")
    X = np.array([[features.get(name, np.nan) for name in FEATURE_NAMES]], dtype=float)
    candidate = artifact["candidate"]
    if candidate["kind"] == "linear":
        median = float(candidate["model"].predict(X)[0])
        values = [median + candidate["residual_q20"], median, median + candidate["residual_q80"]]
    else:
        values = [float(candidate["models"][q].predict(X)[0]) for q in (0.2, 0.5, 0.8)]
    q20, median, q80 = sorted(values)
    return round(q20, 2), round(median, 2), round(q80, 2)


def append_shadow(path: Path, row: dict) -> None:
    exists = path.exists() and path.stat().st_size > 0
    if exists:
        with path.open(newline="", encoding="utf-8") as handle:
            if any(old["forecast_id"] == row["forecast_id"] for old in csv.DictReader(handle)):
                return
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=SHADOW_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerow({key: row.get(key, "") for key in SHADOW_FIELDS})


def make_shadow_row(artifact_path: Path, artifact: dict, features: dict, metadata: dict) -> dict:
    q20, median, q80 = predict(artifact, features)
    schema_hash = hashlib.sha256(json.dumps(FEATURE_NAMES, separators=(",", ":")).encode()).hexdigest()
    return {
        **metadata,
        "model_version_hash": _hash(artifact_path),
        "feature_schema_version": schema_hash,
        "candidate_policy_version": artifact["policy_version"],
        "q20_vis_ft": q20,
        "median_vis_ft": median,
        "q80_vis_ft": q80,
        "derived_grade": _grade(median),
    }
