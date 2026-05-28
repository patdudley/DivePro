# DivePro SD1 — Data Collection Specification
**Version:** 1.1  
**Date:** 2026-05-26  
**Applies to:** All La Jolla dive reports filed on or after 2026-05-26 (prospective data)

Reports filed before this date are designated **development data** and are used only for model training, not prospective evaluation.

---

## Part 1 — Daily Observation Form

Every report must include all **mandatory** fields. Strongly recommended fields should be filled whenever available; their absence is noted but does not exclude the report from evaluation.

### 1.1 Identity and Timing

| Field | Key | Type | Mandatory | Example | Notes |
|---|---|---|---|---|---|
| Date of dive | `date` | YYYY-MM-DD | ✓ | `2026-06-01` | Date of the actual dive, not the date filed |
| Observation time | `obs_time` | HH:MM (24h, local) | ✓ | `09:30` | Time when visibility was assessed underwater |
| Reporter ID | `reporter_id` | string | ✓ | `diver_01` | Anonymized but consistent across all that reporter's entries |
| Site / zone | `site` | string | ✓ | `la_jolla_cove` | See Site Codes below |
| Depth category | `depth_cat` | string | ✓ | `inshore` | `inshore` / `offshore` / `deep` (see definitions) |
| Depth (ft) | `depth_ft` | float | recommended | `40` | Actual dive depth if known |

**Site codes (use exactly as written):**
- `la_jolla_cove` — La Jolla Cove and adjacent kelp, 0–30ft
- `la_jolla_shores` — La Jolla Shores beach and nearshore, 0–20ft
- `la_jolla_canyon_head` — Canyon head, 30–80ft
- `scripps_canyon` — Scripps Canyon rim and walls
- `seven_seas` — 7 Seas reef area
- `south_bird_rock` — South Bird Rock, offshore reef
- `other_lj` — Other La Jolla site (specify in `notes`)

**Depth categories:**
- `inshore`: primary dive area ≤ 25ft
- `offshore`: primary dive area 25–60ft
- `deep`: primary dive area > 60ft

---

### 1.2 Visibility Observation

This is the highest-priority section. **Both a min and max are required** — a single point estimate is only acceptable when conditions were genuinely uniform throughout the dive (note this in `vis_notes`).

| Field | Key | Type | Mandatory | Example | Notes |
|---|---|---|---|---|---|
| Visibility minimum (ft) | `vis_min_ft` | float | ✓ | `15` | Lowest vis observed anywhere on the dive |
| Visibility maximum (ft) | `vis_max_ft` | float | ✓ | `20` | Highest vis observed. If uniform, set equal to min |
| Raw text label | `vis_raw` | string | ✓ | `15-20 ft` | Preserve exactly as you would normally report it |
| Official grade | `vis_grade` | F/D/C/B/A/A+ | ✓ | `B` | Assign based on the DivePro grade table |
| Visibility notes | `vis_notes` | string | optional | `Visibility improved with depth` | Any qualifying context |

**DivePro Grade Table (reference):**

| Grade | Range |
|---|---|
| F | 0 – 4.99 ft |
| D | 5 – 9.99 ft |
| C | 10 – 14.99 ft |
| B | 15 – 24.99 ft |
| A | 25 – 34.99 ft |
| A+ | 35 ft + |

**Range quality guidance:**
- Preferred (< 5ft span): `12-15 ft`, `18-22 ft`, `28-32 ft`
- Acceptable (5–15ft span): `10-20 ft`, `15-25 ft`
- Poor (> 15ft span — included in RPS but excluded from interval metrics): `5-25 ft`, `0-40 ft`
- Wide ranges do not get excluded, but they contribute less information to model calibration.

---

### 1.3 Water Conditions (Observed Underwater)

