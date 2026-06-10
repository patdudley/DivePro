# ABOUTME: Characterization tests for the forecast core — grade bands, date-keyed
# ABOUTME: lookups, ML feature map (frozen schema contract), prediction guardrail, build_day shape.
import json
import pathlib
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf

try:
    import numpy as np
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOFT_SCHEMA = json.loads((ROOT / "model_lajolla_soft_features.json").read_text())


# ── Grade bands ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("vis,expected", [
    (0.0, "F"), (4.99, "F"),
    (5.0, "D"), (9.99, "D"),
    (10.0, "C"), (14.99, "C"),
    (15.0, "B"), (24.99, "B"),
    (25.0, "A"), (34.99, "A"),
    (35.0, "A+"), (50.0, "A+"),
])
def test_grade_from_visibility_bands(vis, expected):
    assert blf.grade_from_visibility(vis) == expected


@pytest.mark.parametrize("grade,band", [
    ("F", [0, 4]), ("D", [5, 9]), ("C", [10, 14]),
    ("B", [15, 24]), ("A", [25, 34]), ("A+", [35, 45]),
])
def test_visibility_range_from_grade(grade, band):
    assert blf.visibility_range_from_grade(grade) == band


def test_visibility_range_unknown_grade_defaults_to_f_band():
    assert blf.visibility_range_from_grade("?") == [0, 4]


# ── Date-keyed lookups (P0-1 / P1-3) ──────────────────────────────────────────

DAILY = {
    "time": ["2030-01-01", "2030-01-02", "2030-01-03", "2030-01-04"],
    "precipitation_sum": [0.5, 0.2, None, 0.1],
}


def test_value_on_date_matches_by_date_not_index():
    assert blf.value_on_date(DAILY, "precipitation_sum", "2030-01-02") == 0.2


def test_value_on_date_missing_date_returns_fallback():
    assert blf.value_on_date(DAILY, "precipitation_sum", "2029-12-31", fallback=-1) == -1


def test_value_on_date_none_value_returns_fallback():
    assert blf.value_on_date(DAILY, "precipitation_sum", "2030-01-03", fallback=-1) == -1


def test_rain_prior_window_excludes_target_date():
    # 3-day prior window for Jan 4 = Jan 1 + Jan 2 + Jan 3 (None skipped),
    # and must NOT include Jan 4 itself.
    assert blf.rain_prior_window(DAILY, "2030-01-04", 3) == pytest.approx(0.7)


def test_rain_prior_window_no_data_is_zero():
    assert blf.rain_prior_window(DAILY, "2029-01-01", 7) == 0.0


# ── ML feature map — frozen model schema contract ─────────────────────────────

def test_feat_map_covers_frozen_soft_model_schema():
    feat_map = blf._build_lajolla_feat_map({})
    missing = [f for f in SOFT_SCHEMA["features"] if f not in feat_map]
    assert not missing, f"feature map missing frozen-schema features: {missing}"


def test_feat_map_defaults_from_empty_features():
    fm = blf._build_lajolla_feat_map({})
    assert fm["p1_h"] == 0
    assert fm["p1_per"] == 10
    assert fm["sst_f"] == 65.0
    assert fm["month"] == 6.0
    assert fm["tide_range"] == 4.0
    assert fm["tide_morning"] == 2.0
    assert fm["rain_flag"] == 0.0
    # No primary direction: sin 0 / cos 1, not in the blocked window
    assert fm["p1_dir_sin"] == 0.0
    assert fm["p1_dir_cos"] == 1.0
    assert fm["p1_dir_blocked"] == 0.0


def test_feat_map_energy_matches_production_formula():
    features = {
        "ml_p1_height_ft": 3.0, "ml_p1_period_s": 14.0,
        "ml_p2_height_ft": 1.5, "ml_p2_period_s": 8.0,
        "ml_ww_height_ft": 1.0, "ml_ww_period_s": 5.0,
    }
    fm = blf._build_lajolla_feat_map(features)
    bundle = blf._production_feat_bundle(3.0, 14.0, 1.5, 8.0, 1.0, 5.0)
    assert fm["p1_energy_raw"] == bundle["p1_energy_raw"]
    assert fm["total_energy"] == bundle["total_energy"]
    assert fm["n_swells"] == bundle["n_swells"]


