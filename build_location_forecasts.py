#!/usr/bin/env python3
"""
build_location_forecasts.py  —  DivePro SD1
===========================================
Generates daily dive visibility forecast JSON for configured spots.

PRODUCTION NOTES (2026-05-26 patch):
  - This model covers La Jolla reporting area ONLY.
    Training labels are La Jolla DivePro reports.
    Do NOT claim broader geographic coverage.
  - Model output is NOT validated for public accuracy claims.
    See PROSPECTIVE_VALIDATION_PLAN.md for the publish gate.
  - The displayed grade and probability vector come from the soft probabilistic
    model (model_lajolla_soft.pkl) when it is present.  If only the point GBT
    regressor is loaded, grades use the official visibility-band mapping and the
    output is labeled "point_model_fallback" — not the probability model being
    evaluated with RPS.
  - Every issued forecast is appended to forecast_log.csv BEFORE the output JSON
    is written.  Do not edit or delete forecast_log.csv rows.

P0 fixes applied in this version:
  P0-1  Display dates filter to >= local today; all feature lookups are
        date-keyed (not array-index-keyed); hard assert latest.date == today.
  P0-2  Official grade from visibility bands (F/D/C/B/A/A+), not score thresholds.
  P0-3  Soft probability model served and logged when available.
  P0-4  Scope renamed to La Jolla; San Diego County label removed.
  P0-5  Frontend fallback is explicitly labeled unvalidated; model failure
        returns a stale/unavailable state, not silent heuristic output.

P1 fixes applied in this version:
  P1-1  Coherent swell: primary height/period/direction from same hourly event.
  P1-2  Buoy proxy documented; p3 excluded from active feature paths.
  P1-3  Rain prior windows exclude the target date:
          rain_prior_3day_in  = sum of precip for days [T-1, T-2, T-3]
          rain_prior_7day_in  = sum of precip for days [T-1 .. T-7]
          rain_target_day_forecast_in = target-date forecast precip (separate)
"""

import json
import math
import shutil
import urllib.parse
from datetime import date as _date_cls, datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # Python 3.8

# Flat repo layout: this script lives at the repo root alongside its outputs.
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "model_outputs"
SPOT_OUT = OUT / "spots"
FORECAST_LOG_PATH = Path(__file__).parent / "forecast_log.csv"
SHADOW_LOG_PATH = Path(__file__).parent / "shadow_forecast_log_v2.csv"

# ── Import shared production feature formulas ─────────────────────────────────
# production_feat_bundle computes p1_energy_raw, total_energy, n_swells using
# the authoritative formula (h^2 * max(per,1.0) * 0.72).  This MUST be identical
# to the formula used at training time in train_model.py.  Do NOT duplicate it.
import importlib.util as _ilu_pf_blf
_pf_spec_blf = _ilu_pf_blf.spec_from_file_location(
    "production_features", Path(__file__).parent / "production_features.py")
_pf_mod_blf = _ilu_pf_blf.module_from_spec(_pf_spec_blf)
_pf_spec_blf.loader.exec_module(_pf_mod_blf)
_production_feat_bundle = _pf_mod_blf.production_feat_bundle
del _ilu_pf_blf, _pf_spec_blf, _pf_mod_blf

# ── Soft probabilistic model (primary: F/D/C/B/A/A+ grade probabilities) ─────
_LAJOLLA_SOFT_MODEL    = None
_LAJOLLA_SOFT_FEATURES = None
_LAJOLLA_SOFT_GRADES   = ["F", "D", "C", "B", "A", "A+"]
_LAJOLLA_SOFT_BAND_MIDS = [2.5, 7.0, 12.0, 19.5, 30.0, 40.0]

def _load_lajolla_soft_model():
    global _LAJOLLA_SOFT_MODEL, _LAJOLLA_SOFT_FEATURES
    model_path = Path(__file__).parent / "model_lajolla_soft.pkl"
    feat_path  = Path(__file__).parent / "model_lajolla_soft_features.json"
    if not model_path.exists():
        print("  NOTE: model_lajolla_soft.pkl not found — run train_soft_model.py to generate it.")
        return
    try:
        import joblib, json as _json
        _LAJOLLA_SOFT_MODEL    = joblib.load(model_path)
        meta = _json.loads(feat_path.read_text())
        _LAJOLLA_SOFT_FEATURES = meta["features"]
        print(f"  Loaded La Jolla soft probability model ({model_path.stat().st_size // 1024} KB, "
              f"{len(_LAJOLLA_SOFT_FEATURES)} features)")
    except Exception as e:
        print(f"  WARNING: could not load soft model: {e}")

# ── Point GBT regressor (fallback only when soft model absent) ────────────────
_LAJOLLA_MODEL    = None
_LAJOLLA_FEATURES = None

def _load_lajolla_model():
    global _LAJOLLA_MODEL, _LAJOLLA_FEATURES
    model_path = Path(__file__).parent / "model_lajolla.pkl"
    feat_path  = Path(__file__).parent / "model_lajolla_features.json"
    if not model_path.exists():
        return
    try:
        import joblib, json as _json
        _LAJOLLA_MODEL    = joblib.load(model_path)
        _LAJOLLA_FEATURES = _json.loads(feat_path.read_text())["features"]
        print(f"  Loaded La Jolla point GBT model (fallback) ({model_path.stat().st_size // 1024} KB)")
    except Exception as e:
        print(f"  WARNING: could not load point model: {e}")

_load_lajolla_soft_model()
_load_lajolla_model()

# ── Optional v2 shadow candidate (never controls public output) ───────────────
_LAJOLLA_V2_ARTIFACT = None
_LAJOLLA_V2_ARTIFACT_PATH = ROOT / "model_lajolla_v2.pkl"
if _LAJOLLA_V2_ARTIFACT_PATH.exists():
    try:
        import joblib as _joblib_v2
        _LAJOLLA_V2_ARTIFACT = _joblib_v2.load(_LAJOLLA_V2_ARTIFACT_PATH)
        print("  Loaded La Jolla v2 candidate in shadow-only mode.")
    except Exception as _v2_load_error:
        print(f"  WARNING: v2 shadow candidate disabled: {_v2_load_error}")

# ── Prospective forecast logger ───────────────────────────────────────────────
try:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent))
    from prospective_forecast_logger import append_forecast_row, file_sha256, utc_timestamp_now
    _LOGGER_AVAILABLE = True
    print("  Prospective forecast logger ready.")
except ImportError as _e:
    print(f"  NOTE: prospective_forecast_logger not available — forecasts will not be logged: {_e}")
    _LOGGER_AVAILABLE = False
    def append_forecast_row(*a, **kw): pass
    def file_sha256(p): return "unavailable"
    def utc_timestamp_now(): return datetime.utcnow().isoformat() + "Z"

try:
    import community_report as _cr_mod
    _COMMUNITY_REPORT_AVAILABLE = True
except ImportError as _cr_err:
    _COMMUNITY_REPORT_AVAILABLE = False
    print(f"  NOTE: community_report unavailable ({_cr_err}) — community data will be skipped")

# ── External data fetchers (chlorophyll, NDBC buoy, tide H/L, HTTP retry) ────
# Moved to data_sources.py; re-imported here so all existing call sites and
# test patch targets keep working.
from data_sources import (
    get_json,
    _get_json_with_retry,
    api_url,
    _fetch_chla_recent,
    _fetch_ndbc_water_temp,
    _fetch_tide_hilo,
)

_CHLA_YELLOW_RAW = 0.8   # mg/m³ — elevated, visibility may be affected
_CHLA_RED_RAW    = 1.5   # mg/m³ — high, pea-soup conditions possible

PUBLIC_FEATURE_DENY_SUBSTRINGS = (
    "chla",
    "chlorophyll",
    "satellite",
)


def public_feature_payload(features: dict) -> dict:
    """Return feature fields safe for public display/runtime JSON."""
    return {
        key: value
        for key, value in features.items()
        if not any(token in key.lower() for token in PUBLIC_FEATURE_DENY_SUBSTRINGS)
    }


def _classify_chla(chla_log):
    if chla_log is None:
        return "UNKNOWN", "No satellite data available"
    raw = math.expm1(chla_log)
    if raw >= _CHLA_RED_RAW:
        return "RED", "High chlorophyll — reduced visibility likely"
    if raw >= _CHLA_YELLOW_RAW:
        return "YELLOW", "Elevated chlorophyll — visibility may be affected"
    return "GREEN", "Chlorophyll normal"


# ══════════════════════════════════════════════════════════════════════════════
# GRADE FUNCTIONS — official F/D/C/B/A/A+ visibility bands
# ══════════════════════════════════════════════════════════════════════════════

def grade_from_visibility(vis_ft: float) -> str:
    """
    Official DivePro grade from predicted visibility in feet.
    Maps directly to the product grade bands — NOT through a score.

    Grade | Visibility
    F     | 0 – 4.99 ft
    D     | 5 – 9.99 ft
    C     | 10 – 14.99 ft
    B     | 15 – 24.99 ft
    A     | 25 – 34.99 ft
    A+    | 35 ft +
    """
    if vis_ft < 5.0:
        return "F"
    if vis_ft < 10.0:
        return "D"
    if vis_ft < 15.0:
        return "C"
    if vis_ft < 25.0:
        return "B"
    if vis_ft < 35.0:
        return "A"
    return "A+"

# Regression tests — run at import
assert grade_from_visibility(4.9)  == "F"
assert grade_from_visibility(5.0)  == "D"
assert grade_from_visibility(9.9)  == "D"
assert grade_from_visibility(10.0) == "C"
assert grade_from_visibility(14.9) == "C"
assert grade_from_visibility(15.0) == "B"
assert grade_from_visibility(24.9) == "B"
assert grade_from_visibility(25.0) == "A"
assert grade_from_visibility(34.9) == "A"
assert grade_from_visibility(35.0) == "A+"


