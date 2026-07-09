# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Daily La Jolla dive visibility forecast at https://diveprosd.com/ — a static site served by GitHub Pages **directly from the root of `main`**. Every commit to `main` is a production deploy. There is no build step, no staging environment, and no branch protection: the tests-pass PR flow below is the only safety net.

`README.md` covers the model freeze and local build; `AGENT_CONTEXT.md` has the deep pipeline handoff (data sources, output JSON shape, alerting). AGENT_CONTEXT.md is updated less often than the code — verify its claims before acting on them.

## Commands

```bash
python -m pip install -r requirements.txt   # forecast pipeline + test deps
python -m pytest tests/ -q                  # full suite; must be pristine
python -m pytest tests/test_tide_hilo.py -q # single file
python -m pytest tests/test_core_logic.py::test_name -q  # single test
python build_location_forecasts.py          # full forecast build (network calls; appends forecast_log.csv)
python -m http.server 8000                  # serve the site locally from repo root
```

Running the real model needs Python 3.11+ (scikit-learn 1.8.0). On older Pythons the model tests skip and the builder falls back — that's expected locally; CI runs 3.13 and is the real gate.

`requirements-wind.txt` is separate on purpose: it holds the GRIB tooling for the wind-map scripts (`scripts/build_gfs_wind_*.py`), installed only by `update-wind-grid.yml`. When adding a dependency, append to the right file — the forecast and tests workflows install `requirements.txt`, so replacing or trimming it breaks the forecast pipeline and the test suite at once.

## Architecture

Three scheduled GitHub Actions workflows commit generated content straight to `main`:

1. **`update-forecast.yml`** (9 runs/day in UTC retry clusters) runs `build_location_forecasts.py`: fetches marine/weather/tide/buoy/chlorophyll data plus a JustGetWet community report, runs the frozen GBT models, and writes `model_outputs/` (`spots/la-jolla.json` is authoritative; `latest_forecast.json` and `forecast_10day.json` are what the frontend fetches) and appends `forecast_log.csv`. The build **exits non-zero if no model forecast is publishable** (`_assert_publishable`), which skips the commit and fires the Telegram alert (credentials in the `CONFIG_JSON` repo secret). Don't weaken that guard.
2. **`camera-snapshots.yml`** (3 runs/day) captures webcam frames with Playwright and archives the day's forecast into `forecast_history.json` via `scripts/archive_latest_forecast.py`.
3. **`update-wind-grid.yml`** (daily, 17:30 UTC) runs `scripts/build_gfs_wind_grid.py`: downloads regional GFS 10m wind subsets from NOAA NOMADS and rewrites the `data/wind-cropped/` frames + manifest the wind map reads. Daily on purpose — each refresh rewrites ~113 frame files (~0.85MB of git history per run), so don't increase the cadence without weighing repo growth.

The frontend (`index.html` + `app.js` ES module, `spot-map.js` wind map) has no framework and no bundler. Two consequences:

- **It may only fetch files a workflow actually commits** — `model_outputs/*`, `forecast_history.json`, `data/wind-cropped/*`. A fetch path pointing at a file nothing regenerates will serve stale data forever while looking fine in review.
- **Cache busting is manual**: assets load with `?v=name-N` query strings. Bump the version string in `index.html` whenever you change a JS/CSS file, or browsers keep the old one.

`production_features.py` is the feature formula shared with training — it must stay byte-compatible with the frozen model's schema (`model_lajolla_soft_features.json`). Treat it and the `.pkl` files as read-only unless retraining is explicitly authorized.

## Git workflow

- **Never push code changes directly to `main`.** Branch, open a PR, and wait for the `Tests` check to pass. Merging is a human decision.
- **`main` moves ~12 times a day under you** (forecast + snapshot bot commits). `git pull --rebase` before pushing anything, and expect PR branches to need a rebase/merge from `main` if they sit for more than a day.
- **Don't hand-commit generated artifacts** (`model_outputs/`, `forecast_log.csv`, `camera-snapshots/`, `forecast_history.json`) in feature PRs — they conflict with the next bot commit within hours. Let the workflows own those paths.
- `forecast_log.csv` is the append-only prospective-validation record: never delete or rewrite rows, and never rewrite `main` history (it would also fight the bot-commit stream).
- Keep large binaries out of the repo — camera history and wind data have bloated it before; generated wind output is gitignored for that reason.
- After merging anything that touches the pipeline or workflows, don't wait for the cron: trigger **Actions → "Update La Jolla Forecast" → Run workflow**, confirm the log shows `Loaded La Jolla soft probability model`, then check `curl -s https://diveprosd.com/model_outputs/latest_forecast.json` has a non-null `grade` and `model_source: "soft_probabilistic"`. Green checkmarks alone don't prove the site is right — the Jun 2026 outage shipped three days of broken forecasts with every workflow green.

## Other constraints

- The MapTiler key in `map-config.js` is public by design and protected by domain restriction, not secrecy — see the comment block in that file before "fixing" it.
- Public-facing copy must present the forecast as a beta/prospective test — no accuracy claims until the gates in `PROSPECTIVE_VALIDATION_PLAN.md` pass (wording in README's "Public Language" section).
- The Scripps Pier camera is offline; the hero image is a static fallback. Re-enabling steps are in AGENT_CONTEXT.md.
