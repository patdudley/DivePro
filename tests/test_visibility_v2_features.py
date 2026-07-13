import pytest

from visibility_v2_features import FEATURE_NAMES, MONOTONIC_CONSTRAINTS, build_v2_features, window_indices


def test_window_indices_only_include_local_valid_window():
    times = [f"2030-07-12T{hour:02d}:00" for hour in range(24)]
    assert window_indices(times, "2030-07-12") == list(range(6, 15))


def test_window_indices_handle_offset_timestamps_at_dst_boundary():
    times = ["2030-11-03T05:00:00-08:00", "2030-11-03T06:00:00-08:00", "2030-11-03T14:00:00-08:00", "2030-11-03T15:00:00-08:00"]
    assert window_indices(times, "2030-11-03") == [1, 2]


def test_v2_features_use_morning_component_and_wind_maxima():
    times = [f"2030-07-12T{hour:02d}:00" for hour in range(24)]
    marine = {
        "time": times,
        "swell_wave_height": [0.5] * 24,
        "swell_wave_period": [10] * 24,
        "swell_wave_direction": [250] * 24,
        "secondary_swell_wave_height": [0.2] * 24,
        "secondary_swell_wave_period": [8] * 24,
        "secondary_swell_wave_direction": [260] * 24,
        "wind_wave_height": [0.1] * 24,
        "wind_wave_period": [4] * 24,
    }
    marine["swell_wave_height"][18] = 4.0  # excluded afternoon spike
    weather = {"time": times, "wind_speed_10m": [5] * 24, "wind_gusts_10m": [8] * 24}
    weather["wind_speed_10m"][10] = 9
    weather["wind_speed_10m"][18] = 30  # excluded afternoon sea breeze
    tides = [{"time": "2030-07-12T06:00", "height_ft": 1}, {"time": "2030-07-12T14:00", "height_ft": 4}]
    result = build_v2_features(marine, weather, tides, "2030-07-12", {
        "wave_yesterday_ft": 3, "wave_3d_ago_ft": 2, "sst_f": 68,
        "sst_anomaly_f": 1, "pressure_trend_hpa": -2,
    })
    assert list(result) == FEATURE_NAMES
    assert result["morning_wind_max_mph"] == 9
    assert result["morning_tide_mean_ft"] == pytest.approx(2.5)
    assert result["morning_tide_range_ft"] == pytest.approx(3)
    assert result["wave_3day_trend_ft"] == pytest.approx(1)
    assert result["primary_exposure_energy"] < 100


def test_calendar_features_are_absent_and_constraints_cover_schema():
    assert not {"month", "sin_doy", "cos_doy"} & set(FEATURE_NAMES)
    assert set(MONOTONIC_CONSTRAINTS) == set(FEATURE_NAMES)