def visibility_range_from_grade(grade: str) -> list:
    """Official visibility range [lo, hi] in feet for a given grade."""
    bands = {
        "F":  [0,  4],
        "D":  [5,  9],
        "C":  [10, 14],
        "B":  [15, 24],
        "A":  [25, 34],
        "A+": [35, 45],
    }
    return bands.get(grade, [0, 4])


def visibility_midpoint_from_grade(grade: str) -> float:
    """Official displayed visibility midpoint for a given grade."""
    lo, hi = visibility_range_from_grade(grade)
    return round((lo + hi) / 2.0, 2)


def median_grade_from_probabilities(probabilities: dict) -> str:
    """
    Median grade from an ordered probability vector.

    Grades are ordered worst -> best: F, D, C, B, A, A+.
    The median is the first grade where cumulative probability crosses 0.5.
    """
    cumulative = 0.0
    for grade in _LAJOLLA_SOFT_GRADES:
        cumulative += float(probabilities.get(grade, 0.0) or 0.0)
        if cumulative >= 0.5:
            return grade
    return _LAJOLLA_SOFT_GRADES[-1]


# ══════════════════════════════════════════════════════════════════════════════
# DATE-KEYED HELPERS  —  P0-1 / P1-3
# ══════════════════════════════════════════════════════════════════════════════

def value_on_date(daily: dict, key: str, target_date: str, fallback=None):
    """
    Look up a daily API value by matching the date string, not by array index.
    This is the correct approach when past_days are included in the response,
    because array positions no longer correspond to display-day positions.
    """
    times = daily.get("time") or []
    try:
        idx = times.index(target_date)
    except ValueError:
        return fallback
    values = daily.get(key) or []
    if idx >= len(values) or values[idx] is None:
        return fallback
    return values[idx]


def previous_date(target_date: str, days_back: int) -> str:
    """Return the ISO date string for target_date minus days_back days."""
    return str(_date_cls.fromisoformat(target_date) - timedelta(days=days_back))


def rain_prior_window(weather_daily: dict, target_date: str, n_days: int) -> float:
    """
    Sum of precipitation for the n_days BEFORE target_date (excludes target date).
    This matches the training definition of precip_3day_in and precip_7day_in.

    Training:  precip_3day_in  = days [T-1, T-2, T-3]  (excludes day of report)
    Runtime:   rain_prior_3day_in = same definition
    """
    total = 0.0
    for k in range(1, n_days + 1):
        d = previous_date(target_date, k)
        v = value_on_date(weather_daily, "precipitation_sum", d)
        if v is not None:
            total += float(v)
    return round(total, 4)


# ══════════════════════════════════════════════════════════════════════════════
# COHERENT SWELL EXTRACTION  —  P1-1
# ══════════════════════════════════════════════════════════════════════════════

def coherent_swell_from_hourly(marine_hourly: dict, target_date: str):
    """
    Select primary and secondary swell height/period/direction from the same
    hourly event on target_date, rather than taking daily max height and daily
    max period independently (which may come from different hours).

    Primary:   hour of maximum primary swell height → read period + direction from
               that same hour.
    Secondary: hour of maximum secondary swell height → read period + direction from
               that same hour.

    Returns:
        (p1_h_ft, p1_per_s, p1_dir_deg, p2_h_ft, p2_per_s, p2_dir_deg)
        where any value may be None if the hourly data is absent.
    """
    times = marine_hourly.get("time") or []
    p1_heights  = marine_hourly.get("swell_wave_height") or []
    p1_periods  = marine_hourly.get("swell_wave_period") or []
    p1_dirs     = marine_hourly.get("swell_wave_direction") or []
    p2_heights  = marine_hourly.get("secondary_swell_wave_height") or []
    p2_periods  = marine_hourly.get("secondary_swell_wave_period") or []
    p2_dirs     = marine_hourly.get("secondary_swell_wave_direction") or []

    def max_height_event(heights, periods, dirs):
        best_idx = None
        best_h   = -1.0
        for i, (t, h) in enumerate(zip(times, heights)):
            if not t.startswith(target_date):
                continue
            if h is not None and float(h) > best_h:
                best_h   = float(h)
                best_idx = i
        if best_idx is None:
            return None, None, None
        h_ft  = best_h * 3.28084
        per   = periods[best_idx]  if best_idx < len(periods)  else None
        direc = dirs[best_idx]     if best_idx < len(dirs)     else None
        return h_ft, per, direc

    p1_h_ft, p1_per, p1_dir = max_height_event(p1_heights, p1_periods, p1_dirs)
    p2_h_ft, p2_per, p2_dir = max_height_event(p2_heights, p2_periods, p2_dirs)
    return p1_h_ft, p1_per, p1_dir, p2_h_ft, p2_per, p2_dir


# ══════════════════════════════════════════════════════════════════════════════
# SWELL EXPOSURE / DIRECTION HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _swell_exposure(direction_deg):
    """Fraction of swell energy reaching La Jolla based on approach direction (0–1)."""
    if direction_deg is None:
        return 0.5
    delta = abs(float(direction_deg) - 250.0)
    if delta > 180:
        delta = 360 - delta
    return max(0.0, math.cos(math.radians(delta)))


def direction_label(degrees):
    if degrees is None:
        return ""
    labels = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return labels[round(float(degrees) / 22.5) % 16]


# ══════════════════════════════════════════════════════════════════════════════
# SPOTS CONFIGURATION
# P0-4: Scope restricted to La Jolla; San Diego County label removed.
# ══════════════════════════════════════════════════════════════════════════════

SPOTS = [
    {
        "slug": "la-jolla",
        "name": "La Jolla",
        "menu_name": "La Jolla",
        "location": "La Jolla, San Diego",
        "region": "California",
        "lat": 32.866,
        "lon": -117.257,
        "timezone": "America/Los_Angeles",
        "tide_station": "9410230",
        "tide_label": "NOAA La Jolla 9410230",
        "description": (
            "La Jolla dive visibility forecast — La Jolla Cove, Shores, Canyon, "
            "and adjacent kelp forest.  Model trained on La Jolla DivePro reports.  "
            "Development model: not validated for public accuracy claims."
        ),
        "habitat": "Kelp forest and sand channels",
        "exposure": "Open sandy shore",
        "clarity_adjustment": 0,
        "wave_sensitivity": 1.0,
        "wind_sensitivity": 1.0,
        "calibration_note": (
            "La Jolla soft probabilistic model — development data only.  "
            "Prospective validation required before public accuracy claims.  "
            "See PROSPECTIVE_VALIDATION_PLAN.md."
        ),
        "cams": [{"title": "Scripps Pier Live Visibility", "url": "https://coollab.ucsd.edu/pierviz/"}],
        "camera_note": "Screenshot refreshes every few minutes from the Scripps Institution of Oceanography pier cam.",
    },
    # All other spots removed: this build is La Jolla only.
    # The ML model, training data, and prospective validation plan are
    # La Jolla-specific.  Do not add other spots until a separate
    # training dataset and validated model exist for each location.
]


# ══════════════════════════════════════════════════════════════════════════════
# API HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def youtube_embed(url):
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    video_id = query.get("v", [""])[0]
    return (f"https://www.youtube.com/embed/{video_id}?autoplay=1&mute=1&playsinline=1&rel=0"
            if video_id else None)


# ══════════════════════════════════════════════════════════════════════════════
# HAND-TUNED SCORE (non-La Jolla spots only)
# ══════════════════════════════════════════════════════════════════════════════

def _score_heuristic(features, spot):
    """Rule-based visibility score for non-ML spots.  Returns 0-100 integer."""
    total_swell  = features.get("total_swell_height_mean_ft", 3) or 3
    surf_max     = features.get("surf_height_max_ft", 3) or 3
    short_energy = features.get("short_period_swell_energy", 15) or 15
    wind_max     = features.get("wind_speed_max_mph", 8) or 8
    # Inline mixed-swell count and energy for the old rule-based algo.
    # Not the ML feature builder — these lookups are for non-La Jolla spots only.
    _ww_ht_cs = features.get("ww_height_ft", 0) or 0
    _wv_ht_cs = features.get("wave_height_ft", 0) or 0
    _sw_ht_cs = features.get("p1_height_ft", 0) or 0
    mixed   = 1 + int(_ww_ht_cs > 1.0) + int(abs(_wv_ht_cs - _sw_ht_cs) > 1.0)
    _ep_cs  = features.get("p1_period_s", 10) or 10
    energy  = _wv_ht_cs ** 2 * max(1.0, float(_ep_cs)) * 0.72
    ws = spot.get("wave_sensitivity", 1.0)
    wi = spot.get("wind_sensitivity", 1.0)
    score = 70 + spot.get("clarity_adjustment", 0)
    score -= max(0, total_swell - 3) * 6 * ws
    score -= max(0, surf_max - 2.5) * 6 * ws
    score -= max(0, short_energy - 24) * 0.1 * ws
    score -= max(0, wind_max - 8) * 1.6 * wi
    score -= max(0, mixed - 2) * 3
    score -= max(0, energy - 90) * 0.06 * ws
    score += max(0, 3 - total_swell) * 8 * ws
    score += max(0, 7 - wind_max) * 1 * wi
    score += max(0, 70 - energy) * 0.08 * ws
    return max(0, min(100, round(score)))


def grade_from_score_heuristic(score: int) -> str:
    """Score → grade for non-ML heuristic spots only.  NOT used for La Jolla."""
    if score >= 94: return "A+"
    if score >= 88: return "A"
    if score >= 75: return "B"
    if score >= 55: return "C"
    if score >= 40: return "D"
    return "F"


def visibility_range_from_score(score: int) -> list:
    """Score → vis range for non-ML heuristic spots only."""
    if score >= 94: return [35, 40]
    if score >= 88: return [25, 35]
    if score >= 75: return [15, 24]
    if score >= 55: return [10, 14]
    if score >= 40: return [5, 9]
    return [0, 4]


