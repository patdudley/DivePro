# ABOUTME: External data fetchers for the DivePro forecast — HTTP retry plumbing,
# ABOUTME: NOAA CoastWatch chlorophyll, NDBC buoy water temp, and NOAA CO-OPS tide H/L events.
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime


def get_json(url):
    with urllib.request.urlopen(url, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_json_with_retry(url, timeout=25, retries=3):
    delay = 1
    last_exc = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 502, 503, 504):
                last_exc = exc
                if attempt < retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
            raise
        except urllib.error.URLError as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise last_exc


def api_url(base, params):
    return base + "?" + urllib.parse.urlencode(params)


# ── La Jolla chlorophyll (MODIS Aqua, NOAA CoastWatch ERDDAP) ────────────────
_CHLA_LAT  = 32.850
_CHLA_LON  = -117.310


def _fetch_chla_recent(n_days=14):
    """Fetch the last n_days of MODIS Aqua daily chlorophyll-a for La Jolla."""
    from datetime import date as _d, timedelta as _td
    end   = _d.today()
    start = end - _td(days=n_days)
    t_start = f"{start}T12:00:00Z"
    t_end   = f"{end}T12:00:00Z"
    url = (
        f"https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1chla1day.csv"
        f"?chlorophyll[({t_start}):1:({t_end})]"
        f"[({_CHLA_LAT}):1:({_CHLA_LAT})][({_CHLA_LON}):1:({_CHLA_LON})]"
    )
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            text = resp.read().decode("utf-8")
        lines = [l for l in text.strip().splitlines() if l]
        raw = {}
        for line in lines[2:]:
            parts = line.split(",")
            if len(parts) < 4:
                continue
            date_str = parts[0][:10]
            try:
                val = float(parts[3])
                raw[date_str] = val
            except (ValueError, IndexError):
                raw[date_str] = None
        sorted_dates = sorted(raw.keys())
        last_val = None
        ffilled = {}
        for d in sorted_dates:
            v = raw[d]
            if v is not None and v > 0:
                last_val = v
            ffilled[d] = last_val
        last_val = None
        filled = {}
        for d in reversed(sorted_dates):
            v = ffilled[d]
            if v is not None:
                last_val = v
            filled[d] = last_val
        import math as _mth
        return {d: round(_mth.log1p(v), 3) if v is not None else None
                for d, v in filled.items()}
    except Exception:
        return {}


_NDBC_STATION = "46254"


def _fetch_ndbc_water_temp():
    """Fetch current water temperature from NDBC buoy 46254 (Scripps Pier nearshore).

    Returns dict with water_temp_f, water_temp_c, source — or None on any failure.
    This is for display only; do NOT use as ml_sst_f model input.
    """
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{_NDBC_STATION}.txt"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            lines = resp.read().decode("utf-8", errors="replace").strip().splitlines()
        if len(lines) < 3:
            return None
        parts = lines[2].split()
        if len(parts) <= 14:
            return None
        raw = parts[14]
        if raw == "MM":
            return None
        temp_c = float(raw)
        temp_f = round((temp_c * 9 / 5) + 32, 1)
        return {"water_temp_f": temp_f, "water_temp_c": temp_c, "source": f"ndbc_{_NDBC_STATION}"}
    except Exception:
        return None


def _fetch_tide_hilo(tide_station, target_date, now_hhmm=None):
    """Fetch H/L tide events for target_date and derive phase, next event, and slack windows.

    now_hhmm: override current time as "HH:MM" string (for testing). Defaults to actual local time.
    Returns dict with current_phase, next_tide, slack_windows — or None on any failure.
    """
    url = api_url("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
        "product": "predictions",
        "application": "diveprousa",
        "begin_date": target_date.replace("-", ""),
        "end_date": target_date.replace("-", ""),
        "datum": "MLLW",
        "station": tide_station,
        "time_zone": "lst_ldt",
        "interval": "hilo",
        "units": "english",
        "format": "json",
    })
    try:
        data = _get_json_with_retry(url)
        predictions = data.get("predictions", [])
        if not predictions:
            return None

        schedule = []
        for p in predictions:
            try:
                _, time_str = p["t"].split(" ")
                schedule.append({
                    "time": time_str,
                    "height_ft": round(float(p["v"]), 2),
                    "type": p["type"],
                })
            except (KeyError, ValueError):
                continue

        if not schedule:
            return None

        # Slack windows: ±30 min around each H/L event
        slack_windows = []
        for event in schedule:
            h, m = map(int, event["time"].split(":"))
            total = h * 60 + m
            def _fmt(mins):
                mins = max(0, min(1439, mins))
                return f"{mins // 60:02d}:{mins % 60:02d}"
            slack_windows.append({
                "around": event["time"],
                "start": _fmt(total - 30),
                "end": _fmt(total + 30),
                "type": event["type"],
            })

        # Current phase: find which H/L bracket now falls in
        now_str = now_hhmm or datetime.now().strftime("%H:%M")
        current_phase = "unknown"
        for i in range(len(schedule) - 1):
            if schedule[i]["time"] <= now_str < schedule[i + 1]["time"]:
                current_phase = "rising" if schedule[i + 1]["type"] == "H" else "falling"
                break

        # Next tide: first event after now
        future = [e for e in schedule if e["time"] > now_str]
        next_tide = future[0] if future else schedule[-1]

        return {
            "current_phase": current_phase,
            "next_tide": next_tide,
            "slack_windows": slack_windows,
        }
    except Exception:
        return None
