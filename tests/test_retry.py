# ABOUTME: Tests for _get_json_with_retry — exponential backoff on transient HTTP errors.
# ABOUTME: Covers success, 429/503 retry, 404 no-retry, URLError retry, and max-retries exhaustion.
import json
import urllib.error
import urllib.request
from unittest.mock import MagicMock, call, patch

import pytest

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build_location_forecasts as blf


def _http_error(code):
    resp = MagicMock()
    resp.code = code
    return urllib.error.HTTPError("http://x", code, str(code), {}, None)


def test_success_on_first_attempt():
    payload = json.dumps({"ok": True}).encode()
    mock_resp = MagicMock()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock_resp.read.return_value = payload
    with patch("urllib.request.urlopen", return_value=mock_resp) as m:
        result = blf._get_json_with_retry("http://example.com/data")
    assert result == {"ok": True}
    assert m.call_count == 1


def test_retries_on_503_then_succeeds():
    payload = json.dumps({"ok": True}).encode()
    ok_resp = MagicMock()
    ok_resp.__enter__ = lambda s: s
    ok_resp.__exit__ = MagicMock(return_value=False)
    ok_resp.read.return_value = payload
    with patch("urllib.request.urlopen", side_effect=[_http_error(503), ok_resp]) as m:
        with patch("time.sleep"):
            result = blf._get_json_with_retry("http://example.com/data")
    assert result == {"ok": True}
    assert m.call_count == 2


def test_retries_on_429_then_succeeds():
    payload = json.dumps({"rate": "ok"}).encode()
    ok_resp = MagicMock()
    ok_resp.__enter__ = lambda s: s
    ok_resp.__exit__ = MagicMock(return_value=False)
    ok_resp.read.return_value = payload
    with patch("urllib.request.urlopen", side_effect=[_http_error(429), _http_error(429), ok_resp]) as m:
        with patch("time.sleep") as sleep_mock:
            result = blf._get_json_with_retry("http://example.com/data")
    assert result == {"rate": "ok"}
    assert m.call_count == 3
    assert sleep_mock.call_count == 2


def test_raises_after_max_retries():
    with patch("urllib.request.urlopen", side_effect=_http_error(502)):
        with patch("time.sleep"):
            with pytest.raises(urllib.error.HTTPError) as exc_info:
                blf._get_json_with_retry("http://example.com/data", retries=3)
    assert exc_info.value.code == 502


def test_does_not_retry_on_404():
    with patch("urllib.request.urlopen", side_effect=_http_error(404)) as m:
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            blf._get_json_with_retry("http://example.com/data")
    assert exc_info.value.code == 404
    assert m.call_count == 1


def test_retries_on_url_error():
    ok_payload = json.dumps({"ok": True}).encode()
    ok_resp = MagicMock()
    ok_resp.__enter__ = lambda s: s
    ok_resp.__exit__ = MagicMock(return_value=False)
    ok_resp.read.return_value = ok_payload
    url_err = urllib.error.URLError("connection reset")
    with patch("urllib.request.urlopen", side_effect=[url_err, ok_resp]) as m:
        with patch("time.sleep"):
            result = blf._get_json_with_retry("http://example.com/data")
    assert result == {"ok": True}
    assert m.call_count == 2