# ══════════════════════════════════════════════════════════════════════════════
# LA JOLLA ML PREDICTION
# P0-3: serves the soft probability model that is evaluated with RPS.
# ══════════════════════════════════════════════════════════════════════════════

def _build_lajolla_feat_map(features):
    """
    Extract the ML feature dict from the rich features dict.
    This is a pass-through for named values already computed in build_day().
    """
    p1_h   = features.get("ml_p1_height_ft", 0) or 0
    p1_per = features.get("ml_p1_period_s", 10) or 10
    p1_dir = features.get("ml_p1_direction_deg")
    p2_h   = features.get("ml_p2_height_ft", 0) or 0
    p2_per = features.get("ml_p2_period_s", 0) or 0
    p2_dir = features.get("ml_p2_direction_deg")
    ww_h   = features.get("ml_ww_height_ft", 0) or 0
    ww_per = features.get("ml_ww_period_s", 0) or 0
    wind   = features.get("wind_speed_max_mph", 0) or 0
    gust   = features.get("ml_gust_max_mph", 0) or 0
    rain_t = features.get("rain_target_day_forecast_in", 0) or 0      # P1-3: target-day only
    rain3  = features.get("rain_prior_3day_in", 0) or 0               # P1-3: prior-only
    rain7  = features.get("rain_prior_7day_in", 0) or 0               # P1-3: prior-only
    wave_y = features.get("ml_wave_yesterday_ft") or p1_h
    wave2  = features.get("ml_wave_2d_ago_ft") or wave_y
    wave3  = features.get("ml_wave_3d_ago_ft") or wave_y
    wave7  = features.get("ml_wave_7d_avg_ft") or wave_y
    chop   = features.get("short_period_swell_energy", 0) or 0
    sst    = features.get("ml_sst_f") or 65.0
    sin_doy = features.get("ml_sin_doy", 0.0) or 0.0
    cos_doy = features.get("ml_cos_doy", 0.0) or 0.0
    month   = features.get("ml_month", 6.0) or 6.0
    # Buoy proxy: primary swell as stand-in for measured NDBC data.
    # NOTE: training fills buoy_ht = p1_h when NDBC is missing (same substitution).
    # This is documented as a train/runtime match, not a measurement.
    buoy_ht  = features.get("ml_buoy_ht_ft") or p1_h
    buoy_per = features.get("ml_buoy_per_s") or p1_per
    buoy_dir = features.get("ml_buoy_dir_deg") or p1_dir
    buoy_exp = _swell_exposure(buoy_dir)
    buoy_energy_wtd = buoy_ht ** 2 * (buoy_per / 10.0) * buoy_exp
    upwelling_wind = features.get("ml_upwelling_wind", 0.5) or 0.5
    chla_log   = features.get("ml_chla_log")
    chla_7d    = features.get("ml_chla_7d_avg")
    upwelling_x_chla = upwelling_wind * (chla_log or 0.5)
    pressure_trend = features.get("ml_pressure_trend", 0.0) or 0.0
    sst_anomaly    = features.get("ml_sst_anomaly", 0.0) or 0.0
    wave_trend     = features.get("ml_wave_trend", 0.0) or 0.0
    wave_accel     = features.get("ml_wave_accel", 0.0) or 0.0
    tide_range     = features.get("ml_tide_range_ft", 4.0) or 4.0
    tide_morning   = features.get("ml_tide_morning_avg", 2.0) or 2.0
    upwelling_x_sst = upwelling_wind * max(0.0, -sst_anomaly)

    exp1 = _swell_exposure(p1_dir)
    exp2 = _swell_exposure(p2_dir)
    p1_energy_wtd = p1_h ** 2 * (p1_per / 10.0) * exp1
    p2_energy_wtd = p2_h ** 2 * (p2_per / 10.0) * exp2
    surge_proxy   = p1_h * p1_per
    swell_x_rain  = p1_h * rain3
    rain_flag     = 1.0 if rain3 > 0.05 else 0.0

    # --- Energy and n_swells: computed via production_features.py (IMPORTED) ---
    # _production_feat_bundle is imported at module load.  DO NOT duplicate formula.
    _pfb = _production_feat_bundle(p1_h, p1_per, p2_h, p2_per, ww_h, ww_per)
    energy_raw   = _pfb["p1_energy_raw"]   # p1_energy_raw
    total_energy = _pfb["total_energy"]    # total_energy
    n_sw         = _pfb["n_swells"]        # n_swells

    p1_dir_sin = math.sin(math.radians(p1_dir)) if p1_dir is not None else 0.0
    p1_dir_cos = math.cos(math.radians(p1_dir)) if p1_dir is not None else 1.0
    p1_dir_blocked = 1.0 if (p1_dir is not None and 0.0 <= p1_dir <= 135.0) else 0.0
    _p2_dir_fill = p2_dir if p2_dir is not None else p1_dir
    p2_dir_sin = math.sin(math.radians(_p2_dir_fill)) if _p2_dir_fill is not None else p1_dir_sin
    p2_dir_cos = math.cos(math.radians(_p2_dir_fill)) if _p2_dir_fill is not None else p1_dir_cos

    return {
        "p1_h": p1_h, "p1_per": p1_per, "p1_exp": exp1, "p1_energy_wtd": p1_energy_wtd,
        "p2_h": p2_h, "p2_per": p2_per, "p2_exp": exp2, "p2_energy_wtd": p2_energy_wtd,
        # p3_* and buoy_* are NOT included: they are absent from the clean production
        # model (train_model.py engineer_features removes them to fix the train/runtime
        # mismatch).  See UPLOAD_TO_CLAUDE_POST_IMPLEMENTATION_AUDIT_REQUIRED_FIXES.md.
        "ww_h": ww_h, "ww_per": ww_per, "chop_proxy": chop,
        "total_energy": total_energy, "p1_energy_raw": energy_raw,
        "n_swells": n_sw,
        "wind_max": wind, "gust_max": gust,
        # P1-3: training uses precip_today_in (same-day) and precip_3day_in (prior only).
        # rain_today = target-day forecast precip; rain_3day = prior-only 3-day sum.
        "rain_today": rain_t, "rain_3day": rain3, "rain_7day": rain7, "rain_flag": rain_flag,
        "notes_rain": 0.0,
        "wave_yesterday": wave_y, "wave_2d_ago": wave2, "wave_3d_ago": wave3, "wave_7d_avg": wave7,
        "sst_f": sst,
        "swell_x_rain": swell_x_rain, "surge_proxy": surge_proxy,
        "sin_doy": sin_doy, "cos_doy": cos_doy, "month": month,
        "upwelling_wind": upwelling_wind,
        "chla_log": chla_log,
        "chla_7d_avg": chla_7d,
        "upwelling_x_chla": upwelling_x_chla,
        "pressure_trend": pressure_trend,
        "sst_anomaly": sst_anomaly,
        "wave_trend": wave_trend,
        "wave_accel": wave_accel,
        "tide_range": tide_range,
        "tide_morning": tide_morning,
        "upwelling_x_sst": upwelling_x_sst,
        "p1_dir_sin": p1_dir_sin, "p1_dir_cos": p1_dir_cos, "p1_dir_blocked": p1_dir_blocked,
        "p2_dir_sin": p2_dir_sin, "p2_dir_cos": p2_dir_cos,
    }


