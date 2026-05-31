# ABOUTME: Tests for _fetch_ndbc_water_temp — parses NDBC station 46254 realtime2 data.
# ABOUTME: Covers C-to-F conversion, MM missing value, short response, and HTTP error handling.
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf
from unittest.mock import patch, MagicMock


_SAMPLE_NDBC = b"""\
#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC   mi  hPa    ft
2026 05 31 14 50 280  4.0  5.5   0.9     8   5.4 294 1015.6  16.8  17.3  12.4   MM   MM    MM
2026 05 31 14 20 290  3.8  5.1   0.9     8   5.3 290 1015.8  16.5  17.2  12.2   MM   MM    MM
"""


def _mock_urlopen(content):
    resp = MagicMock()
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    resp.read.return_value = content
    return resp


def test_parses_water_temp_from_ndbc():
    with patch("urllib.request.urlopen", return_value=_mock_urlopen(_SAMPLE_NDBC)):
        result = blf._fetch_ndbc_water_temp()
    assert result is not None
    # 17.3°C → (17.3 * 9/5) + 32 = 63.14°F
    assert abs(result["water_temp_f"] - 63.1) < 0.2
    assert result["water_temp_c"] == 17.3
    assert result["source"] == "ndbc_46254"


def test_returns_none_on_http_error():
    import urllib.error
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timeout")):
        result = blf._fetch_ndbc_water_temp()
    assert result is None


def test_returns_none_when_wtmp_is_mm():
    no_temp = _SAMPLE_NDBC.decode().replace("17.3", "MM").encode()
    with patch("urllib.request.urlopen", return_value=_mock_urlopen(no_temp)):
        result = blf._fetch_ndbc_water_temp()
    assert result is None


def test_returns_none_when_response_too_short():
    with patch("urllib.request.urlopen", return_value=_mock_urlopen(b"#header\n#units\n")):
        result = blf._fetch_ndbc_water_temp()
    assert result is None