| Field | Key | Type | Mandatory | Example | Notes |
|---|---|---|---|---|---|
| Surge level | `surge_level` | 0–3 | recommended | `1` | 0=none, 1=mild, 2=moderate, 3=strong |
| Particulate type | `particle_type` | string | recommended | `algae` | `algae`, `sand`, `plankton`, `mixed`, `none`, `unknown` |
| Thermocline present | `thermocline` | 0/1 | recommended | `0` | 1 if clear thermocline at depth |
| Bottom visibility | `bottom_vis` | string | optional | `better` | `better`, `same`, or `worse` than surface |

---

### 1.4 Rain and Runoff

Rain is one of the model's weaker signals (low training coverage). Complete these fields carefully — they are disproportionately valuable.

| Field | Key | Type | Mandatory | Example | Notes |
|---|---|---|---|---|---|
| Rain flag | `rain_flag` | 0/1 | ✓ | `0` | 1 if any measurable rain in the past 7 days |
| Rain in past 24h (in) | `rain_24h_in` | float | recommended | `0.0` | Use NOAA La Jolla gauge or Scripps Pier gauge |
| Rain in past 3 days (in) | `rain_3day_in` | float | recommended | `0.15` | Cumulative |
| Rain in past 7 days (in) | `rain_7day_in` | float | recommended | `0.30` | Cumulative |
| Visible runoff | `runoff_visible` | 0/1 | recommended | `0` | 1 if storm drain or creek outflow visibly discolored |
| Rain source | `rain_source` | string | optional | `NOAA_KSAN` | Station ID used for the precip reading |
| Rain notes | `rain_notes` | string | optional | `Heavy rain 3 days ago, clearing` | Qualitative context |

**Why this matters:** The model currently has a physics override (large swell + heavy rain → capped at 10ft) based on only 12 training examples. Every new co-occurring large-swell + rainy-day report is high-priority ground truth. Fill rain fields even if it has not rained.

---

### 1.5 Scripps Pier Camera Rubric

When the Scripps Institution of Oceanography pier camera is available, apply the following rubric and record the score. This is an independent reference that does not enter the model but validates the observation.

| Field | Key | Type | Mandatory | Example |
|---|---|---|---|---|
| Scripps camera score | `scripps_camera_score` | 1–5 or blank | recommended | `3` |
| Scripps camera time | `scripps_camera_time` | HH:MM | recommended | `09:00` |
| Scripps camera notes | `scripps_camera_notes` | string | optional | `Kelp visible to 15ft depth` |

**Scripps Camera Rubric:**

| Score | Description |
|---|---|
| 1 | Completely turbid — no structure visible |
| 2 | Severely limited — surface chop or green/brown water, < 5ft |
| 3 | Moderate — kelp heads visible, estimated 5–15ft |
| 4 | Good — kelp structure visible with depth, 15–25ft |
| 5 | Excellent — deep structure clearly visible, > 25ft |

If the camera is unavailable or the image is ambiguous, leave blank. Do not estimate.

---

### 1.6 Notes

| Field | Key | Type | Notes |
|---|---|---|---|
| General notes | `notes` | string | Free text. Do NOT include any field that is computable from ocean forecast data (e.g., "big swell today", "NW swell"). Notes should describe what you observed underwater, not what the buoys said. |

---

## Part 2 — Saved Forecast Record

Every model forecast must be logged **before** the corresponding dive report is filed. This is what makes the prospective evaluation legitimate — the forecast is committed to disk at generation time and cannot be retroactively adjusted.

The forecast log lives at: `DiveProUSA/scripts/forecast_log.csv`

It is append-only. Never edit or delete rows.

### 2.1 Forecast Log Fields