@pytest.mark.parametrize("rain3,flag", [(0.05, 0.0), (0.06, 1.0)])
def test_feat_map_rain_flag_threshold(rain3, flag):
    fm = blf._build_lajolla_feat_map({"rain_prior_3day_in": rain3})
    assert fm["rain_flag"] == flag


@pytest.mark.parametrize("deg,blocked", [(0.0, 1.0), (135.0, 1.0), (136.0, 0.0), (270.0, 0.0)])
def test_feat_map_p1_direction_blocked_window(deg, blocked):
    fm = blf._build_lajolla_feat_map({"ml_p1_direction_deg": deg})
    assert fm["p1_dir_blocked"] == blocked


def test_feat_map_p2_direction_fills_from_p1():
    fm = blf._build_lajolla_feat_map({"ml_p1_direction_deg": 270.0})
    assert fm["p2_dir_sin"] == fm["p1_dir_sin"]
    assert fm["p2_dir_cos"] == fm["p1_dir_cos"]


# ── predict_lajolla ────────────────────────────────────────────────────────────

def test_predict_with_no_model_returns_safe_default():
    with patch.object(blf, "_LAJOLLA_SOFT_MODEL", None), \
         patch.object(blf, "_LAJOLLA_MODEL", None):
        result = blf.predict_lajolla({})
    assert result["model_source"] == "none"
    assert result["display_grade"] is None
    assert result["vis_range"] == [0, 4]
    assert result["guardrail_applied"] is False


def _stub_soft_model(prob_row):
    model = MagicMock()
    model.predict.return_value = np.array([prob_row])
    return model


@pytest.mark.skipif(not HAVE_NUMPY, reason="numpy not installed (model env only)")
def test_predict_soft_model_normalizes_probs_and_uses_argmax_grade():
    # Unnormalized vector peaking at grade B
    model = _stub_soft_model([0.0, 0.2, 0.4, 1.0, 0.2, 0.2])
    with patch.object(blf, "_LAJOLLA_SOFT_MODEL", model), \
         patch.object(blf, "_LAJOLLA_SOFT_FEATURES", SOFT_SCHEMA["features"]):
        result = blf.predict_lajolla({})
    assert result["model_source"] == "soft_probabilistic"
    assert sum(result["probabilities"].values()) == pytest.approx(1.0)
    assert result["display_grade"] == "B"
    assert result["vis_range"] == [15, 24]
    assert result["guardrail_applied"] is False