def predict_lajolla(features: dict) -> dict:
    """
    Run the La Jolla visibility model and return a structured prediction.

    Returns a dict:
        probabilities        dict[grade -> float] summing to 1.0, or None
        raw_expected_vis_ft  float — expected visibility before guardrail
        guardrail_applied    bool
        guardrail_reason     str
        guarded_vis_ft       float — after guardrail
        display_grade        str   — official grade for display
        vis_range            [lo, hi] ft
        model_source         str   — 'soft_probabilistic' | 'point_gbt_fallback' | 'none'
    """
    result = {
        "probabilities": None,
        "raw_expected_vis_ft": None,
        "median_expected_vis_ft": None,
        "display_policy_version": None,
        "most_likely_grade": None,
        "guardrail_applied": False,
        "guardrail_reason": "",
        "guarded_vis_ft": None,
        "display_grade": None,
        "vis_range": [0, 4],
        "model_source": "none",
    }

    feat_map = _build_lajolla_feat_map(features)
    p1_h  = feat_map["p1_h"]
    rain3 = feat_map["rain_3day"]

    try:
        import numpy as _np

        # ── Attempt soft probability model first (primary) ────────────────────
        if _LAJOLLA_SOFT_MODEL is not None and _LAJOLLA_SOFT_FEATURES is not None:
            missing = [f for f in _LAJOLLA_SOFT_FEATURES if f not in feat_map]
            if missing:
                raise RuntimeError(
                    f"Soft model feature mismatch: {len(missing)} features missing: {missing[:5]}")
            X = _np.array([[feat_map.get(f, 0.0) for f in _LAJOLLA_SOFT_FEATURES]])
            raw_probs = _LAJOLLA_SOFT_MODEL.predict(X)[0]
            raw_probs = _np.clip(raw_probs, 0.0, 1.0)
            total = raw_probs.sum()
            if total < 1e-9:
                probs = [1.0 / 6] * 6
            else:
                probs = (raw_probs / total).tolist()
            expected_vis = sum(p * m for p, m in zip(probs, _LAJOLLA_SOFT_BAND_MIDS))
            result["probabilities"] = dict(zip(_LAJOLLA_SOFT_GRADES, probs))
            result["raw_expected_vis_ft"] = round(expected_vis, 2)
            result["model_source"] = "soft_probabilistic"

        # ── Fallback: point GBT regressor ─────────────────────────────────────
        elif _LAJOLLA_MODEL is not None and _LAJOLLA_FEATURES is not None:
            missing = [f for f in _LAJOLLA_FEATURES if f not in feat_map]
            if missing:
                raise RuntimeError(
                    f"Point model feature mismatch: {len(missing)} features missing: {missing[:5]}")
            X = _np.array([[feat_map.get(f, 0.0) for f in _LAJOLLA_FEATURES]])
            vis_ft = float(_LAJOLLA_MODEL.predict(X)[0])
            result["raw_expected_vis_ft"] = round(vis_ft, 2)
            result["model_source"] = "point_gbt_fallback"
            # Construct one-hot probability distribution from point estimate
            grade = grade_from_visibility(vis_ft)
            one_hot = {g: (1.0 if g == grade else 0.0) for g in _LAJOLLA_SOFT_GRADES}
            result["probabilities"] = one_hot

        else:
            # No model loaded — this is a hard failure, not a graceful fallback
            raise RuntimeError("No La Jolla model loaded (neither soft nor point).")

    except Exception as _ml_err:
        print(f"  ERROR: La Jolla model prediction failed: {_ml_err}")
        return result

    raw_vis = result["raw_expected_vis_ft"]
    if raw_vis is None:
        return result

    # Preserve the raw (pre-guardrail) probability vector for logging.
    # Audit finding #8: the guardrail is a policy cap, not model confidence.
    # Raw probabilities are preserved; only display_grade and guarded_vis_ft
    # reflect the cap.  Do NOT collapse raw probs to one-hot.
    result["raw_grade_probabilities"] = dict(result["probabilities"]) \
        if result["probabilities"] is not None else None
    if result["probabilities"] is not None:
        probs_list = [result["probabilities"][g] for g in _LAJOLLA_SOFT_GRADES]
        most_likely_idx = int(max(range(6), key=lambda i: probs_list[i]))
        most_likely_grade = _LAJOLLA_SOFT_GRADES[most_likely_idx]
        result["most_likely_grade"] = {
            "grade": most_likely_grade,
            "probability": round(float(probs_list[most_likely_idx]), 4),
        }

    # ── Physics guardrail: large swell + heavy prior rain ─────────────────────
    # Sparse evidence: p1_h > 4ft AND prior 3-day rain > 0.5in → 17 rows in
    # training data, vis 2.5-12.5 ft (mean ~6.3 ft).  The model over-predicts
    # in this regime due to small-sample seasonal confounding.
    # Cap is conservative policy only.  BOTH raw and guarded values are logged.
    # Trigger to REVIEW (not auto-remove): 50 prospective co-occurring examples.
    _GUARDRAIL_P1H  = 4.0   # ft — large swell threshold
    _GUARDRAIL_RAIN = 0.5   # in — prior 3-day rain threshold
    if p1_h > _GUARDRAIL_P1H and rain3 > _GUARDRAIL_RAIN:
        capped_vis = min(raw_vis, 10.0)
        result["guardrail_applied"] = True
        result["guardrail_reason"]  = (
            f"large-swell-rain: p1_h={p1_h:.1f}ft > {_GUARDRAIL_P1H}ft "
            f"AND rain_prior_3day={rain3:.2f}in > {_GUARDRAIL_RAIN}in"
        )
        result["guarded_vis_ft"] = round(capped_vis, 2)
        # NOTE: probabilities are NOT replaced with one-hot here.
        # The guardrail shifts the displayed grade and guarded visibility only.
        # raw_grade_probabilities above preserves the model output for evaluation.
        result["display_grade_after_guardrail"] = grade_from_visibility(capped_vis)
    else:
        result["guarded_vis_ft"] = raw_vis
        result["display_grade_after_guardrail"] = None

    # ── Final grade and range ──────────────────────────────────────────────────
    # Display policy v3: grade always follows the guarded continuous estimate.
    # The soft model outputs are clipped Huber regressions, not calibrated class
    # probabilities, so a cumulative 0.5 threshold can turn a borderline D/C
    # estimate into a full-band display miss. Preserve the raw vector for
    # evaluation, but do not use it as a categorical CDF.
    grade = grade_from_visibility(result["guarded_vis_ft"])
    median_vis_ft = visibility_midpoint_from_grade(grade)
    result["display_grade"] = grade
    result["vis_range"] = visibility_range_from_grade(grade)
    result["median_expected_vis_ft"] = median_vis_ft
    result["display_policy_version"] = "v3-guarded-expected-vis"
    return result


def _append_v2_shadow_if_available(
    marine_hourly: dict,
    weather_hourly: dict,
    tide_points: list[dict],
    target_date: str,
    context: dict,
    metadata: dict,
) -> bool:
    """Log a parallel candidate prediction without affecting public output."""
    if _LAJOLLA_V2_ARTIFACT is None:
        return False
    from shadow_visibility_v2 import append_shadow, make_shadow_row
    from visibility_v2_features import build_v2_features

    v2_features = build_v2_features(
        marine_hourly,
        weather_hourly,
        tide_points,
        target_date,
        context,
    )
    append_shadow(
        SHADOW_LOG_PATH,
        make_shadow_row(
            _LAJOLLA_V2_ARTIFACT_PATH,
            _LAJOLLA_V2_ARTIFACT,
            v2_features,
            metadata,
        ),
    )
    return True


# ══════════════════════════════════════════════════════════════════════════════
# TIDE CHARTS
# ══════════════════════════════════════════════════════════════════════════════

def tide_charts(spot, dates):
    if not spot.get("tide_station"):
        return {d: [] for d in dates}
    begin = dates[0].replace("-", "")
    end   = dates[-1].replace("-", "")
    url = api_url("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
        "product": "predictions",
        "application": "diveprousa",
        "begin_date": begin,
        "end_date": end,
        "datum": "MLLW",
        "station": spot["tide_station"],
        "time_zone": "lst_ldt",
        "units": "english",
        "interval": "h",
        "format": "json",
    })
    try:
        data = _get_json_with_retry(url)
        charts = {d: [] for d in dates}
        for item in data.get("predictions", []):
            tide_date, tide_time = item["t"].split(" ")
            if tide_date in charts:
                charts[tide_date].append({
                    "time": tide_time,
                    "height_ft": round(float(item["v"]), 2),
                })
        return charts
    except Exception:
        return {d: [] for d in dates}


def hourly_day_points(data, key, target_date, value_key, multiplier=1.0):
    times  = data.get("hourly", {}).get("time", [])
    values = data.get("hourly", {}).get(key, [])
    return [
        {"time": ts.split("T")[1], value_key: round(v * multiplier, 1)}
        for ts, v in zip(times, values)
        if ts.startswith(target_date) and v is not None
    ]


def daily_sea_temperature(marine, target_date):
    values = [
        pt["temperature_f"]
        for pt in hourly_day_points(marine, "sea_surface_temperature", target_date, "temperature_f")
    ]
    return round(sum(values) / len(values), 1) if values else None


# ══════════════════════════════════════════════════════════════════════════════
# UNAVAILABLE DAY HELPER
# Returns a fully-formed day dict with is_unavailable=True and no numeric
# forecast values. Used when model inference fails or logging fails for La Jolla.
# ══════════════════════════════════════════════════════════════════════════════

def _unavailable_day(spot, target_date, reason):
    """Return a complete day dict marked unavailable — no grade, no numerics."""
    return {
        "generated_at":  datetime.now().replace(microsecond=0).isoformat(),
        "spot_slug":     spot["slug"],
        "spot_name":     spot["name"],
        "location":      spot["location"],
        "region":        spot["region"],
        "date":          target_date,
        "is_unavailable": True,
        "unavailable_reason": str(reason),
        "numeric_score_0_100":           None,
        "grade":                         None,
        "grade_probabilities":           None,
        "raw_grade_probabilities":       None,
        "model_source":                  "unavailable",
        "estimated_visibility_range_ft": None,
        "estimated_visibility_mid_ft":   None,
        "raw_expected_vis_ft":           None,
        "guardrail_applied":             False,
        "guardrail_reason":              "",
        "confidence":                    "unavailable",
        "best_window":                   None,
        "risk_factors":                  [],
        "positive_factors":              [],
        "explanation":    f"Forecast unavailable: {reason}",
        "is_projected":   False,
        "projected_from": None,
        "forecast_basis": "unavailable",
        "report_text":    f"Forecast unavailable for {target_date}.",
        "features":       {},
        "cams": [
            {**cam, "embed": cam.get("embed") or youtube_embed(cam["url"])}
            for cam in spot.get("cams", [])
        ],
        "tide_source":      f"{spot.get('tide_label', '')} - {target_date}",
        "wind_source":      f"Open-Meteo - {target_date}",
        "description":      spot.get("description", ""),
        "habitat":          spot.get("habitat", ""),
        "exposure":         spot.get("exposure", ""),
        "calibration_note": spot.get("calibration_note", ""),
        "camera_note":      spot.get("camera_note", ""),
    }


# ══════════════════════════════════════════════════════════════════════════════
# BUILD DAY
# P0-1: target_date passed directly; all lookups use value_on_date().
# P1-1: coherent swell from hourly data when available.
# P1-3: rain prior windows exclude target date.
# ══════════════════════════════════════════════════════════════════════════════

