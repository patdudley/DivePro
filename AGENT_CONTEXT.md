# DivePro — Agent Handoff & Project State
_Last updated: 2026-06-09_

---

## What This Project Is

**DivePro** is a daily La Jolla dive visibility forecast site for San Diego shore divers.
It grades conditions A–F based on wave, swell, tide, wind, chlorophyll, and water temperature data.

There are **two separate repos**:

| Repo | GitHub | Local | Purpose |
|------|--------|-------|---------|
| **divepro-pat** (primary) | `patdudley/DivePro` | `~/projects/divepro-pat/` | Public GitHub Pages site — ML forecast model, static frontend |
| **divepro** (legacy/ops) | `jflacker/divepro` | `~/projects/divepro/` | Ghost CMS automation — screenshot capture, Claude vision grading, daily report posts |

The **divepro-pat** repo is the active development target. This document focuses on it.

---

## divepro-pat — GitHub Pages Forecast Site

### Live URL
`https://diveprosd.com/` (served via GitHub Pages from `patdudley/DivePro` main branch)

### Git Remote
```
origin  git@github.com:patdudley/DivePro.git
```
Push/pull with `jflacker` SSH key. **Never use `--no-verify`. Never merge PRs yourself.**

---

## Repository Layout (`~/projects/divepro-pat/`)

```
build_location_forecasts.py   Core forecast builder — fetches all data, runs ML model, writes JSON
community_report.py           JustGetWet.com scraper — credibility-weighted diver reports
production_features.py        Shared feature formula (p1_energy_raw etc.) — MUST match training
model_lajolla_soft.pkl        Trained soft probabilistic GBT model (frozen — do not retrain)
model_lajolla_soft_features.json  Feature schema for the soft model
model_lajolla.pkl             Point GBT regressor (fallback only)
model_lajolla_features.json   Feature schema for point model
model_metrics.json            Prospective validation metrics (auto-generated)
forecast_log.csv              Every issued forecast appended here — never delete rows
requirements.txt              Python deps (scikit-learn 1.8.0 pinned — do NOT upgrade)

model_outputs/
  spots/la-jolla.json         Authoritative forecast output (full JSON with all fields)
  latest_forecast.json        Copy of today's forecast
  forecast_10day.json         10-day strip forecast

diveprosd_grade_guidance.json Grade guide config (A+ → F with ft ranges)
data_sources.py               External data fetchers (HTTP retry, chla, NDBC, tide H/L)

index.html                    Single-page app shell
app.js                        Main frontend JS (loads JSON, renders all sections)
ui-polish.js                  Secondary UI layer (micro-interactions)
styles.css                    Primary stylesheet
ui-polish.css                 Polish layer CSS
analytics.js / analytics-config.js  Privacy-first analytics

tests/
  test_buoy_temp.py           NDBC water temp tests
  test_chla_classify.py       Chlorophyll classification tests
  test_community_report.py    JustGetWet scraper tests
  test_retry.py               HTTP retry / backoff tests
  test_tide_hilo.py           Tide H/L phase/slack window tests

.github/workflows/update-forecast.yml  GitHub Actions forecast runner
```

---

## Forecast Pipeline

### How It Runs
GitHub Actions runs `build_location_forecasts.py` on a schedule:
- `7:05, 7:20, 7:35 UTC` (just after midnight PT — keeps site fresh overnight)
- `14:00, 14:15, 14:30 UTC` (~7am PT)
- `19:00, 19:15, 19:30 UTC` (~noon PT)

Concurrency group prevents parallel runs. On completion, JSON output under `model_outputs/` is committed back to main; GitHub Pages serves it directly (no root-level mirror copies).

### Python Environment
- **Python 3.13** on GitHub Actions (Ubuntu latest)
- **Python 3.9.6** locally on Jackson's Mac (may fail to install scikit-learn 1.8.0)
- Do NOT upgrade scikit-learn — model pickle is tied to 1.8.0 exactly
- Install deps: `python -m pip install -r requirements.txt`

### Running Locally
```bash
cd ~/projects/divepro-pat
python build_location_forecasts.py
# Writes model_outputs/spots/la-jolla.json and appends to forecast_log.csv
# Expected output: "Done. 1 spots written."
```

### Data Sources (all via `_get_json_with_retry()`)
| Data | Source |
|------|--------|
| Wave / swell (hourly) | Open-Meteo marine API |
| Long-range marine | Open-Meteo (14-day) |
| Weather (daily + hourly) | Open-Meteo forecast API |
| Tide H/L events | NOAA CO-OPS API (station `9410230` — La Jolla) |
| Buoy water temp | NDBC buoy `46025` |
| Chlorophyll | NOAA CoastWatch ERDDAP (14-day mean) |
| Community reports | JustGetWet.com scraper (`community_report.py`) |

All HTTP calls use `_get_json_with_retry()` with 3 retries and exponential backoff.

