#!/usr/bin/env python3
"""Run a trained v2 artifact against precomputed feature rows in shadow mode."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import joblib

from shadow_visibility_v2 import append_shadow, make_shadow_row
from visibility_v2_features import FEATURE_NAMES


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("feature_batch", type=Path)
    parser.add_argument("--log", type=Path, default=Path("shadow_forecast_log_v2.csv"))
    args = parser.parse_args()
    artifact = joblib.load(args.artifact)
    payload = json.loads(args.feature_batch.read_text())
    rows = payload.get("rows") or []
    for item in rows:
        features = item.get("features") or {}
        missing = [name for name in FEATURE_NAMES if name not in features]
        if missing:
            raise ValueError(f"shadow row is missing features: {missing}")
        append_shadow(
            args.log,
            make_shadow_row(args.artifact, artifact, features, item.get("metadata") or {}),
        )
    print(f"Processed {len(rows)} shadow row(s); log={args.log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
