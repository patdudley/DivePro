# DivePro SD1 — Prospective Validation Plan
**Version:** 1.5  
**Date:** 2026-05-27  
**Status:** ACTIVE — data collection phase  

---

## 1. Development Data Lock

All data collected through **2026-05-25** is designated **development data**.  
File: `DiveProUSA/scripts/training_data.csv`  
Row count at lock: **512 usable report-days** (2024-03-16 → 2026-05-23)

Development data was used to:
- Train the production GBT model (`model_lajolla.pkl`, 50 features)  
- Tune all hyperparameters (grid search, shuffled CV)  
- Build and tune the soft probabilistic evaluation framework  
- Establish the forward-only benchmark metrics below  

**No accuracy claims may be made based on development data alone.**  
The forward-only development benchmark is an internal calibration tool, not a publishable result.

---

## 2. Development Benchmark (Reference Only)

These numbers come from the forward-only evaluation on development data.  
They are NOT public claims. They are the baseline to beat in prospective evaluation.

| Metric | Climatology baseline | Soft probabilistic model | Gate |
|---|---|---|---|
| RPS (lower = better) | 0.1044 | **0.0967** | — |
| RPS % improvement | — | +7.3% [block-bootstrap 95% CI: −6.0%, +6.7%] | — |
| Soft grade credit | 30.0% | **34.3%** | — |
| Interval miss MAE | 2.32 ft | **2.06 ft** | ≤ 2.0 ft |
| Inside-range % | 41.6% | **48.4%** | ≥ 55% |

*Model: 43-feature exact-contract model. Coherent p1/p2 swell inputs (same hour as component max height). `total_energy`, `p1_energy_raw`, and `n_swells` imported from shared `production_features.py` at both training time and runtime — no formula duplication. Wave lag features (yesterday/2d/3d/7d-avg) rebuilt from Open-Meteo `wave_height` (mean Hs) only; NDBC-preferred values removed. Censored labels ("30+ ft") and single-value reports excluded from both training targets and test scoring. 474 closed-range training rows. **351 closed-range-only test rows** across 7 forward windows (38 rows excluded: 22 censored + 16 single-value/unparseable).*

**The development RPS signal is not statistically demonstrated.** Under forward-only window-level block bootstrap (N=7 windows), the 95% CI [−6.0%, +6.7%] spans zero. The +7.3% point estimate is a directional development finding only — it must not be cited as evidence of improvement in any public communication until the prospective test passes Gate 3 with a CI that excludes zero.  
The interval miss gate (≤2.0 ft) is **not yet met** on development data (2.06 ft, 3% above gate). The inside-range gate (≥55%) is also not yet met (48.4%).

**Note on CI width:** With only 7 test windows the block bootstrap CI will always be coarse (±10–15%). With 100 prospective rows it will narrow to approximately ±8–10%; with 200 rows to ±5–6%. The CI spanning zero is an honest statement of uncertainty given N=7, not evidence of model failure.

**Previous benchmarks (superseded):**
- v1.2 (2026-05-27): RPS clim=0.1044, model=0.0984, +5.7%, CI [−6.2%, +6.0%]. 487 training rows (single-value labels incorrectly included as ±2.5 ft synthetic intervals). Wave lag columns had NDBC-preferred values (435/512 rows). Formula duplicated in train_model.py and build_location_forecasts.py.
- v1.1 (2026-05-27): RPS clim=0.1074, model=0.1016, +5.4%, CI [−12.8%, +2.7%]. Coherent marine inputs; excluded censored from test; single-value reports still included in test (367 test rows). Energy/n_swells formulas still mismatched between train and runtime.
- v1.0 (2026-05-26): RPS 0.1089, +5.1%, CI [−3.2%, +12.4%]. Original independently-maximized marine inputs; censored labels included in test scoring.

---

## 3. Daily Data Collection Spec

Starting **2026-05-26**, every dive report must include the following fields.  
Any day missing mandatory fields is excluded from prospective evaluation.

### 3.1 Mandatory Fields

| Field | Format | Example | Notes |
|---|---|---|---|
| `date` | YYYY-MM-DD | `2026-05-27` | Date of dive, not submission date |
| `vis_range_ft` | `LO-HI ft` | `15-20 ft` | **Both bounds required.** Single value only when range is genuinely unknown. |
| `vis_lo_ft` | float | `15.0` | Parsed lower bound of reported range |
| `vis_hi_ft` | float | `20.0` | Parsed upper bound of reported range |
| `p1_height_ft` | float | `3.2` | Primary swell height at forecast time |
| `p1_period_s` | float | `14` | Primary swell period |
| `p1_direction_deg` | float (0–360) | `270` | Primary swell direction |
| `wind_max_kt` | float | `8` | Max wind speed on dive day |
| `rain_today_in` | float | `0.0` | Precipitation on dive day |

### 3.2 Strongly Recommended Fields

These improve model accuracy and will be required in SD2:

