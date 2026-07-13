# La Jolla visibility v2 runbook

The current production pickle remains the serving model. The v3 display policy
is a display-only correction; it is not evidence that model accuracy improved.

## Recovery gate

Jackson must export the original training assets into a private working folder.
Do not commit them to this public repository. Verify completeness and record
hashes with:

```bash
python scripts/check_visibility_training_assets.py /private/path/to/recovery
```

Training is blocked until that command reports `"ready": true`. The audit report
from `scripts/train_visibility_v2.py --audit-only` must then be reviewed for
grade support, summer grade distribution, source parity, duplicates, location
mixing, missingness, and correlated features.

## Train candidates

The input CSV must contain closed visibility ranges and the 14 columns in
`visibility_v2_features.FEATURE_NAMES`. Calendar encodings are prohibited.

```bash
python scripts/train_visibility_v2.py /private/path/to/v2-training.csv \
  --out-model model_lajolla_v2.pkl \
  --out-report /private/path/to/model_lajolla_v2_report.json
```

The trainer uses rolling-origin blocks only. It selects the robust linear model
when its combined MAE/interval score is within 5% of constrained quantile
boosting. The model artifact records training-data and feature-schema hashes.

## Shadow operation

Placing `model_lajolla_v2.pkl` at the repository root enables shadow logging on
forecast runs. It cannot change the public grade or JSON. Candidate rows append
to `shadow_forecast_log_v2.csv` using the same immutable `forecast_id` as the
current model. Deleting the v2 artifact disables shadow mode in one step.

The private evaluation repository joins that log to private observations via
`scripts/evaluate_shadow.py`. Promotion is fail-closed until all checks in
`config/shadow_gate_results.json` are true and at least 30 unique prospective
observation days satisfy every preregistered gate. Persistence is reported only;
it is not a feature or promotion requirement.

## Rollback

The production artifacts `model_lajolla_soft.pkl` and
`model_lajolla_soft_features.json` are never modified by the v2 trainer. To stop
shadow mode, remove `model_lajolla_v2.pkl`. A future production promotion must be
a separate reviewed change that preserves the current artifacts for rollback.
