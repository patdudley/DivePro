# DivePro La Jolla Forecast

Daily La Jolla dive visibility forecast for San Diego shore divers, served at
https://diveprosd.com/ via GitHub Pages from the repository root on `main`.

Status: prospective testing only. The model is not validated for public accuracy claims yet.

For a full agent/developer handoff (pipeline details, data sources, constraints), see `AGENT_CONTEXT.md`.

## Repository Layout

All files live at the repository root (flat layout):

- Static site: `index.html`, `app.js`, `ui-polish.js`, `styles.css`, `ui-polish.css`
- Analytics: `analytics.js`, `analytics-config.js`
- Forecast generator: `build_location_forecasts.py` (plus `production_features.py`, `community_report.py`)
- Soft probabilistic model: `model_lajolla_soft.pkl` (+ `model_lajolla_soft_features.json`)
- Point-model fallback: `model_lajolla.pkl` (+ `model_lajolla_features.json`)
- Forecast log: `forecast_log.csv` (append-only — never delete rows)
- Generated output: `model_outputs/spots/la-jolla.json` (authoritative, served directly by Pages)
- GitHub Action: `.github/workflows/update-forecast.yml`
- Tests: `tests/`

## Model Freeze

- Model: `model_lajolla_soft.pkl`
- Model hash: `8420e902f1b3ccfe966fcf1ae5e55a42a4347872e360b5bbe4ee823e61120fab`
- Feature schema hash: `6681a273d30c818d862374da7bcf41201d90f0566b83b78faa909d4cf7e18e85`
- Python: 3.13
- scikit-learn: 1.8.0 (pinned — do not upgrade; pickle compatibility will break)

## Local Build

```bash
python -m pip install -r requirements.txt
python build_location_forecasts.py
```

Expected result:

- `model_outputs/spots/la-jolla.json` updates
- `forecast_log.csv` gets new rows
- output says `Done. 1 spots written.`
- latest model source is `soft_probabilistic`

Note: running the soft model requires Python 3.11+ for scikit-learn 1.8.0. On older
Pythons the script falls back to the heuristic/point model.

## Tests

```bash
python -m pytest tests/ -q
```

## GitHub Pages Automation

`.github/workflows/update-forecast.yml` runs the forecast builder on a UTC cron
(retry clusters just after midnight, ~7am, and ~noon Pacific) and commits the
updated `model_outputs/` artifacts back to `main`, where GitHub Pages serves
them directly. On failure it sends a Telegram alert (credentials in the
`CONFIG_JSON` repository secret).

## Public Language

Use language like:

> La Jolla Forecast Beta. This is a prospective test forecast and should be used as decision support only. Accuracy claims are not validated yet.

Do not claim verified accuracy until the prospective validation gates in `PROSPECTIVE_VALIDATION_PLAN.md` pass.
