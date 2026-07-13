#!/usr/bin/env python3
"""Gate v2 training on the exact Jackson-side assets required for auditability."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


REQUIRED_ASSETS = [
    "training_data_coherent.csv",
    "train_soft_model.py",
    "train_model.py",
    "evaluate_forward.py",
]
BUILDER_GLOBS = ["*training*data*.py", "*build*training*.py"]
SOURCE_CONFIG_GLOBS = ["*source*config*.json", "*source*config*.yml", "*source*config*.yaml"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect(root: Path) -> dict:
    files = {name: root / name for name in REQUIRED_ASSETS}
    builders = sorted({path for pattern in BUILDER_GLOBS for path in root.glob(pattern)})
    source_configs = sorted({path for pattern in SOURCE_CONFIG_GLOBS for path in root.glob(pattern)})
    missing = [name for name, path in files.items() if not path.is_file()]
    if not builders:
        missing.append("training-data builder")
    if not source_configs:
        missing.append("training source configuration")
    present = [path for path in files.values() if path.is_file()] + builders + source_configs
    return {
        "ready": not missing,
        "missing": missing,
        "assets": {
            str(path.relative_to(root)): {"bytes": path.stat().st_size, "sha256": sha256(path)}
            for path in sorted(set(present))
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("asset_root", type=Path)
    args = parser.parse_args()
    report = inspect(args.asset_root)
    print(json.dumps(report, indent=2))
    return 0 if report["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
