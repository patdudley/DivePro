import numpy as np
import pandas as pd

from scripts.train_visibility_v2 import FEATURE_NAMES, boosting_candidate, cross_validate, load_training_data


def test_boosting_candidate_respects_disturbance_monotonicity():
    rng = np.random.default_rng(42)
    X = rng.uniform(0, 10, size=(240, len(FEATURE_NAMES)))
    y = 25 - 1.5 * X[:, 0] - 0.8 * X[:, 3] + rng.normal(0, 0.2, size=240)
    model = boosting_candidate(0.5).fit(X, y)
    calm = np.full((1, len(FEATURE_NAMES)), 3.0)
    disturbed = calm.copy()
    disturbed[0, 0] = 9.0
    assert model.predict(disturbed)[0] <= model.predict(calm)[0]


def test_time_blocked_training_pipeline_generates_multiple_folds(tmp_path):
    rng = np.random.default_rng(7)
    count = 190
    X = rng.uniform(0, 10, size=(count, len(FEATURE_NAMES)))
    target = np.clip(24 - X[:, 0] - 0.5 * X[:, 3], 2, 40)
    data = {name: X[:, index] for index, name in enumerate(FEATURE_NAMES)}
    data.update({
        "date": pd.date_range("2024-01-01", periods=count, freq="D"),
        "vis_min_ft": np.maximum(0, target - 2),
        "vis_max_ft": target + 2,
        "vis_value_type": ["closed_range"] * count,
    })
    path = tmp_path / "training.csv"
    pd.DataFrame(data).to_csv(path, index=False)
    report = cross_validate(load_training_data(path))
    assert report["selected"] in {"linear", "boosting"}
    assert len(report["linear"]["folds"]) >= 2
    assert len(report["boosting"]["folds"]) >= 2
