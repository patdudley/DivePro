#!/usr/bin/env python3
"""Fail-closed production readiness checks for the Scripps camera rollout."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "camera-config.json"
WORKFLOW = ROOT / ".github/workflows/scripps-camera-grade.yml"
MIN_REVIEWED_CAPTURES = 9
MIN_REVIEWED_DATES = 3


def compute_live_eligibility(eval_data_dir: Path) -> dict[str, object]:
    """Compute the live publish gate from the latest human-review revisions."""
    if not eval_data_dir.is_dir():
        raise ValueError(f"evaluation-data checkout is absent: {eval_data_dir}")

    latest_reviews: dict[str, dict[str, object]] = {}
    review_paths = sorted(
        eval_data_dir.glob(
            "camera-human-reviews/la-jolla/*/camera-human-reviews-*.jsonl"
        )
    )
    for path in review_paths:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
            rows = [json.loads(line) for line in lines if line.strip()]
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot read camera review ledger {path}: {exc}") from exc
        for row in rows:
            identity = str(row.get("source_reference_hash") or "")
            if not identity:
                raise ValueError(f"camera review is missing source_reference_hash: {path}")
            existing = latest_reviews.get(identity)
            if existing is None or str(row.get("reviewed_at_utc") or "") >= str(
                existing.get("reviewed_at_utc") or ""
            ):
                latest_reviews[identity] = row

    reviewed_observations: dict[str, dict[str, object]] = {}
    for row in latest_reviews.values():
        observation_id = str(row.get("camera_observation_id") or "")
        if not observation_id:
            raise ValueError("camera review is missing camera_observation_id")
        reviewed_observations[observation_id] = row
    reviewed_dates = {
        str(row.get("observation_date"))
        for row in reviewed_observations.values()
        if row.get("observation_date")
    }
    reviewed_captures = len(reviewed_observations)
    reviewed_date_count = len(reviewed_dates)
    return {
        "reviewed_captures": reviewed_captures,
        "reviewed_dates": reviewed_date_count,
        "eligible_for_live_mode": (
            reviewed_captures >= MIN_REVIEWED_CAPTURES
            and reviewed_date_count >= MIN_REVIEWED_DATES
        ),
    }


def run(
    require_secrets: bool = False,
    require_live: bool = False,
    eval_data_dir: Path | None = None,
) -> dict[str, object]:
    config = json.loads(CONFIG.read_text())
    mode = str(config.get("mode", "off")).lower()
    if mode not in {"off", "shadow", "live"}:
        raise ValueError(f"invalid camera rollout mode: {mode}")
    if require_live and mode != "live":
        raise ValueError(f"camera rollout is {mode}, not live")

    publish_screenshots = config.get("publish_screenshots", False)
    if not isinstance(publish_screenshots, bool):
        raise ValueError("publish_screenshots must be a boolean")

    image_url = str(config.get("public_image_url", ""))
    release_tag = str(config.get("public_image_release_tag", ""))
    if not image_url.startswith("https://github.com/patdudley/DivePro/releases/download/"):
        raise ValueError("public image URL must use the DivePro GitHub Release asset")
    if f"/download/{release_tag}/scripps-pier.jpg" not in image_url:
        raise ValueError("public image URL and release tag do not match")

    workflow = WORKFLOW.read_text()
    required_fragments = {
        "live grade-coupling gate": "steps.config.outputs.mode == 'live'",
        "screenshot publish gate": "steps.config.outputs.publish == 'true'",
        "release replacement": "gh release upload",
        "replace-in-place upload": "--clobber",
        "status-only commit": "git add camera-snapshots/scripps-pier-latest.json",
    }
    missing = [label for label, fragment in required_fragments.items() if fragment not in workflow]
    if missing:
        raise ValueError(f"workflow safety checks missing: {', '.join(missing)}")
    if "git add camera-snapshots/scripps-pier.jpg" in workflow:
        raise ValueError("workflow still commits the public camera image")

    secrets = {
        name: bool(os.environ.get(name))
        for name in ("ANTHROPIC_API_KEY", "EVAL_REPO_TOKEN")
    }
    if require_secrets and not all(secrets.values()):
        missing_secrets = [name for name, present in secrets.items() if not present]
        raise ValueError(f"required secret environment values are absent: {', '.join(missing_secrets)}")

    eligibility = {
        "reviewed_captures": 0,
        "reviewed_dates": 0,
        "eligible_for_live_mode": False,
    }
    if eval_data_dir is not None:
        eligibility = compute_live_eligibility(eval_data_dir)
    elif require_live:
        raise ValueError(
            "live rollout requires the private evaluation-data checkout; "
            "pass --eval-data-dir or set EVAL_DATA_DIR"
        )
    if require_live and not eligibility["eligible_for_live_mode"]:
        raise ValueError(
            "camera shadow review threshold is not met: "
            f"{eligibility['reviewed_captures']}/{MIN_REVIEWED_CAPTURES} reviewed captures, "
            f"{eligibility['reviewed_dates']}/{MIN_REVIEWED_DATES} reviewed local dates"
        )

    return {
        "mode": mode,
        "publish_screenshots": publish_screenshots,
        "public_image_strategy": "replace-in-place-github-release-asset",
        "public_image_url": image_url,
        "required_secrets_present": secrets,
        "live_eligibility": eligibility,
        "safe_to_change_public_display": (
            mode == "live"
            and all(secrets.values())
            and bool(eligibility["eligible_for_live_mode"])
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-secrets", action="store_true")
    parser.add_argument("--require-live", action="store_true")
    parser.add_argument(
        "--eval-data-dir",
        type=Path,
        default=Path(os.environ["EVAL_DATA_DIR"]) if os.environ.get("EVAL_DATA_DIR") else None,
    )
    args = parser.parse_args()
    try:
        result = run(
            require_secrets=args.require_secrets,
            require_live=args.require_live,
            eval_data_dir=args.eval_data_dir,
        )
    except ValueError as exc:
        print(json.dumps({"ready": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