def build_day(spot, marine, long_range_marine, weather, target_date, tide_points,
              chla_recent=None, run_ts=None, ndbc_temp=None):
    """
    Build the forecast dict for a single target_date.

    All feature lookups are keyed by target_date string, not array index.
    This avoids the P0-1 bug where past_days data at array[0] was used as
    today's forecast.
    """
    marine_daily      = marine["daily"]
    long_range_daily  = long_range_marine["daily"]
    weather_daily     = weather["daily"]
    marine_hourly     = marine.get("hourly", {})
    weather_hourly    = weather.get("hourly", {})
    run_ts            = run_ts or utc_timestamp_now()

    # ── Wave height from daily (meters → feet) ────────────────────────────────
    proxy_wave   = value_on_date(long_range_daily, "wave_height_max",  target_date, 0) or 0
    proxy_period = value_on_date(long_range_daily, "wave_period_max",  target_date, 0) or 0
    wave_ft_raw  = value_on_date(marine_daily,     "wave_height_max",  target_date)
    wave_ft      = (float(wave_ft_raw) if wave_ft_raw is not None else proxy_wave * 0.3048) * 3.28084

    # ── Coherent swell (P1-1) ─────────────────────────────────────────────────
    # For La Jolla: derive height/period/direction from same hourly event.
    # For other spots: fall back to daily summaries.
    component_available = all(
        value_on_date(marine_daily, key, target_date) is not None
        for key in ("wave_height_max", "swell_wave_height_max",
                    "swell_wave_period_max", "wind_wave_height_max", "wind_wave_period_max")
    )

    if spot.get("slug") == "la-jolla" and marine_hourly.get("swell_wave_height"):
        # Coherent swell: period and direction from same hour as max height
        p1_h_coh, p1_per_coh, p1_dir_coh, p2_h_coh, p2_per_coh, p2_dir_coh = \
            coherent_swell_from_hourly(marine_hourly, target_date)
        swell_ft     = p1_h_coh if p1_h_coh is not None else \
                       (value_on_date(marine_daily, "swell_wave_height_max", target_date, 0) or 0) * 3.28084
        swell_period = p1_per_coh if p1_per_coh is not None else \
                       value_on_date(marine_daily, "swell_wave_period_max", target_date, proxy_period) or proxy_period
        swell_dir    = p1_dir_coh
        p2_ft        = (p2_h_coh or 0.0)
        p2_period    = p2_per_coh or 0
        p2_dir       = p2_dir_coh
        coherent_source = "hourly_max_height_event"
    else:
        swell_ft     = (value_on_date(marine_daily, "swell_wave_height_max", target_date, 0) or 0) * 3.28084
        swell_period = value_on_date(marine_daily, "swell_wave_period_max", target_date, proxy_period) or proxy_period
        swell_dir    = value_on_date(marine_daily, "swell_wave_direction_dominant", target_date)
        # Secondary swell from hourly: secondary_swell_*_max daily fields are invalid
        # in the Marine forecast API.  coherent_swell_from_hourly() extracts p2 from
        # hourly secondary_swell_wave_height/period/direction, which are now requested
        # for all spots.
        _, _, _, p2_h_coh, p2_per_coh, p2_dir_coh = \
            coherent_swell_from_hourly(marine_hourly, target_date)
        p2_ft     = (p2_h_coh or 0.0)
        p2_period = (p2_per_coh or 0)
        p2_dir    = p2_dir_coh
        coherent_source = "daily_summary"

    wind_wave_ft     = (value_on_date(marine_daily, "wind_wave_height_max", target_date, 0) or 0) * 3.28084
    wind_wave_period = value_on_date(marine_daily, "wind_wave_period_max", target_date, 0) or 0

    # ── Wind / weather ────────────────────────────────────────────────────────
    wind_max  = value_on_date(weather_daily, "wind_speed_10m_max",     target_date, 0) or 0
    gust_max  = value_on_date(weather_daily, "wind_gusts_10m_max",     target_date, 0) or 0
    temp_max  = value_on_date(weather_daily, "temperature_2m_max",     target_date)
    temp_min  = value_on_date(weather_daily, "temperature_2m_min",     target_date)

    # ── Rain (P1-3): prior windows exclude target date ─────────────────────────
    rain_target_day = float(value_on_date(weather_daily, "precipitation_sum", target_date, 0.0) or 0.0)
    rain_prior_3day = rain_prior_window(weather_daily, target_date, 3)
    rain_prior_7day = rain_prior_window(weather_daily, target_date, 7)

    # ── Sea surface temperature ───────────────────────────────────────────────
    sea_temperature = daily_sea_temperature(marine, target_date)

    # ── Wave history lags (date-keyed, not index-keyed) ───────────────────────
    # Uses hourly wave_height mean (Hs) to match the training lag source:
    # training_data_coherent.csv lags were built from Open-Meteo archive
    # wave_height_ft (mean daily Hs).  wave_height is a valid hourly field in
    # the Marine forecast API (secondary_swell_*_max daily variants are not).
    # Falls back to wave_height_max if hourly data is absent for a given date.
    def _wave_ft_on(d_str):
        times   = marine_hourly.get("time", [])
        heights = marine_hourly.get("wave_height", [])
        day_vals = [h for t, h in zip(times, heights)
                    if t and t.startswith(d_str) and h is not None]
        if day_vals:
            return sum(day_vals) * 3.28084 / len(day_vals)
        v = value_on_date(marine_daily, "wave_height_max", d_str)
        return (float(v) * 3.28084) if v is not None else None

    wave_yesterday_ft = _wave_ft_on(previous_date(target_date, 1)) or wave_ft
    wave_2d_ago_ft    = _wave_ft_on(previous_date(target_date, 2)) or wave_yesterday_ft
    wave_3d_ago_ft    = _wave_ft_on(previous_date(target_date, 3)) or wave_yesterday_ft
    wave_7d_vals      = [(_wave_ft_on(previous_date(target_date, k)) or wave_ft) for k in range(1, 8)]
    wave_7d_avg_ft    = sum(wave_7d_vals) / len(wave_7d_vals)

    # ── Seasonal features ─────────────────────────────────────────────────────
    try:
        _td  = datetime.strptime(target_date, "%Y-%m-%d")
        _doy = _td.timetuple().tm_yday
        _month = float(_td.month)
    except Exception:
        _doy = 180; _month = 6.0
    _sin_doy = math.sin(2 * math.pi * _doy / 365.25)
    _cos_doy = math.cos(2 * math.pi * _doy / 365.25)

    # ── Buoy proxy (documented train/runtime match) ───────────────────────────
    # Training fills buoy_ht = p1_h when NDBC data is missing (majority of rows).
    # Runtime uses the same substitution.  Both sides agree: primary swell is proxy.
    buoy_ht  = swell_ft
    buoy_per = swell_period
    buoy_dir = swell_dir
    buoy_exp = _swell_exposure(buoy_dir)
    buoy_energy_wtd = buoy_ht ** 2 * (buoy_per / 10.0) * buoy_exp

    # ── Upwelling wind index ──────────────────────────────────────────────────
    wind_dir_deg = value_on_date(weather_daily, "wind_direction_10m_dominant", target_date)
    if wind_dir_deg is not None:
        _wd_delta = abs(float(wind_dir_deg) - 330.0)
        if _wd_delta > 180: _wd_delta = 360 - _wd_delta
        upwelling_wind = round(max(0.0, math.cos(math.radians(_wd_delta))), 3)
    else:
        upwelling_wind = 0.5

    # ── Pressure trend ────────────────────────────────────────────────────────
    def _mean_pressure(d_str):
        pmax = value_on_date(weather_daily, "surface_pressure_max", d_str)
        pmin = value_on_date(weather_daily, "surface_pressure_min", d_str)
        if pmax is None: return None
        return (float(pmax) + float(pmin or pmax)) / 2.0
    _p_today = _mean_pressure(target_date)
    _p_yest  = _mean_pressure(previous_date(target_date, 1))
    pressure_trend = round(_p_today - _p_yest, 1) if (_p_today and _p_yest) else 0.0

    # ── SST anomaly ───────────────────────────────────────────────────────────
    _LA_JOLLA_SST_CLIMO = {
        1:58.5,2:58.5,3:59.0,4:61.0,5:63.5,6:66.0,
        7:69.0,8:70.5,9:70.0,10:67.0,11:63.0,12:60.0
    }
    sst_anomaly = None
    if sea_temperature is not None:
        try:
            _mon = int(target_date[5:7])
            sst_anomaly = round(sea_temperature - _LA_JOLLA_SST_CLIMO.get(_mon, 64.0), 1)
        except Exception:
            sst_anomaly = 0.0

    # ── Wave trend / accel ────────────────────────────────────────────────────
    wave_trend = round(wave_yesterday_ft - wave_7d_avg_ft, 2)
    wave_accel = round(wave_yesterday_ft - wave_2d_ago_ft, 2)

    # ── Tide features ─────────────────────────────────────────────────────────
    tide_heights_all = [pt["height_ft"] for pt in tide_points]
    tide_min_ft      = round(min(tide_heights_all), 2) if tide_heights_all else None
    tide_range_ft_val = round(max(tide_heights_all) - min(tide_heights_all), 2) if tide_heights_all else None
    tide_morning_heights = [
        pt["height_ft"] for pt in tide_points
        if "06:00" <= pt.get("time", "00:00") <= "10:00"
    ]
    tide_morning_avg = (round(sum(tide_morning_heights)/len(tide_morning_heights), 2)
                        if tide_morning_heights else tide_min_ft)

    # ── Tide phase and slack windows (today only — hilo uses current time) ────
    try:
        _local_today = datetime.now(ZoneInfo(spot.get("timezone", "America/Los_Angeles"))).date().isoformat()
    except Exception:
        _local_today = ""
    if target_date == _local_today and spot.get("tide_station"):
        _tide_hilo_data = _fetch_tide_hilo(spot["tide_station"], target_date)
    else:
        _tide_hilo_data = None

    # ── Chlorophyll ───────────────────────────────────────────────────────────
    chla_recent = chla_recent or {}
    def _chla_for_date(d_str):
        try:
            d_obj = datetime.strptime(d_str, "%Y-%m-%d")
        except Exception:
            return None
        for k in range(11):
            key = (d_obj - timedelta(days=k)).strftime("%Y-%m-%d")
            v = chla_recent.get(key)
            if v is not None:
                return v
        return None
    chla_log_today = _chla_for_date(target_date)
    try:
        _td_obj = datetime.strptime(target_date, "%Y-%m-%d")
        _chla7_vals = [
            v for k in range(7)
            if (v := chla_recent.get((_td_obj - timedelta(days=k)).strftime("%Y-%m-%d"))) is not None
        ]
        chla_7d_avg = round(sum(_chla7_vals) / len(_chla7_vals), 3) if _chla7_vals else chla_log_today
    except Exception:
        chla_7d_avg = chla_log_today

    chla_alert, chla_label = _classify_chla(chla_log_today)

    # ── Derived energy metrics ────────────────────────────────────────────────
    energy      = wave_ft * wave_ft * max(1, swell_period) * 0.72
    short_energy = wind_wave_ft * wind_wave_ft * max(1, min(10, wind_wave_period))
    total_swell  = math.sqrt(swell_ft ** 2 + wind_wave_ft ** 2)

    # ══════════════════════════════════════════════════════════════════════════
    # ASSEMBLE FEATURES DICT
    # ══════════════════════════════════════════════════════════════════════════
    features = {
        "date": target_date,
        "coherent_swell_source": coherent_source,
        # Display fields
        "surf_height_mean_ft": round(wave_ft, 2),
        "surf_height_max_ft":  round(wave_ft, 2),
        "primary_swell_height_mean_ft": round(swell_ft, 2),
        "primary_swell_height_max_ft":  round(swell_ft, 2),
        "primary_swell_period_mean_s":  round(swell_period, 2),
        "primary_swell_period_max_s":   round(swell_period, 2),
        "swell_wave_height_max_ft":     round(swell_ft, 2),
        "swell_wave_period_max_s":      round(swell_period, 2),
        "swell_wave_direction_deg":     swell_dir,
        "swell_direction_label":        direction_label(swell_dir),
        "wind_wave_height_max_ft":      round(wind_wave_ft, 2),
        "wind_wave_period_max_s":       round(wind_wave_period, 2),
        "secondary_swell_height_ft":    round(p2_ft, 2),
        "secondary_swell_period_s":     round(p2_period, 2),
        "secondary_swell_direction_deg": p2_dir,
        "secondary_swell_direction_label": direction_label(p2_dir) if p2_ft > 0.3 else "local wind",
        # ML-tagged features (named for model consumption)
        "ml_p1_height_ft":    round(swell_ft, 2),
        "ml_p1_period_s":     round(swell_period, 2),
        "ml_p1_direction_deg": swell_dir,
        "ml_p2_height_ft":    round(p2_ft, 2),
        "ml_p2_period_s":     round(p2_period, 2),
        "ml_p2_direction_deg": p2_dir,
        "ml_ww_height_ft":    round(wind_wave_ft, 2),
        "ml_ww_period_s":     round(wind_wave_period, 2),
        "ml_wave_yesterday_ft": round(wave_yesterday_ft, 2),
        "ml_wave_2d_ago_ft":    round(wave_2d_ago_ft, 2),
        "ml_wave_3d_ago_ft":    round(wave_3d_ago_ft, 2),
        "ml_wave_7d_avg_ft":    round(wave_7d_avg_ft, 2),
        # P1-3: rain fields with corrected definitions
        "rain_target_day_forecast_in": round(rain_target_day, 4),
        "rain_prior_3day_in":          round(rain_prior_3day, 4),
        "rain_prior_7day_in":          round(rain_prior_7day, 4),
        # Legacy field names for backward compat (map to correct definitions)
        "rain_24h_in":    round(rain_target_day, 4),
        "ml_rain_3day_in": round(rain_prior_3day, 4),
        "ml_rain_7day_in": round(rain_prior_7day, 4),
        "ml_gust_max_mph":  round(gust_max, 1),
        "ml_sst_f":         sea_temperature,
        "ml_sin_doy":   round(_sin_doy, 4),
        "ml_cos_doy":   round(_cos_doy, 4),
        "ml_month":     _month,
        "ml_buoy_ht_ft": round(buoy_ht, 2),
        "ml_buoy_per_s": round(buoy_per, 2),
        "ml_buoy_dir_deg": buoy_dir,
        "ml_buoy_exp":   round(buoy_exp, 3),
        "ml_buoy_energy_wtd": round(buoy_energy_wtd, 3),
        "ml_wind_dir_deg":    wind_dir_deg,
        "ml_upwelling_wind":  upwelling_wind,
        "ml_chla_log":        chla_log_today,
        "ml_chla_7d_avg":     chla_7d_avg,
        "chla_alert":         chla_alert,
        "chla_label":         chla_label,
        "ml_pressure_trend":  pressure_trend,
        "ml_sst_anomaly":     sst_anomaly,
        "ml_wave_trend":      wave_trend,
        "ml_wave_accel":      wave_accel,
        "ml_tide_min_ft":     tide_min_ft,
        "ml_tide_range_ft":   tide_range_ft_val,
        "ml_tide_morning_avg": tide_morning_avg,
        # Other display fields
        "wave_height_max_ft":  round(wave_ft, 2),
        "wind_speed_mean_mph": round(wind_max * 0.64, 2),
        "wind_speed_max_mph":  round(wind_max, 1),
        "wind_gust_max_mph":   round(gust_max, 1),
        "wave_energy_mean_kj": round(energy, 3),
        "wave_energy_max_kj":  round(energy, 3),
        "total_swell_height_mean_ft": round(total_swell, 2),
        "total_swell_height_max_ft":  round(total_swell, 2),
        "swell_power_proxy_mean": round(energy, 3),
        "swell_power_proxy_max":  round(energy, 3),
        "short_period_swell_energy": round(short_energy, 3),
        "long_period_swell_energy":  round(max(0, energy - short_energy), 3),
        "mixed_swell_score": 1 + int(wind_wave_ft > 1.0) + int(abs(wave_ft - swell_ft) > 1.0),
        "wind_wave_churn_proxy": round(wind_wave_ft * wind_max * max(1, wind_wave_period), 3),
        "wave_energy_wind_interaction": round(energy * max(1, wind_max), 3),
        "water_temp_estimate_f": sea_temperature,
        "buoy_water_temp_f":     ndbc_temp["water_temp_f"] if ndbc_temp else None,
        "buoy_water_temp_source": ndbc_temp["source"] if ndbc_temp else None,
        "air_temp_max_f": temp_max,
        "air_temp_min_f": temp_min,
        "tide_range_ft":  round(max(tide_heights_all) - min(tide_heights_all), 2) if tide_heights_all else None,
        "wind_chart":  hourly_day_points(weather, "wind_speed_10m", target_date, "speed_mph"),
        "wave_chart":  hourly_day_points(marine, "wave_height", target_date, "height_ft", 3.28084),
        "tide_chart":  tide_points,
        "tide_phase":         _tide_hilo_data["current_phase"] if _tide_hilo_data else "unknown",
        "tide_next_event":    _tide_hilo_data["next_tide"] if _tide_hilo_data else None,
        "tide_slack_windows": _tide_hilo_data["slack_windows"] if _tide_hilo_data else [],
        # Explicit pass-through for model consumption
        "source": "open_meteo_marine_coherent" if coherent_source == "hourly_max_height_event"
                  else ("open_meteo_marine" if component_available else "open_meteo_long_range_wave_proxy"),
        "marine_data_filled": not component_available,
    }

    # ══════════════════════════════════════════════════════════════════════════
    # MODEL PREDICTION
    # ══════════════════════════════════════════════════════════════════════════

    if spot.get("slug") == "la-jolla":
        # ── Logger must be available before any La Jolla output is published ──
        # Phase 3 fix (Blocker 4): if the prospective_forecast_logger import
        # failed at module load, refuse to produce any La Jolla output rather
        # than silently publishing an unlogged forecast.
        if not _LOGGER_AVAILABLE:
            raise RuntimeError(
                "La Jolla prospective output requires forecast logger. "
                "Ensure prospective_forecast_logger.py is present alongside "
                "this script before running for La Jolla."
            )

        # ── La Jolla: soft probabilistic model only ───────────────────────────
        # P0-fix: model failure raises here so build_spot emits an unavailable
        # day dict rather than silently publishing a "C" grade.
        # Only soft_probabilistic output is prospective-eligible.
        prediction = predict_lajolla(features)
        model_src  = prediction["model_source"]

        if model_src != "soft_probabilistic":
            raise RuntimeError(
                f"La Jolla soft model unavailable for {target_date} "
                f"(model_source={model_src!r}). Refusing to publish. "
                f"Restart with a trained model_lajolla_soft.pkl present."
            )

        grade       = prediction["display_grade"]
        vis_range   = prediction["vis_range"]
        probs       = prediction["probabilities"]
        raw_probs   = prediction.get("raw_grade_probabilities", probs)
        raw_vis_ft  = prediction["raw_expected_vis_ft"]
        median_vis_ft = prediction.get("median_expected_vis_ft")
        display_policy_version = prediction.get("display_policy_version")
        most_likely_grade = prediction.get("most_likely_grade")
        guarded_vis = prediction["guarded_vis_ft"]
        guardrail   = prediction["guardrail_applied"]
        guardrail_reason = prediction["guardrail_reason"]
        # 0–100 score is secondary display only; never sets the grade
        score = round(50 + ((guarded_vis or 15.0) - 5.0) * 1.6)
        score = max(0, min(100, score))

        # ── Prospective forecast logging (P0-3) ────────────────────────────────
        # Append forecast BEFORE writing output files.
        if _LOGGER_AVAILABLE:
            try:
                import uuid
                _model_path = Path(__file__).parent / (
                    "model_lajolla_soft.pkl" if model_src == "soft_probabilistic"
                    else "model_lajolla.pkl")
                _schema_path = Path(__file__).parent / (
                    "model_lajolla_soft_features.json" if model_src == "soft_probabilistic"
                    else "model_lajolla_features.json")
                _model_hash  = file_sha256(_model_path)  if _model_path.exists()  else "unavailable"
                _schema_hash = file_sha256(_schema_path) if _schema_path.exists() else "unavailable"

                # True lead time: elapsed hours from UTC issue time to valid window start.
                # Phase 3 fix (Blocker 5): replace calendar-day approximation with
                # actual elapsed hours so a forecast issued at 23:00 vs 01:00 on the
                # same calendar day yields different (correct) lead times.
                # Valid window: La Jolla dive morning window starts at 06:00 local
                # (America/Los_Angeles).
                from datetime import timezone as _dt_tz
                try:
                    from zoneinfo import ZoneInfo as _ZI
                except ImportError:
                    from backports.zoneinfo import ZoneInfo as _ZI
                _lj_tz = _ZI("America/Los_Angeles")
                _td = _date_cls.fromisoformat(target_date)
                _valid_local = datetime(_td.year, _td.month, _td.day, 6, 0, 0,
                                        tzinfo=_lj_tz)
                _valid_utc   = _valid_local.astimezone(_dt_tz.utc)
                _run_dt      = datetime.fromisoformat(run_ts.replace("Z", "+00:00")) \
                               if run_ts.endswith("Z") else datetime.fromisoformat(run_ts)
                _run_utc     = (_run_dt if _run_dt.tzinfo is not None
                                else _run_dt.replace(tzinfo=_dt_tz.utc))
                _lead_hours  = max(0, round((_valid_utc - _run_utc).total_seconds() / 3600))

                _probs = probs or {g: 1.0/6 for g in _LAJOLLA_SOFT_GRADES}
                log_row = {
                    "forecast_id":             str(uuid.uuid4()),
                    "forecast_run_ts_utc":     run_ts,
                    "target_date":             target_date,
                    "valid_window_start_local": f"{target_date}T06:00",
                    "valid_window_end_local":   f"{target_date}T14:00",
                    "lead_time_hours":          _lead_hours,
                    "model_version_hash":       _model_hash,
                    "feature_schema_version":   _schema_hash,
                    "guardrail_version":        "v1-large-swell-rain-cap",
                    "display_policy_version":   display_policy_version,
                    "displayed_grade":          grade,
                    "displayed_range_min_ft":   vis_range[0],
                    "displayed_range_max_ft":   vis_range[1],
                    "prob_F":    _probs.get("F",  0.0),
                    "prob_D":    _probs.get("D",  0.0),
                    "prob_C":    _probs.get("C",  0.0),
                    "prob_B":    _probs.get("B",  0.0),
                    "prob_A":    _probs.get("A",  0.0),
                    "prob_Aplus": _probs.get("A+", 0.0),
                    "raw_expected_vis_ft":  raw_vis_ft,
                    "guardrail_applied":    1 if guardrail else 0,
                    "guardrail_reason":     guardrail_reason,
                    "guarded_expected_vis_ft": guarded_vis,
                    "input_source_run_id":  run_ts,
                    "in_p1_height_ft":      features.get("ml_p1_height_ft"),
                    "in_p1_period_s":       features.get("ml_p1_period_s"),
                    "in_p1_direction_deg":  features.get("ml_p1_direction_deg"),
                    "in_p2_height_ft":      features.get("ml_p2_height_ft"),
                    "in_p2_period_s":       features.get("ml_p2_period_s"),
                    "in_p2_direction_deg":  features.get("ml_p2_direction_deg"),
                    "in_windwave_height_ft": features.get("ml_ww_height_ft"),
                    "in_windwave_period_s":  features.get("ml_ww_period_s"),
                    "in_wind_max_mph":       features.get("wind_speed_max_mph"),
                    "in_gust_max_mph":       features.get("ml_gust_max_mph"),
                    "in_rain_target_day_forecast_in": features.get("rain_target_day_forecast_in"),
                    "in_rain_prior_3day_in":  features.get("rain_prior_3day_in"),
                    "in_rain_prior_7day_in":  features.get("rain_prior_7day_in"),
                    "in_sst_f":               features.get("ml_sst_f"),
                    "in_tide_range_ft":       features.get("ml_tide_range_ft"),
                    "in_wave_yesterday_ft":   features.get("ml_wave_yesterday_ft"),
                    "input_source_notes":     coherent_source,
                    "fallback_flags":         "" if model_src == "soft_probabilistic"
                                              else f"point_model_fallback:{model_src}",
                }
                append_forecast_row(FORECAST_LOG_PATH, log_row)
                try:
                    _append_v2_shadow_if_available(
                        marine_hourly,
                        weather_hourly,
                        tide_points,
                        target_date,
                        {
                            "wave_yesterday_ft": wave_yesterday_ft,
                            "wave_3d_ago_ft": wave_3d_ago_ft,
                            "rain_prior_3day_in": rain_prior_3day,
                            "rain_prior_7day_in": rain_prior_7day,
                            "sst_f": sea_temperature,
                            "sst_anomaly_f": sst_anomaly,
                            "pressure_trend_hpa": pressure_trend,
                        },
                        {
                            "forecast_id": log_row["forecast_id"],
                            "forecast_run_ts_utc": run_ts,
                            "target_date": target_date,
                            "lead_time_hours": _lead_hours,
                            "input_source_run_id": run_ts,
                        },
                    )
                except Exception as _shadow_error:
                    # Shadow failures cannot suppress the established public model.
                    print(f"  WARNING: v2 shadow logging failed for {target_date}: {_shadow_error}")
            except Exception as _log_err:
                # P0-fix: unlogged forecasts are not prospective-eligible.
                # Re-raise so build_spot marks this day unavailable instead of
                # writing a JSON that cannot be matched to an observation.
                raise RuntimeError(
                    f"Forecast log write failed for {target_date}: {_log_err}. "
                    f"Aborting this day — unlogged output is not prospective-eligible."
                ) from _log_err

    else:
        # ── Non-ML spots: heuristic formula ───────────────────────────────────
        score     = _score_heuristic(features, spot)
        grade     = grade_from_score_heuristic(score)
        vis_range = visibility_range_from_score(score)
        probs     = None
        raw_vis_ft = (vis_range[0] + vis_range[1]) / 2.0
        median_vis_ft = raw_vis_ft
        display_policy_version = None
        most_likely_grade = None
        guarded_vis = raw_vis_ft
        guardrail = False
        guardrail_reason = ""
        model_src = "heuristic"

    # ── Report text ───────────────────────────────────────────────────────────
    min_viz, max_viz = vis_range
    risks = []
    upsides = []
    if wave_ft >= 3:
        risks.append("Elevated surf can stir up the shallows.")
    if short_energy >= 18:
        risks.append("Short-period wind wave adds local churn.")
    if wind_max >= 9:
        risks.append("Afternoon wind may texture the surface.")
    if rain_target_day >= 0.1:
        risks.append("Recent rain can reduce nearshore clarity.")
    if total_swell <= 3:
        upsides.append("Overall swell load is modest.")
    if wind_max <= 8:
        upsides.append("Wind looks manageable for the morning window.")
    if energy <= 70:
        upsides.append("Wave energy is on the lower side.")
    if not upsides:
        upsides.append("Longer-period swell is easier to time around than short chop.")

    report = (
        f"3:00 PM Update - Grade {grade}\n"
        f"Viz is expected around {min_viz}-{max_viz} ft. "
        f"{risks[0] if risks else 'Model conditions are generally workable.'}\n"
        f"Best shot: early morning to late morning before wind builds.\n"
        f"Waves: {wave_ft:.1f} ft | Wind: {wind_max:.1f} mph | "
        f"Water: {features['water_temp_estimate_f'] or 'n/a'}°F | "
        f"Swell: {swell_ft:.1f} ft @ {swell_period:.0f}s {direction_label(swell_dir)}"
    )

    public_features = public_feature_payload(features)

    day_out = {
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "spot_slug":    spot["slug"],
        "spot_name":    spot["name"],
        "location":     spot["location"],
        "region":       spot["region"],
        "date":         target_date,
        "numeric_score_0_100":              score,
        "grade":                            grade,
        "grade_probabilities":              probs,
        "raw_grade_probabilities":          raw_probs if spot.get("slug") == "la-jolla" else None,
        "most_likely_grade":                most_likely_grade,
        "model_source":                     model_src,
        "display_policy_version":           display_policy_version,
        "estimated_visibility_range_ft":    vis_range,
        "estimated_visibility_mid_ft":      median_vis_ft if median_vis_ft is not None else (min_viz + max_viz) / 2,
        "raw_expected_vis_ft":              raw_vis_ft,
        "guardrail_applied":                guardrail,
        "confidence": ("medium" if component_available and spot["slug"] == "la-jolla"
                       else ("experimental" if component_available else "low")),
        "best_window":    "Early morning to late morning before wind builds",
        "risk_factors":   risks or ["No major model risk factors in the parsed feature set."],
        "positive_factors": upsides,
        "explanation": (
            f"Conditions score blends swell, wave energy, and wind with the "
            f"{spot['exposure'].lower()} calibration. {spot['calibration_note']}"
        ),
        "is_projected":   not component_available,
        "projected_from": None,
        "forecast_basis": ("Open-Meteo marine components (coherent hourly swell)"
                           if coherent_source == "hourly_max_height_event"
                           else ("Open-Meteo marine components" if component_available
                                 else "Open-Meteo ECMWF WAM total-wave proxy")),
        "report_text": report,
        "features":    public_features,
        "cams": [
            {**cam, "embed": cam.get("embed") or youtube_embed(cam["url"])}
            for cam in spot["cams"]
        ],
        "tide_source":  f"{spot['tide_label']} - {target_date}",
        "wind_source":  f"Open-Meteo hourly wind - {target_date}",
        "description":  spot["description"],
        "habitat":      spot["habitat"],
        "exposure":     spot["exposure"],
        "calibration_note": spot["calibration_note"],
        "camera_note":  spot.get("camera_note", ""),
    }
    return day_out


