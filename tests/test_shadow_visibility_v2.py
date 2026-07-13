import numpy as np
from unittest.mock import patch

import build_location_forecasts as blf
from shadow_visibility_v2 import predict
from visibility_v2_features import FEATURE_NAMES


class ConstantModel:
    def __init__(self, value):
        self.value = value

    def predict(self, X):
        return np.array([self.value])


def test_shadow_quantiles_are_ordered_even_if_estimators_cross():
    artifact = {
        "feature_names": FEATURE_NAMES,
        "candidate": {"kind": "boosting", "models": {0.2: ConstantModel(14), 0.5: ConstantModel(10), 0.8: ConstantModel(12)}},
    }
    assert predict(artifact, {name: 1 for name in FEATURE_NAMES}) == (10.0, 12.0, 14.0)


def test_optional_shadow_path_logs_without_changing_public_prediction(tmp_path):
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
    weather = {"time": times, "wind_speed_10m": [5] * 24, "wind_gusts_10m": [8] * 24}
    model_path = tmp_path / "candidate.pkl"
    model_path.write_bytes(b"artifact-hash-fixture")
    artifact = {
        "feature_names": FEATURE_NAMES,
        "policy_version": "shadow-v1",
        "candidate": {"kind": "linear", "model": ConstantModel(12), "residual_q20": -2, "residual_q80": 2},
    }
    output = tmp_path / "shadow.csv"
    with patch.object(blf, "_LAJOLLA_V2_ARTIFACT", artifact), \
         patch.object(blf, "_LAJOLLA_V2_ARTIFACT_PATH", model_path), \
         patch.object(blf, "SHADOW_LOG_PATH", output):
        wrote = blf._append_v2_shadow_if_available(
            marine, weather, [], "2030-07-12",
            {"sst_f": 68, "sst_anomaly_f": 1, "wave_yesterday_ft": 2, "wave_3d_ago_ft": 2},
            {"forecast_id": "forecast-1", "target_date": "2030-07-12"},
        )
    assert wrote is True
    text = output.read_text()
    assert "forecast-1" in text
    assert ",10.0,12.0,14.0,C," in text
