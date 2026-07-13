#!/usr/bin/env python3
"""Compare immutable logged v2 display grades with the v3 guarded-vis policy."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def grade_from_visibility(value: float) -> str:
    if value < 5:
        return "F"
    if value < 10:
        return "D"
    if value < 15:
        return "C"
    if value < 25:
        return "B"
    if value < 35:
        return "A"
    return "A+"


def compare(path: Path) -> dict:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    transitions = Counter()
    comparable = 0
    for row in rows:
        try:
            guarded = float(row["guarded_expected_vis_ft"])
        except (KeyError, TypeError, ValueError):
            continue
        old = row.get("displayed_grade") or "missing"
        new = grade_from_visibility(guarded)
        transitions[(old, new)] += 1
        comparable += 1
    changed = sum(count for (old, new), count in transitions.items() if old != new)
    return {
        "rows": len(rows),
        "comparable_rows": comparable,
        "changed_rows": changed,
        "changed_rate": round(changed / comparable, 6) if comparable else None,
        "transitions": {
            f"{old}->{new}": count
            for (old, new), count in sorted(transitions.items())
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("forecast_log", type=Path, nargs="?", default=Path("forecast_log.csv"))
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = compare(args.forecast_log)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.out:
        args.out.write_text(rendered)
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