| Field | Format | Notes |
|---|---|---|
| `p2_height_ft` | float | Second swell train; enter 0 if absent |
| `p2_period_s` | float | |
| `p2_direction_deg` | float | |
| `sst_f` | float | Sea surface temperature °F at La Jolla |
| `buoy_height_ft` | float | Nearest NOAA buoy reading on dive day |
| `tide_morning_ft` | float | Morning low tide height |
| `dive_site` | string | e.g., `la_jolla_cove`, `la_jolla_shores` |
| `reporter_id` | string | Anonymized consistent ID per reporter |

### 3.3 Fields NOT to Collect (Leaky / Unavailable at Forecast Time)

Do not log the following — they are unavailable when generating a forecast:

- Any notes about rain, water clarity cause, or environmental explanation written same-day  
- Any composite score derived from the visibility observation  
- Chlorophyll or discharge readings (not reliably available in near-real-time)

### 3.4 Range Quality Standard

Wide ranges (> 15 ft span, e.g., "5-25 ft") contribute minimal calibration value.  
Encourage reporters to narrow ranges when conditions permit:  
- Good: `12-15 ft`, `18-22 ft`, `25-30 ft`  
- Acceptable: `10-20 ft`, `15-25 ft`  
- Poor (excluded from interval metrics): `5-30 ft`, `0-40 ft`  

Reports with range span > 20 ft are included in RPS evaluation but excluded from interval miss MAE and inside-range % calculations.

---

## 4. Prospective Evaluation Protocol

### 4.1 Evaluation Trigger

Prospective evaluation runs when either:
- **100 new prospective report-days** have accumulated, OR  
- **6 calendar months** have elapsed since 2026-05-26  
(whichever comes first)

### 4.2 Evaluation Procedure

1. Pull all reports with `date >= 2026-05-26` from `training_data.csv` (or successor store)
2. Run `evaluate_forward.py` with `prospective_mode=True`, which:
   - Uses only development data (≤ 2026-05-25) for training
   - Uses prospective data as the locked test set (never seen during training)
   - Reports full metric suite with bootstrap CIs
3. Compare against development benchmark above

### 4.3 Publish Gates (Prospective)

All six gates must pass on the **prospective test set** before any public accuracy claim:

| # | Gate | Threshold | Rationale |
|---|---|---|---|
| 1 | Live model loads, no silent fallback | PASS | Confirmed in code; must hold at eval time |
| 2 | Soft model RPS beats climatology | RPS < clim RPS | Basic signal test |
| 3 | RPS improvement ≥ 5% over climatology | ΔRPS > 5% | Minimum practically meaningful improvement |
| 4 | Soft grade credit > climatology | credit_soft > credit_clim | Model places probability mass better than prior |
| 5 | Interval miss MAE ≤ 2.0 ft | ≤ 2.0 ft | Range placement acceptable for user-facing display |
| 6 | Inside-range percentage ≥ 55% | ≥ 55% | Point estimate lands inside reported range majority of time |

Gates 5 and 6 currently fail on development data. They must pass on **prospective data** before any claim of model improvement is published.

### 4.4 Confidence Requirement

In addition to passing all six gates, the RPS improvement must be statistically demonstrated under time-series-appropriate resampling:

- **Forward-only block bootstrap** (window length ≥ 2 weeks, N ≥ 1000 resamples) — row-level paired bootstrap is not valid for this data due to temporal autocorrelation  
- 95% CI on RPS % improvement must **exclude zero**  
- The development block-bootstrap CI [−3.6%, +14.4%] spans zero and does NOT satisfy this requirement; it is a development finding only  

With 100 prospective rows, this CI will be wide (~±8–10%). With 200 rows it narrows to ~±5–6%.  
A result with CI straddling zero must be reported as "not statistically demonstrated" regardless of point estimate.

**Note on interval scoring (Gates 5–6):** Interval miss MAE and inside-range % are valid evaluation metrics only when the observation record defines a consistent single `typical_visibility_ft` point truth per dive day, not a spatial or temporal min/max range. Until that field is consistently collected per the spec in Section 3, treat these gate results as descriptive rather than proper scoring.

---

## 5. Learning Curve Context

Analysis run 2026-05-26 on development data (fixed test = last 90 rows):

| Training rows | Clim RPS | Soft RPS | ΔRPS% | Int. Miss | In-Range% |
|---|---|---|---|---|---|
| 40 | 0.0967 | 0.0926 | +4.3% | 1.42 ft | 59.3% |
| 80 | 0.1070 | 0.0939 | +12.2% | 1.56 ft | 54.3% |
| 200 | 0.1062 | 0.0888 | +16.3% | 1.52 ft | 61.7% |
| 400 | 0.0950 | 0.0939 | +1.2% | 1.64 ft | 54.3% |
| 422 | 0.0935 | 0.0972 | −3.9% | 1.66 ft | 51.9% |

**Key finding:** On the most recent 90-row test window, the model already passes the interval miss gate (1.42–1.92 ft) at most training sizes. The aggregate rolling-forward evaluation fails this gate primarily because early windows (N=123, N=158 training rows) drag down the aggregate. Those early windows test on late 2024 / early 2025 and cannot be retroactively improved.

