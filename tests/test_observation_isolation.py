import json
from pathlib import Path
from unittest.mock import patch

import numpy as np

import build_location_forecasts as blf


ROOT = Path(__file__).resolve().parents[1]


def test_community_fields_cannot_enter_model_feature_map():
    base = {"ml_p1_height_ft": 2.5, "ml_p1_period_s": 12, "wind_speed_max_mph": 8}
    clean = blf._build_lajolla_feat_map(base)
    contaminated = blf._build_lajolla_feat_map({
        **base,
        "community_report": {"visibility_ft": [30, 40]},
        "jgw_visibility_ft": 40,
        "observed_visibility_ft": 40,
    })
    assert contaminated == clean


def test_frozen_model_schema_contains_no_observation_features():
    names = json.loads((ROOT / "model_lajolla_soft_features.json").read_text())["features"]
    prohibited = ("community", "jgw", "justgetwet", "observ")
    assert not [name for name in names if any(token in name.lower() for token in prohibited)]


def test_private_observation_keys_are_not_published():
    prohibited = {"observation_id", "source_reference_hash", "vis_value_type", "supersedes_observation_id"}
    for path in (ROOT / "model_outputs").glob("**/*.json"):
        payload = path.read_text()
        assert not [key for key in prohibited if f'"{key}"' in payload], path


def test_collection_token_is_isolated_to_collection_workflow():
    workflows = list((ROOT / ".github" / "workflows").glob("*.yml"))
    references = [path.name for path in workflows if "EVAL_REPO_TOKEN" in path.read_text()]
    assert references == ["collect-evaluation-observations.yml"]
    forecast_workflow = (ROOT / ".github" / "workflows" / "update-forecast.yml").read_text()
    assert "DivePro-evaluation-data" not in forecast_workflow
    collector = (ROOT / ".github" / "workflows" / "collect-evaluation-observations.yml").read_text()
    assert "permissions:\n  contents: read" in collector


class _FixedSoftModel:
    def predict(self, _features):
        return np.array([[0.0, 0.53, 0.41, 0.06, 0.0, 0.0]])


def test_community_report_variants_cannot_change_prediction_outputs():
    base = {
        "ml_p1_height_ft": 2.5,
        "ml_p1_period_s": 12,
        "ml_p1_direction_deg": 210,
        "wind_speed_max_mph": 8,
    }
    reports = [
        {"visibility_ft": [30, 30], "weight": 1.0},
        {"visibility_ft": [2, 2], "weight": 1.0},
        {"error": "source unavailable", "visibility_ft": None, "weight": 0.0},
        {"visibility_ft": None, "weight": 0.0, "error": None},
    ]
    outputs = []
    with patch.object(blf, "_LAJOLLA_SOFT_MODEL", _FixedSoftModel()), \
         patch.object(blf, "_LAJOLLA_SOFT_FEATURES", list(blf._build_lajolla_feat_map(base))):
        for report in reports:
            prediction = blf.predict_lajolla({**base, "community_report": report})
            outputs.append({
                "grade": prediction["display_grade"],
                "probabilities": prediction["probabilities"],
                "range": prediction["vis_range"],
                "raw_expected_vis_ft": prediction["raw_expected_vis_ft"],
                "guarded_vis_ft": prediction["guarded_vis_ft"],
            })
    assert outputs[1:] == [outputs[0], outputs[0], outputs[0]]
