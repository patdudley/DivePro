#!/usr/bin/env python3
"""Append Scripps camera observations and coupling audits to the private repo."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


def _json_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _read_jsonl(paths) -> list[dict[str, Any]]:
    records = []
    for path in paths:
        records.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return records


def _append(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def _validate_camera(record: dict[str, Any]) -> None:
    required = {
        "schema_version", "record_type", "observation_id", "source_reference_hash",
        "content_hash", "observation_date", "captured_at_utc", "captured_at_local",
        "slot", "status", "grader_version", "prompt_version", "rubric_version",
    }
    missing = sorted(key for key in required if record.get(key) in {None, ""})
    if missing:
        raise ValueError(f"camera record missing fields: {missing}")
    if record["record_type"] != "camera_observation":
        raise ValueError("invalid camera record type")
    if record["status"] not in {"valid", "unusable", "capture_failure", "grading_failure", "grading_skipped"}:
        raise ValueError("invalid camera status")
    if record["status"] == "valid":
        if record.get("grade") not in {"F", "D", "C", "B", "A", "A+"}:
            raise ValueError("valid camera record requires a grade")
        confidence = float(record.get("confidence"))
        if not 0 <= confidence <= 1:
            raise ValueError("camera confidence must be between 0 and 1")
        if not record.get("image_sha256"):
            raise ValueError("valid camera record requires an image hash")
    prohibited = {"report_text", "source_excerpt", "raw_text", "narrative", "explanation"}
    if set(record) & prohibited:
        raise ValueError("camera records cannot contain report prose")


def ingest(root: Path, batch_path: Path, image_path: Path) -> tuple[int, int]:
    batch = json.loads(batch_path.read_text())
    camera = dict(batch["camera_record"])
    _validate_camera(camera)
    year, month = camera["observation_date"].split("-")[:2]
    camera_path = root / "camera-observations" / "la-jolla" / year / f"camera-observations-{year}-{month}.jsonl"
    existing_camera = _read_jsonl(root.glob("camera-observations/la-jolla/*/camera-observations-*.jsonl"))
    exact = next((row for row in existing_camera if row["observation_id"] == camera["observation_id"] and row["content_hash"] == camera["content_hash"]), None)
    appended = skipped = 0
    if exact:
        skipped += 1
    else:
        previous = [row for row in existing_camera if row.get("source_reference_hash") == camera["source_reference_hash"]]
        if previous:
            camera["supersedes_observation_id"] = previous[-1]["observation_id"]
            camera["observation_id"] = f"{camera['observation_id']}-r{camera['content_hash'][:8]}"
        if camera.get("image_sha256"):
            if not image_path.exists():
                raise FileNotFoundError("camera image is required for a valid camera record")
            actual_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
            if actual_hash != camera["image_sha256"]:
                raise ValueError("camera image hash does not match record")
            slot = camera["slot"].replace(":", "")
            archive = root / "camera-observations" / "la-jolla" / year / month / "images" / f"{camera['observation_date']}-{slot}-{actual_hash[:12]}.jpg"
            archive.parent.mkdir(parents=True, exist_ok=True)
            if not archive.exists():
                shutil.copyfile(image_path, archive)
            camera["private_image_path"] = str(archive.relative_to(root))
        _append(camera_path, camera)
        appended += 1

    coupling_path = root / "coupling-audits" / "la-jolla" / year / f"coupling-audits-{year}-{month}.jsonl"
    existing_audits = _read_jsonl(root.glob("coupling-audits/la-jolla/*/coupling-audits-*.jsonl"))
    existing_ids = {row.get("audit_id") for row in existing_audits}
    for raw in batch.get("coupling_records") or []:
        record = dict(raw)
        identity = "|".join(str(record.get(key) or "") for key in ("capture_id", "forecast_id", "target_date", "display_policy_version"))
        record["audit_id"] = hashlib.sha256(identity.encode()).hexdigest()
        record["content_hash"] = _json_hash(record)
        if record["audit_id"] in existing_ids:
            skipped += 1
            continue
        _append(coupling_path, record)
        existing_ids.add(record["audit_id"])
        appended += 1
    return appended, skipped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("batch", type=Path)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    appended, skipped = ingest(args.root, args.batch, args.image)
    print(f"Appended {appended}; skipped {skipped} duplicate(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