# ══════════════════════════════════════════════════════════════════════════════
# BUILD SPOT
# P0-1: filters forecast dates to >= local today; asserts latest.date == today.
# ══════════════════════════════════════════════════════════════════════════════

def build_spot(spot):
    # ── API: request hourly swell components ─────────────────────────────────
    # wave_height (mean Hs) and secondary_swell_* are only valid as HOURLY
    # fields in the Marine forecast API.  The daily _max variants for secondary
    # swell and plain wave_height do not exist in the forecast endpoint and
    # return 400.  Request them hourly for all spots so that _wave_ft_on() lags
    # and the non-La-Jolla secondary swell fallback both work correctly.
    hourly_fields = [
        "sea_surface_temperature",
        "wave_height",                      # mean Hs — matches training lag source
        "secondary_swell_wave_height",      # p2 fallback (hourly; daily _max invalid)
        "secondary_swell_wave_period",
        "secondary_swell_wave_direction",
    ]
    if spot.get("slug") == "la-jolla":
        hourly_fields += [
            "swell_wave_height", "swell_wave_period", "swell_wave_direction",
            "wind_wave_height", "wind_wave_period",
        ]

    marine_url = api_url("https://marine-api.open-meteo.com/v1/marine", {
        "latitude":  spot["lat"],
        "longitude": spot["lon"],
        "daily": ",".join([
            "wave_height_max", "wave_period_max",
            "swell_wave_height_max", "swell_wave_period_max", "swell_wave_direction_dominant",
            "wind_wave_height_max", "wind_wave_period_max",
        ]),
        "hourly": ",".join(hourly_fields),
        "temperature_unit": "fahrenheit",
        "timezone": spot["timezone"],
        "forecast_days": 10,
        "past_days": 7,   # needed for wave history lags and rain prior windows
    })
    long_range_marine_url = api_url("https://marine-api.open-meteo.com/v1/marine", {
        "latitude":  spot["lat"],
        "longitude": spot["lon"],
        "daily": "wave_height_max,wave_period_max",
        "length_unit": "imperial",
        "timezone": spot["timezone"],
        "forecast_days": 10,
        "models": "ecmwf_wam",
    })
    weather_url = api_url("https://api.open-meteo.com/v1/forecast", {
        "latitude":  spot["lat"],
        "longitude": spot["lon"],
        "hourly": "wind_speed_10m,wind_gusts_10m,temperature_2m",
        "daily": ",".join([
            "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
            "surface_pressure_max", "surface_pressure_min",
            "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
        ]),
        "wind_speed_unit": "mph",
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "timezone": spot["timezone"],
        "forecast_days": 10,
        "past_days": 7,   # needed for prior rain windows and wave history lags
    })

    marine           = _get_json_with_retry(marine_url)
    long_range_marine = _get_json_with_retry(long_range_marine_url)
    weather          = _get_json_with_retry(weather_url)

    # Chlorophyll for La Jolla only
    if spot.get("slug") == "la-jolla":
        print("  Fetching MODIS Aqua chlorophyll-a (La Jolla)...")
        chla_recent = _fetch_chla_recent(n_days=21)
        print(f"  Chlorophyll obs: {sum(1 for v in chla_recent.values() if v is not None)}/{len(chla_recent)} days")
    else:
        chla_recent = {}

    # ── NDBC buoy water temperature (display only, not a model feature) ───────
    if spot.get("slug") == "la-jolla":
        print("  Fetching NDBC buoy water temperature...")
        ndbc_temp = _fetch_ndbc_water_temp()
        if ndbc_temp:
            print(f"  Buoy water temp: {ndbc_temp['water_temp_f']}°F ({ndbc_temp['source']})")
        else:
            print("  Buoy water temp: unavailable (will use Open-Meteo estimate)")
    else:
        ndbc_temp = None

    # ── Community report (JustGetWet — today only, La Jolla only) ─────────────
    if spot.get("slug") == "la-jolla" and _COMMUNITY_REPORT_AVAILABLE:
        print("  Fetching JustGetWet community report...")
        community_data = _cr_mod.get_community_report()
        if community_data.get("error"):
            print(f"  Community report error: {community_data['error']}")
        elif community_data.get("visibility_ft"):
            print(f"  Community report: {community_data['visibility_ft']} ft (weight {community_data['weight']})")
        else:
            print("  Community report: no today posts found")
    else:
        community_data = {"visibility_ft": None, "weight": 0.0, "confidence_label": "low",
                          "source_excerpt": None, "error": None}

    # ── P0-1: Filter to display dates only (>= local today) ──────────────────
    local_today = datetime.now(ZoneInfo(spot["timezone"])).date().isoformat()
    all_dates   = marine["daily"]["time"]
    forecast_dates = [d for d in all_dates if d >= local_today]

    if not forecast_dates:
        raise RuntimeError(
            f"No forecast dates found >= local today ({local_today}). "
            f"API returned dates: {all_dates}"
        )

    # ── Tide charts (only for forecast display dates) ─────────────────────────
    tide_by_date = tide_charts(spot, forecast_dates)

    # ── Run timestamp (shared across all days for this spot run) ─────────────
    run_ts = utc_timestamp_now()

    # Build each day; on failure emit an explicit unavailable dict rather than
    # crashing the whole spot or silently publishing a fallback grade.
    days = []
    for target_date in forecast_dates:
        try:
            day = build_day(spot, marine, long_range_marine, weather, target_date,
                            tide_by_date[target_date], chla_recent, run_ts=run_ts,
                            ndbc_temp=ndbc_temp)
        except Exception as _day_err:
            print(f"  WARNING: day {target_date} failed — emitting unavailable: {_day_err}")
            day = _unavailable_day(spot, target_date, str(_day_err))
        days.append(day)

    # ── P0-1: Hard assert — latest must be today ──────────────────────────────
    assert days and days[0]["date"] == local_today, (
        f"ASSERTION FAILED: latest forecast date is {days[0]['date']} "
        f"but local today is {local_today}.  "
        f"past_days data leaked into display array."
    )

    latest = dict(days[0])
    latest["community_report"] = community_data
    return {
        "spot": {k: spot[k] for k in (
            "slug", "name", "menu_name", "location", "region",
            "lat", "lon", "timezone", "tide_label",
            "description", "habitat", "exposure", "calibration_note",
        ) if k in spot},
        "latest": latest,
        "tenDay": days,
    }


