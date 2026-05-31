# ABOUTME: Tests for _fetch_tide_hilo — derives tide phase, next event, and slack windows from NOAA H/L data.
# ABOUTME: Covers rising/falling phase, next event lookup, slack window calculation, and error handling.
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf
from unittest.mock import patch, MagicMock
import json


_HILO_RESPONSE = {
    "predictions": [
        {"t": "2026-05-31 01:22", "v": "0.43", "type": "L"},
        {"t": "2026-05-31 07:45", "v": "4.21", "type": "H"},
        {"t": "2026-05-31 14:36", "v": "1.12", "type": "L"},
        {"t": "2026-05-31 21:08", "v": "3.87", "type": "H"},
    ]
}


def _mock_json(payload):
    resp = MagicMock()
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    resp.read.return_value = json.dumps(payload).encode()
    return resp


def test_current_phase_rising():
    # Between 14:36 L and 21:08 H → rising
    with patch("urllib.request.urlopen", return_value=_mock_json(_HILO_RESPONSE)):
        result = blf._fetch_tide_hilo("9410230", "2026-05-31", now_hhmm="16:00")
    assert result["current_phase"] == "rising"


def test_current_phase_falling():
    # Between 07:45 H and 14:36 L → falling
    with patch("urllib.request.urlopen", return_value=_mock_json(_HILO_RESPONSE)):
        result = blf._fetch_tide_hilo("9410230", "2026-05-31", now_hhmm="11:00")
    assert result["current_phase"] == "falling"


def test_next_tide_event():
    with patch("urllib.request.urlopen", return_value=_mock_json(_HILO_RESPONSE)):
        result = blf._fetch_tide_hilo("9410230", "2026-05-31", now_hhmm="16:00")
    assert result["next_tide"]["type"] == "H"
    assert result["next_tide"]["time"] == "21:08"
    assert abs(result["next_tide"]["height_ft"] - 3.87) < 0.01


def test_slack_windows_count():
    with patch("urllib.request.urlopen", return_value=_mock_json(_HILO_RESPONSE)):
        result = blf._fetch_tide_hilo("9410230", "2026-05-31", now_hhmm="16:00")
    assert len(result["slack_windows"]) == 4
    # Each window is ±30 min around each H/L
    assert result["slack_windows"][0]["around"] == "01:22"
    assert result["slack_windows"][0]["start"] == "00:52"
    assert result["slack_windows"][0]["end"] == "01:52"


def test_returns_none_on_error():
    import urllib.error
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timeout")):
        result = blf._fetch_tide_hilo("9410230", "2026-05-31")
    assert result is None