### ML Model
- **Primary:** `model_lajolla_soft.pkl` — soft probabilistic GBT → grade probabilities (F/D/C/B/A/A+)
- **Fallback:** `model_lajolla.pkl` — point GBT regressor → single visibility estimate
- `model_source` field in output JSON: `"soft_probabilistic"` (primary) or `"point_gbt_fallback"`
- Model is **frozen**. Do NOT retrain unless explicitly authorized. Retrain requires Python 3.11+ and same scikit-learn version.

### Output JSON Shape (key fields in `la-jolla.json`)
```json
{
  "spot": { "slug": "la-jolla", "name": "La Jolla", ... },
  "latest": {
    "date": "2026-MM-DD",
    "grade": "C",
    "grade_probabilities": { "F": 0.01, "D": 0.25, "C": 0.50, "B": 0.24, "A": 0.0, "A+": 0.0 },
    "model_source": "soft_probabilistic",
    "estimated_visibility_range_ft": [8, 15],
    "estimated_visibility_mid_ft": 12.0,
    "confidence": "medium",
    "best_window": "...",
    "risk_factors": [...],
    "positive_factors": [...],
    "tide": { "current_phase": "rising", "next_tide": {...}, "slack_windows": [...] },
    "community_report": { "visibility_ft": [10,15], "weight": 0.8, "confidence_label": "high", ... },
    "buoy_water_temp_f": 62.1,
    "chla_alert": "normal",
    "wave_summary": { ... },
    "swell_components": [...],
    "daily_report": "...",
    ...
  },
  "forecast_10day": [ { "date": "...", "grade": "B", ... }, ... ]
}
```

---

## Frontend (Static Site)

- **Single HTML page** — `index.html` loads `app.js` as ES module
- `app.js` fetches `la-jolla.json` and renders all sections: forecast panel, community report, 10-day strip, tide/wind charts, wave card, weather, fish radar, grade guide
- **Version query strings** control cache-busting: `app.js?v=beta-ui-21`, `styles.css?v=beta-ui-14`, etc. Increment the version number when changing a file.
- Grade guide (`#gradeGuide`) renders from `diveprosd_grade_guidance.json` — shows grade + ft range only (no source label)
- Community report section (`#communitySection`) is hidden by default; shown when `community_report.visibility_ft` is non-null

---

## Failure Alerting
On GitHub Actions workflow failure, a Telegram message is sent to Pat using:
- Bot token + chat ID from `CONFIG_JSON` GitHub Secret
- Message: "DivePro forecast update FAILED. Check GitHub Actions: https://github.com/patdudley/DivePro/actions"

---

## Scripps Pier Camera — CURRENTLY OFFLINE
The `cameraImage` element in the hero shows a **static fallback image** (`viz-mid.jpg`).
The Scripps Pier underwater camera is offline as of early 2026.

**When the camera comes back online:**
1. Re-enable live image fetching in `app.js`
2. Remove the offline banner from `index.html` (if added)
3. Re-enable Claude Vision grading pipeline in `jflacker/divepro` repo
4. Re-enable cron-job.org triggers for the `jflacker/divepro` workflow
5. Uncomment daily report crons in `.github/workflows/divepro-reports.yml`

---

## Tests
```bash
cd ~/projects/divepro-pat
python -m pytest tests/ -q
# All tests must pass cleanly — no warnings allowed
```
5 test files, covering: retry logic, NDBC buoy temp, chlorophyll classification, JustGetWet scraper, tide H/L phase/slack windows.

---

## What NOT To Do
- Do NOT upgrade `scikit-learn` or `joblib` — pickle compatibility will break
- Do NOT retrain the model without explicit authorization
- Do NOT merge PRs — leave merging to the user
- Do NOT approve PRs
- Do NOT hardcode API keys — use `CONFIG_JSON` GitHub Secret
- Do NOT delete rows from `forecast_log.csv`
- Do NOT add `--no-verify` to git commits
- Do NOT add AI co-authorship to commit messages

---

## divepro (jflacker/divepro) — Ghost CMS / Daily Report Repo

**Status: PAUSED** while Scripps camera is offline.

| Item | Detail |
|------|--------|
| Local path | `~/projects/divepro/` |
| GitHub | `git@github.com:jflacker/divepro.git` |
| Platform | Ghost CMS at `diveprosd.com` (Admin API key in `config.json`) |
| Main script | `daily_report.py` — screenshot → Claude vision → Ghost post |
| Screenshot | `scripts/capture_screenshot.py` (Playwright/Chromium, not APIFlash) |
| Vision grading | `scripts/analyze_image.py` (Claude API, piling counting rule) |
| Automation | `.github/workflows/divepro-reports.yml` — 3x/day (7am, noon, 3pm PDT) |
| Test suite | `test_scripts/` — 279 tests, run with `python3 -m pytest test_scripts/ -q` |

This repo is NOT the active development target. Do not modify it unless the camera is back online or explicitly asked.
