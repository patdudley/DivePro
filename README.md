# DivePro La Jolla Forecast Beta

This is the GitHub Pages-ready beta forecast site for La Jolla.

Status: prospective testing only. The model is not validated for public accuracy claims yet.

## What Is Included

- Static site: `index.html`, `spots/la-jolla/`, `src/forecast/`, `assets/`
- Latest forecast data: `model_outputs/spots/la-jolla.json`
- Forecast generator: `scripts/build_location_forecasts.py`
- Soft probabilistic model: `scripts/model_lajolla_soft.pkl`
- Forecast logger: `scripts/forecast_log.csv`
- GitHub Action: `.github/workflows/update-forecast.yml`

## Model Freeze

- Model: `model_lajolla_soft.pkl`
- Model hash: `8420e902f1b3ccfe966fcf1ae5e55a42a4347872e360b5bbe4ee823e61120fab`
- Feature schema hash: `6681a273d30c818d862374da7bcf41201d90f0566b83b78faa909d4cf7e18e85`
- Python: 3.13
- scikit-learn: 1.8.0

## Local Build

```bash
cd scripts
python build_location_forecasts.py
```

Expected result:

- `model_outputs/spots/la-jolla.json` updates
- `scripts/forecast_log.csv` gets new rows
- output says `Done. 1 spots written.`
- latest model source is `soft_probabilistic`

## GitHub Pages Automation

The included GitHub Action runs around 6am, noon, and 6pm Pacific during PDT, then commits updated forecast artifacts back to the repo.

GitHub Pages should be configured to serve from the repository root on the main branch.

## Public Language

Use language like:

> La Jolla Forecast Beta. This is a prospective test forecast and should be used as decision support only. Accuracy claims are not validated yet.

Do not claim verified accuracy until the prospective validation gates in `PROSPECTIVE_VALIDATION_PLAN.md` pass.