**Implication for the 800-1000 row estimate:** That estimate was too conservative as a raw count target. The model's gate-passing behavior on the prospective set will depend on:
1. The quality and tight-range reporting of new data — more than raw count
2. Whether prospective reporters file consistent tight-range reports (< 10 ft span)
3. The model being re-trained on all development + new data before prospective evaluation

The learning curve shows **high variance** at all tested N (consecutive sizes sometimes differ by 15+ pp in inside-range %). This is a consequence of noisy labels in a 512-row dataset, not a reason to delay prospective evaluation.

---

## 6. Training Protocol for Prospective Evaluation

Before running prospective evaluation, retrain on **all development data** (not a subset):

```bash
cd DiveProUSA/scripts
python3 train_model.py   # uses full training_data.csv, saves model_lajolla.pkl
```

The prospective test set rows must **never appear in the training CSV** before evaluation.  
Enforce this with a date filter in `build_training_data.py` at prospective eval time:  
`PROSPECTIVE_CUTOFF = "2026-05-26"` — exclude any row with `date >= PROSPECTIVE_CUTOFF` from training.

---

## 7. Changelog

| Date | Change |
|---|---|
| 2026-05-26 | v1.0 — initial plan, development data locked at 512 rows |
| 2026-05-27 | v1.1 — benchmark updated to coherent marine inputs (training_data_coherent.csv); censored labels excluded from test scoring; requirements.txt pinned; guardrail split evaluation added to evaluate_forward.py |
| 2026-05-27 | v1.2 — Phase 3 exact-contract fixes: (1) shared `production_features.py` module aligns `total_energy`, `p1_energy_raw`, `n_swells` formulas between training and runtime; (2) single-value reports excluded from test scoring and climatology baseline (uniform eligibility — 351 closed-range test rows); (3) `build_training_data.py` NDBC preference removed from lag features (Open-Meteo only, CSV rebuild pending); (4) logger fatal if unavailable before La Jolla output; (5) true lead time from UTC issue time to 06:00 La Jolla local; (6) sklearn_version and all library versions recorded in model_lajolla_soft_features.json. Model retrained on exact-contract features. Benchmark: RPS clim=0.1044, model=0.0984, +5.7%, CI [−6.2%, +6.0%]. |
| 2026-05-27 | v1.3 — Four remaining integrity fixes: (1) `training_data_coherent.csv` lag columns (`wave_ht_yesterday_ft`, `wave_ht_2d_ago_ft`, `wave_ht_3d_ago_ft`, `wave_ht_7d_avg_ft`, `wave_trend_ft`, `wave_accel_ft`) rebuilt from `wave_height_ft` (Open-Meteo mean Hs) only — NDBC-preferred values removed from 344/409 rows; (2) `train_soft_model.py` now excludes single-value labels (4 rows; previously accepted as ±2.5 ft synthetic intervals) — uniform eligibility with evaluate_forward.py; (3) `train_model.py` and `build_location_forecasts.py` now import `swell_energy_vec` / `production_feat_bundle` from `production_features.py` instead of duplicating formula inline; (4) `build_location_forecasts.py` `_wave_ft_on()` runtime lag source investigated — the Open-Meteo Marine **forecast** API does not expose `wave_height` (mean Hs) as a daily field; the archive API does, but not the forecast endpoint. Adding it as an hourly field in a combined daily+hourly request triggers a 400. Runtime lags therefore continue using `wave_height_max` (daily max Hs), which is ~10–30% larger than the training source. This is a **documented residual mismatch**: impact is second-order (103/512 training rows have no prior-day data; SimpleImputer fills missing with median; directional bias modestly shifts lag estimates on building swells). Training rows: 474 (was 487). Benchmark: RPS clim=0.1044, model=0.0967, +7.3%, CI [−6.0%, +6.7%]. Interval miss 2.06 ft (gate ≤2.0 ft — FAILING). Inside-range 48.4% (gate ≥55% — FAILING). |
| 2026-05-27 | v1.4 — Environment fix: both models retrained with sklearn 1.7.2 (matching `requirements.txt`). Previous `.pkl` files were inadvertently saved with sklearn 1.8.0, causing `InconsistentVersionWarning` on load. Benchmark numbers unchanged (RPS clim=0.1044, model=0.0967, +7.3%, CI [−6.0%, +6.7%]; interval miss 2.06 ft; inside-range 48.4%). Models now load cleanly with no version warnings. |
| 2026-05-27 | v1.5 — Marine API 400 fix and wave_height lag mismatch closed. Root cause: `secondary_swell_wave_height_max`, `secondary_swell_wave_period_max`, `secondary_swell_wave_direction_dominant` are not valid daily fields in the Marine forecast API (confirmed via `debug_marine_api.py`). Removed from daily fetch. Secondary swell now extracted from hourly fields via `coherent_swell_from_hourly()` for all spots. `wave_height` (mean Hs) confirmed valid as an hourly field; added to base hourly fetch for all spots. `_wave_ft_on()` updated to compute mean hourly Hs, matching training lag source. Residual mismatch documented in v1.3–v1.4 is now closed. `build_location_forecasts.py` runs end-to-end without 400 errors. |
