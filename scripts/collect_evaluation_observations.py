#!/usr/bin/env python3
"""Collect derived La Jolla visibility observations without retaining prose."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup


SOURCE_URL = "https://justgetwet.com/blogs/dive-reports-and-conditions/tagged/la-jolla-dive-conditions"
LOCAL_TZ = ZoneInfo("America/Los_Angeles")
PARSER_VERSION = "jgw-derived-v1"
ARTICLE_SELECTOR = "div.article__grid-meta"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _grade(midpoint: float | None) -> str | None:
    if midpoint is None:
        return None
    if midpoint < 5:
        return "F"
    if midpoint < 10:
        return "D"
    if midpoint < 15:
        return "C"
    if midpoint < 25:
        return "B"
    if midpoint < 35:
        return "A"
    return "A+"


def _visibility(text: str) -> dict | None:
    number = r"\d+(?:\.\d+)?"
    vis_prefix = r"(?:vis|viz|visibility)\s*(?::|=|-|was|is|of)?\s*"
    vis_suffix = r"\s*(?:vis|viz|visibility)\b"
    closed_value = rf"({number})\s*(?:-|–|to)\s*({number})\s*(?:ft|feet|')"
    closed = re.search(rf"(?:{vis_prefix}{closed_value}|{closed_value}{vis_suffix})", text, re.I)
    if closed:
        captures = [value for value in closed.groups() if value is not None]
        lo, hi = sorted((float(captures[0]), float(captures[1])))
        return {"min": lo, "max": hi, "mid": (lo + hi) / 2, "type": "closed_range"}

    censored_value = rf"({number})\s*\+\s*(?:ft|feet|')"
    censored = re.search(rf"(?:{vis_prefix}{censored_value}|{censored_value}{vis_suffix})", text, re.I)
    if censored:
        lo = float(next(value for value in censored.groups() if value is not None))
        return {"min": lo, "max": None, "mid": None, "type": "censored_min"}

    single_value = rf"({number})\s*(?:ft|feet|')"
    single = re.search(rf"(?:{vis_prefix}{single_value}|{single_value}{vis_suffix})", text, re.I)
    if single:
        value = float(next(item for item in single.groups() if item is not None))
        margin = max(3.0, round(value * 0.12, 1))
        return {
            "min": max(0.0, value - margin),
            "max": value + margin,
            "mid": value,
            "type": "single_value_synthetic",
        }
    return None


def _location(text: str) -> tuple[str, float]:
    lower = text.lower()
    dove = any(word in lower for word in ("went", "dove", "dive", "diving", "freedivers", "went out"))
    if any(word in lower for word in ("the line", "line divers", "line diving", "offshore line")) and dove:
        return "the_line", 1.0
    if any(word in lower for word in ("la jolla", "scripps", "cove", "shores")) and dove:
        return "la_jolla_shore", 0.8
    if "jetty" in lower or "mission bay" in lower:
        return "jetty", 0.5 if dove else 0.3
    if dove:
        return "sd_other", 0.7
    if "cam" in lower or "camera" in lower:
        return "camera_only", 0.3
    return "unknown", 0.2


def _posted_at(article) -> datetime | None:
    time_el = article.find("time")
    raw = time_el.get("datetime", "") if time_el else ""
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_page(html: str, observation_date: str, collected_at: datetime, run_id: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    articles = soup.select(ARTICLE_SELECTOR)[:20]
    if not articles:
        raise ValueError(f"selector matched zero historical posts: {ARTICLE_SELECTOR}")

    records = []
    for index, article in enumerate(articles):
        posted = _posted_at(article)
        if posted is None or posted.astimezone(LOCAL_TZ).date().isoformat() != observation_date:
            continue
        text = article.get_text(" ", strip=True)
        visibility = _visibility(text)
        if visibility is None:
            continue
        link = article.find("a", href=True)
        source_url = urljoin(SOURCE_URL, link["href"]) if link else f"{SOURCE_URL}#post-{posted.isoformat()}-{index}"
        reference_hash = _hash(source_url)
        location_class, weight = _location(text)
        midpoint = visibility["mid"]
        derived = {
            "observation_date": observation_date,
            "source_reference_hash": reference_hash,
            "source_posted_at": posted.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "visibility_min_ft": visibility["min"],
            "visibility_max_ft": visibility["max"],
            "visibility_midpoint_ft": midpoint,
            "vis_value_type": visibility["type"],
            "location_class": location_class,
            "confidence_weight": weight,
        }
        records.append({
            "schema_version": "obs-v1",
            "record_type": "observation",
            "observation_id": f"obs-{observation_date}-justgetwet-{reference_hash[:12]}",
            "observation_date": observation_date,
            "collected_at_utc": collected_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "ingestion_run_id": run_id,
            "source_name": "justgetwet",
            "source_reference_hash": reference_hash,
            "source_url": source_url,
            "source_posted_at": derived["source_posted_at"],
            "parser_version": PARSER_VERSION,
            "parse_status": "ok",
            "posts_scanned_count": len(articles),
            "visibility_min_ft": visibility["min"],
            "visibility_max_ft": visibility["max"],
            "visibility_midpoint_ft": midpoint,
            "vis_value_type": visibility["type"],
            "observed_grade": _grade(midpoint),
            "grade_table_version": "grade_bands_v1",
            "confidence_weight": weight,
            "confidence_label": "high" if weight >= 0.7 else "medium" if weight >= 0.4 else "low",
            "location_class": location_class,
            "dive_time_local": None,
            "is_primary_candidate": False,
            "content_hash": _hash(json.dumps(derived, sort_keys=True, separators=(",", ":"))),
            "supersedes_observation_id": None,
            "collection_mode": "prospective",
            "flags": (["range_span_le_20"] if visibility["max"] is not None and visibility["max"] - visibility["min"] <= 20 else []),
        })

    if records:
        primary = max(records, key=lambda r: (r["confidence_weight"], r["source_posted_at"]))
        primary["is_primary_candidate"] = True
    else:
        reference_hash = _hash(f"justgetwet:no-report:{observation_date}")
        records = [{
            "schema_version": "obs-v1",
            "record_type": "no_report",
            "observation_id": f"no-report-{observation_date}-justgetwet",
            "observation_date": observation_date,
            "collected_at_utc": collected_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "ingestion_run_id": run_id,
            "source_name": "justgetwet",
            "source_reference_hash": reference_hash,
            "source_url": SOURCE_URL,
            "source_posted_at": None,
            "parser_version": PARSER_VERSION,
            "parse_status": "no_posts_found",
            "posts_scanned_count": len(articles),
            "visibility_min_ft": None,
            "visibility_max_ft": None,
            "visibility_midpoint_ft": None,
            "vis_value_type": None,
            "observed_grade": None,
            "grade_table_version": "grade_bands_v1",
            "confidence_weight": 0.0,
            "confidence_label": "low",
            "location_class": None,
            "dive_time_local": None,
            "is_primary_candidate": False,
            "content_hash": _hash(f"no-report:{observation_date}:{len(articles)}"),
            "supersedes_observation_id": None,
            "collection_mode": "prospective",
            "flags": [],
        }]
    return {"schema_version": "observation-batch-v1", "records": records}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--date", help="Pacific observation date (YYYY-MM-DD)")
    parser.add_argument("--run-id", default="manual")
    parser.add_argument("--html", type=Path, help="Use saved HTML instead of the network")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    observation_date = args.date or now.astimezone(LOCAL_TZ).date().isoformat()
    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        response = requests.get(SOURCE_URL, timeout=20, headers={"User-Agent": "DivePro evaluation collector/1.0"})
        response.raise_for_status()
        html = response.text
    payload = parse_page(html, observation_date, now, args.run_id)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Collected {len(payload['records'])} record(s) for {observation_date}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
