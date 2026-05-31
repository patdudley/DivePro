# ABOUTME: Tests for _classify_chla — maps log1p-transformed chlorophyll to GREEN/YELLOW/RED alert.
# ABOUTME: Verifies thresholds at 0.8 mg/m3 (YELLOW) and 1.5 mg/m3 (RED), plus None handling.
import math
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf


def test_green():
    # log1p(0.5) ≈ 0.405 — below YELLOW threshold
    alert, label = blf._classify_chla(math.log1p(0.5))
    assert alert == "GREEN"
    assert "normal" in label.lower()


def test_yellow():
    # log1p(1.0) ≈ 0.693 — between 0.8 and 1.5 thresholds
    alert, label = blf._classify_chla(math.log1p(1.0))
    assert alert == "YELLOW"
    assert "elevated" in label.lower()


def test_red():
    # log1p(2.0) ≈ 1.099 — above RED threshold
    alert, label = blf._classify_chla(math.log1p(2.0))
    assert alert == "RED"


def test_none_returns_unknown():
    alert, label = blf._classify_chla(None)
    assert alert == "UNKNOWN"
    assert label != ""


def test_boundary_yellow():
    # Exactly at YELLOW threshold (0.8 mg/m3)
    alert, _ = blf._classify_chla(math.log1p(0.8))
    assert alert == "YELLOW"


def test_boundary_red():
    # Exactly at RED threshold (1.5 mg/m3)
    alert, _ = blf._classify_chla(math.log1p(1.5))
    assert alert == "RED"
