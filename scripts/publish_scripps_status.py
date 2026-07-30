#!/usr/bin/env python3
"""Publish independent Scripps attempt and last-valid status pointers."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path


def _atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def publish_statuses(
    attempt_path: Path,
    attempt_destination: Path,
    last_valid_destination: Path,
    *,
    archive_path: Path | None = None,
    legacy_destination: Path | None = None,
) -> dict[str, bool]:
    status = json.loads(attempt_path.read_text())
    _atomic_copy(attempt_path, attempt_destination)

    promoted = archive_path is not None
    if promoted:
        if status.get("capture_ok") is not True:
            raise ValueError("cannot promote a failed capture to last-valid")
        if status.get("source_freshness_verified") is not True:
            raise ValueError("cannot promote a capture without verified source freshness")
        if not status.get("image_url"):
            raise ValueError("cannot promote a capture without an immutable image URL")
        if not archive_path.is_file():
            raise ValueError(f"capture archive does not exist: {archive_path}")
        _atomic_copy(attempt_path, last_valid_destination)
        if legacy_destination is not None:
            _atomic_copy(attempt_path, legacy_destination)

    return {"attempt_updated": True, "last_valid_updated": promoted}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempt", required=True, type=Path)
    parser.add_argument("--attempt-destination", required=True, type=Path)
    parser.add_argument("--last-valid-destination", required=True, type=Path)
    parser.add_argument("--archive-path", type=Path)
    parser.add_argument("--legacy-destination", type=Path)
    args = parser.parse_args()
    result = publish_statuses(
        args.attempt,
        args.attempt_destination,
        args.last_valid_destination,
        archive_path=args.archive_path,
        legacy_destination=args.legacy_destination,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
