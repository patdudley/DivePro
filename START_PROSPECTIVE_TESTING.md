# Start Prospective Testing

The La Jolla beta forecast has completed a clean local live build and is ready to be logged prospectively.

This does not mean it is publish-validated. It means future forecasts can now be saved before observations arrive and compared honestly later.

## Frozen Candidate

- Model source: `soft_probabilistic`
- Model file: `scripts/model_lajolla_soft.pkl`
- Model hash: `8420e902f1b3ccfe966fcf1ae5e55a42a4347872e360b5bbe4ee823e61120fab`
- Feature schema: `scripts/model_lajolla_soft_features.json`
- Feature schema hash: `6681a273d30c818d862374da7bcf41201d90f0566b83b78faa909d4cf7e18e85`
- Forecast file: `model_outputs/spots/la-jolla.json`
- Forecast log: `scripts/forecast_log.csv`

## What To Record For Each New Dive Report

- observation date
- site or zone
- observation time
- depth or inshore/offshore
- visibility min and max
- official daily grade: F, D, C, B, A, or A+
- rain/runoff notes
- surge/current/green-water notes
- Scripps camera rubric when available
- original report text or screenshot/link

## Rules During The Test

- Forecast must be saved before the dive report is known.
- Do not tune the model during the locked test window.
- Do not add prospective rows into training until the evaluation checkpoint.
- Keep model hash and feature schema hash attached to each forecast log row.
- Keep the large-swell plus rain guardrail unless prospective validation supports changing it.

## Why No Accuracy Claim Yet

Development evaluation improved over climatology, but the block-bootstrap confidence interval still spans zero and the interval/inside-range gates have not passed. Public claims wait until the locked prospective test passes.
