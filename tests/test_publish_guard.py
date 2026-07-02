# ABOUTME: Tests the publish guard that fails the forecast build (non-zero exit)
# ABOUTME: when La Jolla output has no model grade, so the CI failure alert fires.
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf


def _spot(grade="C", model_source="soft_probabilistic"):
    return {"latest": {"grade": grade, "model_source": model_source}}


def test_soft_model_output_passes():
    blf._assert_publishable(_spot())


def test_point_fallback_output_passes():
    blf._assert_publishable(_spot(grade="B", model_source="point_gbt_fallback"))


def test_unavailable_output_raises():
    with pytest.raises(SystemExit):
        blf._assert_publishable(_spot(grade=None, model_source="unavailable"))


def test_model_source_none_raises():
    with pytest.raises(SystemExit):
        blf._assert_publishable(_spot(model_source="none"))


def test_missing_spot_raises():
    with pytest.raises(SystemExit):
        blf._assert_publishable(None)
