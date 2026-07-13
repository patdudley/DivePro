#!/usr/bin/env python3
"""Add the display policy cohort column to an existing forecast log."""

from __future__ import annotations

import argparse
import csv
import os
import tempfile
from pathlib import Path


FIELD = "display_policy_version"


def migrate(path: Path) -> bool:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if FIELD in fieldnames:
        return False
    if "guardrail_version" not in fieldnames:
        raise ValueError("forecast log is missing guardrail_version")

    insert_at = fieldnames.index("guardrail_version") + 1
    fieldnames.insert(insert_at, FIELD)
    for row in rows:
        row[FIELD] = ""

    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=Path("forecast_log.csv"))
    args = parser.parse_args()
    changed = migrate(args.path)
    print(f"{'Migrated' if changed else 'Already current'}: {args.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