@pytest.mark.skipif(not HAVE_NUMPY, reason="numpy not installed (model env only)")
def test_predict_guardrail_caps_large_swell_with_heavy_rain():
    # Model says A (30 ft expected) but big swell + heavy prior rain must cap to <= 10 ft
    model = _stub_soft_model([0.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    features = {"ml_p1_height_ft": 5.0, "rain_prior_3day_in": 1.0}
    with patch.object(blf, "_LAJOLLA_SOFT_MODEL", model), \
         patch.object(blf, "_LAJOLLA_SOFT_FEATURES", SOFT_SCHEMA["features"]):
        result = blf.predict_lajolla(features)
    assert result["guardrail_applied"] is True
    assert result["guarded_vis_ft"] <= 10.0
    assert result["display_grade"] == blf.grade_from_visibility(result["guarded_vis_ft"])
    # Raw model output must be preserved for evaluation, not collapsed
    assert result["raw_grade_probabilities"]["A"] == pytest.approx(1.0)


@pytest.mark.skipif(not HAVE_NUMPY, reason="numpy not installed (model env only)")
def test_predict_raises_no_guardrail_on_calm_conditions():
    model = _stub_soft_model([0.0, 0.0, 1.0, 0.0, 0.0, 0.0])
    with patch.object(blf, "_LAJOLLA_SOFT_MODEL", model), \
         patch.object(blf, "_LAJOLLA_SOFT_FEATURES", SOFT_SCHEMA["features"]):
        result = blf.predict_lajolla({"ml_p1_height_ft": 2.0, "rain_prior_3day_in": 0.0})
    assert result["guardrail_applied"] is False
    assert result["display_grade"] == "C"


# ── build_day output shape ─────────────────────────────────────────────────────

TARGET = "2030-06-15"
PRIOR_DATES = [f"2030-06-{d:02d}" for d in range(8, 15)]
ALL_DATES = PRIOR_DATES + [TARGET]


def _daily(key_values):
    return {"time": ALL_DATES, **{k: [v] * len(ALL_DATES) for k, v in key_values.items()}}


def _fixture_inputs():
    marine = {
        "daily": _daily({
            "wave_height_max": 0.6,            # meters
            "swell_wave_height_max": 0.5,
            "swell_wave_period_max": 14.0,
            "swell_wave_direction_dominant": 275.0,
            "wind_wave_height_max": 0.2,
            "wind_wave_period_max": 4.0,
            "sea_surface_temperature_max": 18.0,
        }),
        "hourly": {},
    }
    long_range = {"daily": _daily({"wave_height_max": 2.0, "wave_period_max": 13.0})}
    weather = {
        "daily": _daily({
            "wind_speed_10m_max": 6.0,
            "wind_gusts_10m_max": 10.0,
            "temperature_2m_max": 72.0,
            "temperature_2m_min": 62.0,
            "precipitation_sum": 0.0,
            "surface_pressure_mean": 1015.0,
        }),
        "hourly": {},
    }
    tide_points = [
        {"time": f"{TARGET}T06:00", "height_ft": 2.0},
        {"time": f"{TARGET}T08:00", "height_ft": 3.5},
        {"time": f"{TARGET}T12:00", "height_ft": 1.0},
    ]
    return marine, long_range, weather, tide_points


SOFT_PREDICTION = {
    "probabilities": {"F": 0.05, "D": 0.2, "C": 0.5, "B": 0.2, "A": 0.05, "A+": 0.0},
    "raw_grade_probabilities": {"F": 0.05, "D": 0.2, "C": 0.5, "B": 0.2, "A": 0.05, "A+": 0.0},
    "raw_expected_vis_ft": 12.4,
    "guardrail_applied": False,
    "guardrail_reason": "",
    "guarded_vis_ft": 12.4,
    "display_grade": "C",
    "display_grade_after_guardrail": None,
    "vis_range": [10, 14],
    "model_source": "soft_probabilistic",
}


def _build_day(marine, long_range, weather, tide_points, tmp_path):
    # Stub the model prediction (no sklearn/numpy needed locally) and keep the
    # prospective log out of the real append-only forecast_log.csv.
    with patch.object(blf, "predict_lajolla", return_value=dict(SOFT_PREDICTION)), \
         patch.object(blf, "FORECAST_LOG_PATH", tmp_path / "forecast_log.csv"):
        return blf.build_day(blf.SPOTS[0], marine, long_range, weather, TARGET, tide_points)


def test_build_day_output_shape_and_values(tmp_path):
    marine, long_range, weather, tide_points = _fixture_inputs()
    day = _build_day(marine, long_range, weather, tide_points, tmp_path)

    assert day["date"] == TARGET
    assert day["spot_slug"] == "la-jolla"
    assert day.get("is_unavailable") is not True
    assert day["grade"] == "C"
    assert day["model_source"] == "soft_probabilistic"
    assert day["estimated_visibility_range_ft"] == [10, 14]
    assert day["estimated_visibility_mid_ft"] == pytest.approx(12.0)
    assert day["grade_probabilities"]["C"] == pytest.approx(0.5)
    assert day["report_text"].startswith("3:00 PM Update - Grade C")
    assert day["features"]["rain_prior_3day_in"] == 0.0
    assert day["features"]["ml_tide_range_ft"] == pytest.approx(2.5)
    assert isinstance(day["risk_factors"], list) and day["risk_factors"]
    assert isinstance(day["positive_factors"], list)


def test_build_day_writes_prospective_log_row(tmp_path):
    marine, long_range, weather, tide_points = _fixture_inputs()
    _build_day(marine, long_range, weather, tide_points, tmp_path)
    log = tmp_path / "forecast_log.csv"
    assert log.exists()
    assert TARGET in log.read_text()


def test_build_day_components_available_not_projected(tmp_path):
    marine, long_range, weather, tide_points = _fixture_inputs()
    day = _build_day(marine, long_range, weather, tide_points, tmp_path)
    assert day["is_projected"] is False
    assert day["forecast_basis"] == "Open-Meteo marine components"


def test_build_day_missing_components_falls_back_to_proxy(tmp_path):
    marine, long_range, weather, tide_points = _fixture_inputs()
    marine["daily"] = {"time": ALL_DATES}  # no component fields at all
    day = _build_day(marine, long_range, weather, tide_points, tmp_path)
    assert day["is_projected"] is True
    assert day["forecast_basis"] == "Open-Meteo ECMWF WAM total-wave proxy"
