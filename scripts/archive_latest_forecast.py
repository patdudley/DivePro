#!/usr/bin/env python3
"""
Append the current latest_forecast.json to forecast_history.json.

The site is static, so this file gives GitHub Actions a simple database:
each run reads the latest forecast, stores a compact record, and commits it.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LATEST = ROOT / "latest_forecast.json"
HISTORY = ROOT / "forecast_history.json"
DAILY_DIR = ROOT / "forecast-history"


def visibility_text(forecast: dict) -> str:
    visibility = forecast.get("estimated_visibility_range_ft") or [0, 0]
    return f"{visibility[0]}-{visibility[1]} ft"


def clean_report_text(forecast: dict) -> str:
    raw = str(forecast.get("report_text") or "").strip()
    if raw:
      lines = []
      for line in raw.splitlines():
          stripped = line.strip()
          if not stripped:
              continue
          if re.match(r"^\d{1,2}:\d{2}\s*(AM|PM)\s+Update\s+-\s+Grade", stripped, re.I):
              continue
          if stripped.lower().startswith(("best shot:", "waves:")):
              continue
          lines.append(stripped)
      cleaned = " ".join(lines).strip()
      if cleaned:
          cleaned = re.sub(r"\bViz is expected around\b", "Viz is currently sitting around", cleaned, flags=re.I)
          return cleaned

    risks = forecast.get("risk_factors") or []
    first_risk = risks[0] if risks else "Conditions look worth checking before you head out."
    return f"Viz is currently sitting around {visibility_text(forecast)}. {first_risk}"


def compact_forecast(forecast: dict) -> dict:
    return {
        "archived_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "generated_at": forecast.get("generated_at"),
        "date": forecast.get("date"),
        "location": forecast.get("location") or forecast.get("spot_name") or "La Jolla",
        "grade": forecast.get("grade"),
        "numeric_score_0_100": forecast.get("numeric_score_0_100"),
        "estimated_visibility_range_ft": forecast.get("estimated_visibility_range_ft"),
        "best_window": forecast.get("best_window"),
        "report_text": clean_report_text(forecast),
    }


def load_history() -> list[dict]:
    if not HISTORY.exists():
        return []
    data = json.loads(HISTORY.read_text())
    return data if isinstance(data, list) else []


def entry_key(entry: dict) -> tuple[str, str]:
    return (str(entry.get("date") or ""), str(entry.get("generated_at") or ""))


def main() -> int:
    forecast = json.loads(LATEST.read_text())
    entry = compact_forecast(forecast)
    history = load_history()
    key = entry_key(entry)

    history = [existing for existing in history if entry_key(existing) != key]
    history.insert(0, entry)
    history = history[:365]

    HISTORY.write_text(json.dumps(history, indent=2) + "\n")

    DAILY_DIR.mkdir(exist_ok=True)
    date = entry.get("date") or "unknown-date"
    (DAILY_DIR / f"{date}.json").write_text(json.dumps(entry, indent=2) + "\n")
    print(f"Archived forecast {date} ({entry.get('grade')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
