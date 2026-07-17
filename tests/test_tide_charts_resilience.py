# ABOUTME: Regression tests for NOAA tide prediction semantic errors and range fallback.
# ABOUTME: Prevents HTTP-200 error payloads from publishing an empty current-day chart.
from unittest.mock import MagicMock, patch

import pytest

import build_location_forecasts as blf
import data_sources


SPOT = {"tide_station": "9410230"}


def _predictions(*dates):
    return [
        {"t": f"{target_date} {hour:02d}:00", "v": str(hour / 10)}
        for target_date in dates
        for hour in range(24)
    ]


def test_tide_charts_fetches_in_three_day_chunks():
    dates = ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]
    with patch.object(
        blf,
        "_fetch_tide_predictions",
        side_effect=[_predictions(*dates[:3]), _predictions(dates[3])],
    ) as fetch:
        charts = blf.tide_charts(SPOT, dates)

    assert [len(charts[target_date]) for target_date in dates] == [24, 24, 24, 24]
    assert fetch.call_args_list[0].args == ("9410230", dates[0], dates[2])
    assert fetch.call_args_list[1].args == ("9410230", dates[3], dates[3])


def test_failed_chunk_falls_back_to_daily_requests():
    dates = ["2026-07-17", "2026-07-18", "2026-07-19"]
    with patch.object(
        blf,
        "_fetch_tide_predictions",
        side_effect=[
            RuntimeError("NOAA semantic error"),
            _predictions(dates[0]),
            _predictions(dates[1]),
            _predictions(dates[2]),
        ],
    ) as fetch:
        charts = blf.tide_charts(SPOT, dates)

    assert [len(charts[target_date]) for target_date in dates] == [24, 24, 24]
    assert fetch.call_count == 4


def test_partial_chunk_refetches_only_missing_date():
    dates = ["2026-07-17", "2026-07-18", "2026-07-19"]
    with patch.object(
        blf,
        "_fetch_tide_predictions",
        side_effect=[
            _predictions(dates[0], dates[2]),
            _predictions(dates[1]),
        ],
    ) as fetch:
        charts = blf.tide_charts(SPOT, dates)

    assert [len(charts[target_date]) for target_date in dates] == [24, 24, 24]
    assert fetch.call_count == 2
    assert fetch.call_args_list[1].args == ("9410230", dates[1], dates[1])


def test_missing_future_date_does_not_erase_current_tides():
    dates = ["2026-07-17", "2026-07-18"]
    with patch.object(
        blf,
        "_fetch_tide_predictions",
        side_effect=[_predictions(dates[0]), RuntimeError("future unavailable")],
    ):
        charts = blf.tide_charts(SPOT, dates)

    assert len(charts[dates[0]]) == 24
    assert charts[dates[1]] == []


def test_missing_current_date_fails_closed():
    dates = ["2026-07-17", "2026-07-18"]
    with patch.object(
        blf,
        "_fetch_tide_predictions",
        side_effect=[_predictions(dates[1]), RuntimeError("current unavailable")],
    ):
        with pytest.raises(RuntimeError, match="refusing to publish"):
            blf.tide_charts(SPOT, dates)


def test_semantic_error_payload_is_retried():
    error = {"error": {"message": "No Predictions data was found."}}
    success = {"predictions": _predictions("2026-07-17")}
    with patch("data_sources._get_json_with_retry", side_effect=[error, success]) as get:
        with patch("data_sources.time.sleep") as sleep:
            predictions = blf._fetch_tide_predictions(
                "9410230", "2026-07-17", "2026-07-17"
            )

    assert len(predictions) == 24
    assert get.call_count == 2
    sleep.assert_called_once_with(1)
    first_request = get.call_args_list[0].args[0]
    retry_request = get.call_args_list[1].args[0]
    assert first_request.get_header("Cache-control") == "no-cache"
    assert "retry_nonce=" not in first_request.full_url
    assert "retry_nonce=" in retry_request.full_url


def test_semantic_errors_fall_back_to_csv_predictions():
    error = {"error": {"message": "No Predictions data was found."}}
    csv_predictions = _predictions("2026-07-17")
    with patch("data_sources._get_json_with_retry", return_value=error):
        with patch("data_sources._get_noaa_csv_predictions", return_value=csv_predictions):
            with patch("data_sources.time.sleep"):
                predictions = blf._fetch_tide_predictions(
                    "9410230", "2026-07-17", "2026-07-17"
                )

    assert predictions == csv_predictions


def test_csv_fallback_parses_noaa_header_spacing():
    csv_body = (
        "Date Time, Prediction\n"
        "2026-07-17 00:00,6.026\n"
        "2026-07-17 01:00,5.215\n"
    ).encode()
    response = MagicMock()
    response.__enter__ = lambda value: value
    response.__exit__ = MagicMock(return_value=False)
    response.read.return_value = csv_body

    url = blf._tide_predictions_url("9410230", "2026-07-17", "2026-07-17")
    with patch("urllib.request.urlopen", return_value=response):
        predictions = data_sources._get_noaa_csv_predictions(url)

    assert predictions == [
        {"t": "2026-07-17 00:00", "v": "6.026"},
        {"t": "2026-07-17 01:00", "v": "5.215"},
    ]


def test_csv_fallback_retries_semantic_error_text():
    error_response = MagicMock()
    error_response.__enter__ = lambda value: value
    error_response.__exit__ = MagicMock(return_value=False)
    error_response.read.return_value = (
        "Date Time, Prediction\n"
        "No Predictions data was found. Please make sure the Datum input is valid.\n"
    ).encode()
    valid_response = MagicMock()
    valid_response.__enter__ = lambda value: value
    valid_response.__exit__ = MagicMock(return_value=False)
    valid_response.read.return_value = (
        "Date Time, Prediction\n2026-07-17 00:00,6.026\n"
    ).encode()

    url = blf._tide_predictions_url("9410230", "2026-07-17", "2026-07-17")
    with patch(
        "urllib.request.urlopen", side_effect=[error_response, valid_response]
    ) as request:
        with patch("data_sources.time.sleep") as sleep:
            predictions = data_sources._get_noaa_csv_predictions(url)

    assert predictions == [{"t": "2026-07-17 00:00", "v": "6.026"}]
    assert request.call_count == 2
    sleep.assert_called_once_with(1)