| Field | Key | Type | Notes |
|---|---|---|---|
| Forecast run timestamp | `forecast_run_ts` | ISO-8601 UTC | When build_location_forecasts.py generated this row |
| Target date | `target_date` | YYYY-MM-DD | The day this forecast is for |
| Lead time (hours) | `lead_time_h` | integer | Hours between forecast_run_ts and target_date 00:00 local |
| Model version | `model_version` | string | Hash or tag of model_lajolla.pkl at time of run |
| Displayed grade | `displayed_grade` | F/D/C/B/A/A+ | The grade shown to users |
| Displayed range min (ft) | `displayed_range_min_ft` | float | Lower bound shown to users |
| Displayed range max (ft) | `displayed_range_max_ft` | float | Upper bound shown to users |
| Raw model score | `raw_score` | integer 0–100 | Score before any display rounding |
| Raw vis ft (pre-override) | `raw_vis_ft` | float | Model output before physics cap |
| Physics override applied | `physics_override` | 0/1 | 1 if large-swell+rain cap was triggered |
| Grade prob F | `prob_F` | float 0–1 | From soft probabilistic model (if run) |
| Grade prob D | `prob_D` | float 0–1 | |
| Grade prob C | `prob_C` | float 0–1 | |
| Grade prob B | `prob_B` | float 0–1 | |
| Grade prob A | `prob_A` | float 0–1 | |
| Grade prob A+ | `prob_Aplus` | float 0–1 | |
| Input: p1 height ft | `in_p1_h_ft` | float | Primary swell height used |
| Input: p1 period s | `in_p1_per_s` | float | |
| Input: p1 direction deg | `in_p1_dir_deg` | float | |
| Input: p2 height ft | `in_p2_h_ft` | float | |
| Input: p2 period s | `in_p2_per_s` | float | |
| Input: wind gust mph | `in_gust_mph` | float | |
| Input: rain 3-day in | `in_rain_3day_in` | float | |
| Input: rain 7-day in | `in_rain_7day_in` | float | |
| Input: SST F | `in_sst_f` | float | |
| Input: wave yesterday ft | `in_wave_yday_ft` | float | |
| Input: SST anomaly F | `in_sst_anom_f` | float | |
| Input: buoy height ft | `in_buoy_h_ft` | float | |

### 2.2 Why Every Field Is Required

- **forecast_run_ts**: proves the forecast was made before the observation
- **lead_time_h**: longer lead times are expected to be less accurate; must be stratified in prospective evaluation
- **model_version**: allows detecting if a model change occurred between forecast and observation
- **physics_override**: co-occurring large-swell+rain observations matched to override=1 forecasts are the evidence base for re-evaluating the cap
- **prob_F through prob_Aplus**: these are what RPS is computed against — must be logged exactly as shown to users
- **raw_vis_ft / raw_score**: separates the model's output from any display post-processing

### 2.3 Matching Forecasts to Observations

At prospective evaluation time, join on `target_date` = `date`. When multiple forecasts exist for the same target_date (different lead times), evaluate each separately by lead time stratum (≤12h, 12–36h, 36–72h). Only include a forecast in the evaluation if the matching observation was filed after `forecast_run_ts`.

---

## Part 3 — Collection Checklist

Before filing any report used in prospective evaluation, confirm:

- [ ] `date` is the dive date, not today's date
- [ ] `vis_min_ft` and `vis_max_ft` are both recorded (not just a midpoint)
- [ ] `vis_grade` is assigned from the official grade table, not estimated
- [ ] A corresponding forecast row exists in `forecast_log.csv` with `target_date` = this date AND `forecast_run_ts` < this observation filing time
- [ ] Rain fields filled even if zero
- [ ] `reporter_id` is consistent (same ID across all your reports)
- [ ] No forecast-available data in the `notes` field (no "NW swell", "big surf", etc.)

---

## Part 4 — Fields NOT to Record in Observations

The following are not to be collected in the observation form. They are either available from weather APIs at forecast time (and therefore not independent ground truth) or were identified as leaky features:

- Swell height, period, direction (these are model inputs, not observations)
- Wind speed or direction
- Any composite score derived from the visibility reading
- Chlorophyll or discharge values
- Any text that describes ocean conditions rather than underwater observations

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-26 | v1.1 — initial full spec; observation form + forecast log schema |