def write_pages(spots):
    template_path = ROOT / "spot-template.html"
    if not template_path.exists():
        return
    template = template_path.read_text()
    for spot in spots:
        folder = ROOT / "spots" / spot["slug"]
        folder.mkdir(parents=True, exist_ok=True)
        html = (template
                .replace("{{SPOT_SLUG}}", spot["slug"])
                .replace("{{SPOT_NAME}}", spot["name"]))
        (folder / "index.html").write_text(html)


_PUBLISHABLE_MODEL_SOURCES = ("soft_probabilistic", "point_gbt_fallback")


def _assert_publishable(la_jolla):
    """Exit non-zero when La Jolla has no real model forecast, so the
    workflow fails and the Telegram failure alert fires instead of
    silently publishing an 'unavailable' page."""
    if la_jolla is None:
        raise SystemExit("ERROR: La Jolla spot was not built — failing the run.")
    latest = la_jolla["latest"]
    grade  = latest.get("grade")
    source = latest.get("model_source")
    if grade is None or source not in _PUBLISHABLE_MODEL_SOURCES:
        raise SystemExit(
            f"ERROR: La Jolla forecast unpublishable (grade={grade!r}, "
            f"model_source={source!r}) — failing the run."
        )


def main():
    SPOT_OUT.mkdir(parents=True, exist_ok=True)
    active_slugs = {spot["slug"] for spot in SPOTS}

    # Remove stale JSON for removed spots
    for stale_json in SPOT_OUT.glob("*.json"):
        if stale_json.stem not in active_slugs:
            try:
                stale_json.unlink()
            except OSError as _e:
                print(f"  NOTE: could not remove stale file {stale_json.name}: {_e}")

    # Remove stale spot HTML folders
    spots_root = ROOT / "spots"
    if spots_root.exists():
        for folder in spots_root.iterdir():
            if folder.is_dir() and folder.name not in active_slugs:
                try:
                    shutil.rmtree(folder)
                except OSError as _e:
                    print(f"  NOTE: could not remove stale folder {folder.name}: {_e}")

    summaries = []
    la_jolla  = None

    for spot in SPOTS:
        print(f"\nBuilding {spot['name']}...")
        try:
            built = build_spot(spot)
        except Exception as _e:
            print(f"  ERROR building {spot['name']}: {_e}")
            continue

        (SPOT_OUT / f"{spot['slug']}.json").write_text(json.dumps(built, indent=2))

        _latest = built["latest"]
        cams_built = _latest.get("cams") or []
        thumb = None
        if cams_built:
            first = cams_built[0]
            if first.get("embed") and "/embed/" in first["embed"]:
                vid = first["embed"].split("/embed/")[1].split("?")[0]
                thumb = f"https://img.youtube.com/vi/{vid}/mqdefault.jpg"
            else:
                thumb = "assets/pier-screenshot.png"

        summaries.append({
            **built["spot"],
            "url":          f"spots/{spot['slug']}/",
            "grade":        _latest.get("grade"),
            "score":        _latest.get("numeric_score_0_100"),
            "visibility":   _latest.get("estimated_visibility_range_ft"),
            "is_unavailable": _latest.get("is_unavailable", False),
            "cams":         cams_built,
            "description":  spot["description"],
            "habitat":      spot["habitat"],
            "generated_at": _latest.get("generated_at", ""),
            "camera_note":  spot.get("camera_note", ""),
            "thumb":        thumb,
        })
        if spot["slug"] == "la-jolla":
            la_jolla = built

    (OUT / "spots.json").write_text(json.dumps(summaries, indent=2))

    if la_jolla:
        (OUT / "latest_forecast.json").write_text(json.dumps(la_jolla["latest"], indent=2))
        (OUT / "forecast_10day.json").write_text(json.dumps(la_jolla["tenDay"], indent=2))

    write_pages(SPOTS)
    print(f"\nDone.  {len(summaries)} spots written.")
    if la_jolla:
        latest = la_jolla["latest"]
        print(f"La Jolla latest: {latest['date']}  grade={latest['grade']}  "
              f"range={latest['estimated_visibility_range_ft']}ft  "
              f"model={latest.get('model_source','?')}")
    _assert_publishable(la_jolla)


if __name__ == "__main__":
    main()
