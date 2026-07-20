#!/usr/bin/env python3
"""Store one validated Scripps capture in the public immutable archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path


def archive_capture(
    image_path: Path,
    status_path: Path,
    archive_root: Path,
    public_url_prefix: str = "/camera-snapshot-history/scripps-pier",
) -> Path:
    status = json.loads(status_path.read_text())
    if status.get("capture_ok") is not True:
        raise ValueError("refusing to archive a capture whose status is not capture_ok")

    expected_hash = str(status.get("image_sha256") or "")
    actual_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
    if not expected_hash or actual_hash != expected_hash:
        raise ValueError("capture image hash does not match its status document")

    observation_date = str(status.get("observation_date") or "")
    datetime.strptime(observation_date, "%Y-%m-%d")
    captured_at_utc = str(status.get("captured_at_utc") or "")
    captured = datetime.fromisoformat(captured_at_utc.replace("Z", "+00:00"))

    day_dir = archive_root / observation_date
    day_dir.mkdir(parents=True, exist_ok=True)
    destination = day_dir / (
        f"scripps-pier-{captured.strftime('%H%M%S')}-{actual_hash[:12]}.jpg"
    )
    if destination.exists():
        if hashlib.sha256(destination.read_bytes()).hexdigest() != actual_hash:
            raise ValueError(f"archive collision at {destination}")
    else:
        shutil.copyfile(image_path, destination)

    relative_path = destination.relative_to(archive_root).as_posix()
    status["image_url"] = (
        f"{public_url_prefix.rstrip('/')}/{relative_path}?v={actual_hash[:12]}"
    )
    status_path.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("status", type=Path)
    parser.add_argument(
        "--archive-root",
        type=Path,
        default=Path("camera-snapshot-history/scripps-pier"),
    )
    args = parser.parse_args()
    print(archive_capture(args.image, args.status, args.archive_root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
