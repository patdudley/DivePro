"""Parallel physics-focused feature contract for the La Jolla v2 candidate."""

from __future__ import annotations

import math
from datetime import datetime


FEATURE_NAMES = [
    "primary_exposure_energy",
    "secondary_exposure_energy",
    "wind_wave_energy",
    "morning_wind_max_mph",
    "morning_gust_max_mph",
    "rain_prior_3day_in",
    "rain_prior_7day_in",
    "wave_yesterday_ft",
    "wave_3day_trend_ft",
    "sst_f",
    "sst_anomaly_f",
    "morning_tide_mean_ft",
    "morning_tide_range_ft",
    "pressure_trend_hpa",
]

MONOTONIC_CONSTRAINTS = {
    "primary_exposure_energy": -1,
    "secondary_exposure_energy": -1,
    "wind_wave_energy": -1,
    "morning_wind_max_mph": -1,
    "morning_gust_max_mph": -1,
    "rain_prior_3day_in": -1,
    "rain_prior_7day_in": -1,
    "wave_yesterday_ft": 0,
    "wave_3day_trend_ft": 0,
    "sst_f": 0,
    "sst_anomaly_f": 0,
    "morning_tide_mean_ft": 0,
    "morning_tide_range_ft": 0,
    "pressure_trend_hpa": 0,
}


def _hour(timestamp: str) -> int | None:
    try:
        return datetime.fromisoformat(timestamp).hour
    except (TypeError, ValueError):
        return None


def window_indices(times: list[str], target_date: str, start_hour: int = 6, end_hour: int = 14) -> list[int]:
    """Indices inside the inclusive local 06:00–14:00 validity window."""
    result = []
    for index, timestamp in enumerate(times):
        hour = _hour(timestamp)
        if timestamp and timestamp[:10] == target_date and hour is not None and start_hour <= hour <= end_hour:
            result.append(index)
    return result


def _at(values, index):
    return values[index] if index < len(values) else None


def _max_component(hourly: dict, indices: list[int], height_key: str, period_key: str, direction_key: str | None = None):
    heights = hourly.get(height_key) or []
    candidates = [(float(_at(heights, i)), i) for i in indices if _at(heights, i) is not None]
    if not candidates:
        return 0.0, 0.0, None
    height_m, index = max(candidates)
    period = _at(hourly.get(period_key) or [], index)
    direction = _at(hourly.get(direction_key) or [], index) if direction_key else None
    return height_m * 3.28084, float(period or 0.0), direction


def _exposure(direction):
    if direction is None:
        return 0.5
    delta = abs(float(direction) - 250.0)
    if delta > 180:
        delta = 360 - delta
    return max(0.0, math.cos(math.radians(delta)))


def _energy(height_ft: float, period_s: float, exposure: float = 1.0) -> float:
    return height_ft ** 2 * max(period_s, 1.0) * 0.72 * exposure


def build_v2_features(
    marine_hourly: dict,
    weather_hourly: dict,
    tide_points: list[dict],
    target_date: str,
    context: dict,
) -> dict:
    marine_indices = window_indices(marine_hourly.get("time") or [], target_date)
    weather_indices = window_indices(weather_hourly.get("time") or [], target_date)

    p1_h, p1_period, p1_dir = _max_component(
        marine_hourly, marine_indices, "swell_wave_height", "swell_wave_period", "swell_wave_direction"
    )
    p2_h, p2_period, p2_dir = _max_component(
        marine_hourly, marine_indices, "secondary_swell_wave_height", "secondary_swell_wave_period", "secondary_swell_wave_direction"
    )
    ww_h, ww_period, _ = _max_component(
        marine_hourly, marine_indices, "wind_wave_height", "wind_wave_period"
    )

    def maximum(key):
        values = weather_hourly.get(key) or []
        candidates = [float(_at(values, i)) for i in weather_indices if _at(values, i) is not None]
        return max(candidates) if candidates else 0.0

    tide_values = []
    for point in tide_points or []:
        timestamp = str(point.get("time") or "")
        hour = _hour(timestamp)
        if timestamp[:10] == target_date and hour is not None and 6 <= hour <= 14:
            tide_values.append(float(point["height_ft"]))

    wave_yesterday = float(context.get("wave_yesterday_ft") or 0.0)
    wave_3d_ago = float(context.get("wave_3d_ago_ft") or wave_yesterday)
    features = {
        "primary_exposure_energy": _energy(p1_h, p1_period, _exposure(p1_dir)),
        "secondary_exposure_energy": _energy(p2_h, p2_period, _exposure(p2_dir)),
        "wind_wave_energy": _energy(ww_h, ww_period),
        "morning_wind_max_mph": maximum("wind_speed_10m"),
        "morning_gust_max_mph": maximum("wind_gusts_10m"),
        "rain_prior_3day_in": float(context.get("rain_prior_3day_in") or 0.0),
        "rain_prior_7day_in": float(context.get("rain_prior_7day_in") or 0.0),
        "wave_yesterday_ft": wave_yesterday,
        "wave_3day_trend_ft": wave_yesterday - wave_3d_ago,
        "sst_f": context.get("sst_f"),
        "sst_anomaly_f": context.get("sst_anomaly_f"),
        "morning_tide_mean_ft": (sum(tide_values) / len(tide_values)) if tide_values else None,
        "morning_tide_range_ft": (max(tide_values) - min(tide_values)) if tide_values else None,
        "pressure_trend_hpa": context.get("pressure_trend_hpa"),
    }
    if list(features) != FEATURE_NAMES:
        raise AssertionError("v2 feature order drifted")
    return features
