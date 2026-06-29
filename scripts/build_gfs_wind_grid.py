#!/usr/bin/env python3
"""Build the frontend regional wind-grid JSON from NOAA GFS 10m U/V wind.

The static site should not parse GRIB2 in the browser. This script is the
preprocessing boundary: download a West Coast/Baja subset from NOAA NOMADS,
parse it locally with cfgrib, and write data/wind-san-diego.json.

Prerequisite:
  python3 -m pip install cfgrib shapely --break-system-packages
  cfgrib needs the ECMWF ecCodes runtime. The Python eccodes wheel is usually
  enough; if not, install the system runtime with: brew install eccodes

Example:
  python3 scripts/build_gfs_wind_grid.py
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
import tempfile
import urllib.request
from zoneinfo import ZoneInfo
from pathlib import Path

import cfgrib
import numpy as np
from shapely import contains_xy, prepare
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union


# Wide regional coverage for the current single-JSON frontend renderer.
# Covers the West Coast, Baja, Florida, Roatan, and enough open ocean for the
# static prototype maps before the tiled global loader is ready.
BBOX = {"west": -180.0, "south": 15.0, "east": -60.0, "north": 55.0}
TARGET_NX = 1440
TARGET_NY = 720
OUT_PATH = Path("data/wind-san-diego.json")
MANIFEST_OUT_PATH = Path("data/wind-san-diego-manifest.json")
WATER_MASK_OUT_PATH = Path("data/water-mask-san-diego.geojson")
# Keep enough hourly frames for the UI to jump to the next local day multiple
# times while still using the existing single-regional-JSON renderer.
FORECAST_WINDOW_HOURS = 49
LOCAL_TZ = ZoneInfo("America/Los_Angeles")
COASTLINE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson"
CACHE_DIR = Path("scripts/.cache")
LAND_GEOJSON_PATH = CACHE_DIR / "ne_10m_land.geojson"


def latest_cycle(now: dt.datetime) -> tuple[str, str]:
    run_hour = (now.hour // 6) * 6
    # Give NOAA a few hours to publish the latest cycle.
    if now.hour - run_hour < 4:
        run_hour -= 6
    if run_hour < 0:
        now -= dt.timedelta(days=1)
        run_hour = 18
    return now.strftime("%Y%m%d"), f"{run_hour:02d}"


def forecast_hours_for_now(date: str, cycle: str, now: dt.datetime) -> list[int]:
    cycle_start = dt.datetime.strptime(f"{date}{cycle}", "%Y%m%d%H").replace(tzinfo=dt.UTC)
    start_hour = max(0, int((now - cycle_start).total_seconds() // 3600))
    return list(range(start_hour, start_hour + FORECAST_WINDOW_HOURS))


def forecast_valid_time(date: str, cycle: str, forecast_hour: int) -> dt.datetime:
    cycle_start = dt.datetime.strptime(f"{date}{cycle}", "%Y%m%d%H").replace(tzinfo=dt.UTC)
    return cycle_start + dt.timedelta(hours=forecast_hour)


def local_hour_label(valid_time: dt.datetime) -> str:
    local_time = valid_time.astimezone(LOCAL_TZ)
    return local_time.strftime("%-I%p").lower()


def download_grib(date: str, cycle: str, forecast_hour: int, target: Path) -> str:
    leftlon = BBOX["west"] + 360
    rightlon = BBOX["east"] + 360
    url = (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
        f"?dir=%2Fgfs.{date}%2F{cycle}%2Fatmos"
        f"&file=gfs.t{cycle}z.pgrb2.0p25.f{forecast_hour:03d}"
        "&lev_10_m_above_ground=on"
        "&var_UGRD=on&var_VGRD=on"
        f"&leftlon={leftlon}&rightlon={rightlon}"
        f"&toplat={BBOX['north']}&bottomlat={BBOX['south']}"
    )
    urllib.request.urlretrieve(url, target)
    return url


def forecast_output_path(forecast_hour: int) -> Path:
    return OUT_PATH.with_name(f"wind-san-diego-f{forecast_hour:03d}.json")


def find_data_var(dataset, candidates: tuple[str, ...]):
    for name in dataset.data_vars:
        lower = name.lower()
        attrs = dataset[name].attrs
        long_name = str(attrs.get("long_name", "")).lower()
        short_name = str(attrs.get("GRIB_shortName", "")).lower()
        cf_name = str(attrs.get("GRIB_cfName", "")).lower()
        if lower in candidates or short_name in candidates:
            return dataset[name]
        descriptive_candidates = tuple(token for token in candidates if len(token) > 1)
        if any(token in long_name for token in descriptive_candidates):
            return dataset[name]
        if any(token in cf_name for token in descriptive_candidates):
            return dataset[name]
    return None


def load_wind_arrays(grib_path: Path) -> tuple[list[float], list[float], list[list[float]], list[list[float]]]:
    datasets = cfgrib.open_datasets(str(grib_path), backend_kwargs={"indexpath": ""})
    for dataset in datasets:
        u_var = find_data_var(dataset, ("u10", "10u", "ugrd", "u-component", "u"))
        v_var = find_data_var(dataset, ("v10", "10v", "vgrd", "v-component", "v"))
        if u_var is None or v_var is None:
            continue

        lat_name = "latitude" if "latitude" in dataset.coords else "lat"
        lon_name = "longitude" if "longitude" in dataset.coords else "lon"
        lats = np.asarray(dataset[lat_name].values, dtype=np.float64)
        lons = ((np.asarray(dataset[lon_name].values, dtype=np.float64) + 180) % 360) - 180
        u = np.squeeze(np.asarray(u_var.values, dtype=np.float64))
        v = np.squeeze(np.asarray(v_var.values, dtype=np.float64))

        if u.shape != (len(lats), len(lons)) or v.shape != (len(lats), len(lons)):
            raise RuntimeError(f"Unexpected U/V shape: u={u.shape} v={v.shape}")

        lon_order = np.argsort(lons)
        lat_order = np.argsort(lats)
        lons = lons[lon_order]
        lats = lats[lat_order]
        u = u[lat_order][:, lon_order]
        v = v[lat_order][:, lon_order]
        return (
            [round(float(lon), 5) for lon in lons],
            [round(float(lat), 5) for lat in lats],
            [[round(float(value), 3) for value in row] for row in u.tolist()],
            [[round(float(value), 3) for value in row] for row in v.tolist()],
        )

    raise RuntimeError(f"Could not find 10m U/V wind variables in {grib_path}")


def download_land_geojson() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not LAND_GEOJSON_PATH.exists():
        urllib.request.urlretrieve(COASTLINE_URL, LAND_GEOJSON_PATH)
    return LAND_GEOJSON_PATH


def bbox_intersects(a: dict, b: dict) -> bool:
    return not (a["east"] < b["west"] or a["west"] > b["east"] or a["north"] < b["south"] or a["south"] > b["north"])


def ring_bbox(ring: list[list[float]]) -> dict:
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return {"west": min(xs), "south": min(ys), "east": max(xs), "north": max(ys)}


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point[:2]
        xj, yj = ring[j][:2]
        if ((yi > lat) != (yj > lat)) and (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not point_in_ring(lon, lat, polygon[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in polygon[1:])


def load_land_polygons() -> list[dict]:
    land = json.loads(download_land_geojson().read_text())
    region = box(BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"])
    polygons = []
    for feature in land["features"]:
        geometry = shape(feature["geometry"])
        raw_polygons = geometry.geoms if geometry.geom_type == "MultiPolygon" else [geometry]
        for polygon in raw_polygons:
            if polygon.is_empty or not polygon.intersects(region):
                continue
            clipped = polygon.intersection(region)
            if clipped.is_empty:
                continue
            prepare(clipped)
            west, south, east, north = clipped.bounds
            polygons.append({
                "bbox": {"west": west, "south": south, "east": east, "north": north},
                "geometry": clipped,
            })
    return polygons


def write_water_mask_geojson() -> None:
    """Write a compact regional water polygon for frontend canvas clipping."""
    land = json.loads(download_land_geojson().read_text())
    region = box(BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"])
    land_shapes = []

    for feature in land["features"]:
        geometry = shape(feature["geometry"])
        if geometry.is_empty or not geometry.intersects(region):
            continue
        land_shapes.append(geometry.intersection(region))

    land_union = unary_union(land_shapes)
    water = region.difference(land_union).buffer(0)
    water = water.simplify(0.00035, preserve_topology=True)
    WATER_MASK_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    WATER_MASK_OUT_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": mapping(water),
        }],
    }, separators=(",", ":")))


def is_land(lon: float, lat: float, land_polygons: list[dict]) -> bool:
    point_bbox = {"west": lon, "east": lon, "south": lat, "north": lat}
    for item in land_polygons:
        if bbox_intersects(item["bbox"], point_bbox) and point_in_polygon(lon, lat, item["polygon"]):
            return True
    return False


def points_in_ring(lons: np.ndarray, lats: np.ndarray, ring: list[list[float]]) -> np.ndarray:
    inside = np.zeros(lons.shape, dtype=bool)
    ring_lons = np.array([point[0] for point in ring])
    ring_lats = np.array([point[1] for point in ring])
    j = len(ring) - 1
    for i in range(len(ring)):
        xi = ring_lons[i]
        yi = ring_lats[i]
        xj = ring_lons[j]
        yj = ring_lats[j]
        with np.errstate(divide="ignore", invalid="ignore"):
            edge_lon = ((xj - xi) * (lats - yi)) / (yj - yi) + xi
        crosses = ((yi > lats) != (yj > lats)) & (lons < edge_lon)
        inside ^= crosses
        j = i
    return inside


def build_land_mask(lons: list[float], lats: list[float], land_polygons: list[dict]) -> np.ndarray:
    lon_values = np.array(lons)
    lat_values = np.array(lats)
    land_mask = np.zeros((len(lat_values), len(lon_values)), dtype=bool)

    for item in land_polygons:
        bounds = item["bbox"]
        col_indexes = np.where((lon_values >= bounds["west"]) & (lon_values <= bounds["east"]))[0]
        row_indexes = np.where((lat_values >= bounds["south"]) & (lat_values <= bounds["north"]))[0]
        if not len(col_indexes) or not len(row_indexes):
            continue

        lon_grid, lat_grid = np.meshgrid(lon_values[col_indexes], lat_values[row_indexes])
        inside = contains_xy(item["geometry"], lon_grid, lat_grid)
        land_mask[np.ix_(row_indexes, col_indexes)] |= inside

    return land_mask


def interpolate_component_grid(
    component: list[list[float]],
    source_lons: list[float],
    source_lats: list[float],
    target_lons: list[float],
    target_lats: list[float],
) -> np.ndarray:
    source = np.asarray(component, dtype=np.float64)
    source_lon_values = np.asarray(source_lons, dtype=np.float64)
    source_lat_values = np.asarray(source_lats, dtype=np.float64)
    target_lon_values = np.asarray(target_lons, dtype=np.float64)
    target_lat_values = np.asarray(target_lats, dtype=np.float64)

    lon_interp = np.vstack([
        np.interp(target_lon_values, source_lon_values, row)
        for row in source
    ])
    return np.vstack([
        np.interp(target_lat_values, source_lat_values, lon_interp[:, x_index])
        for x_index in range(len(target_lon_values))
    ]).T


def interpolate_component(component: list[list[float]], lons: list[float], lats: list[float], lon: float, lat: float) -> float:
    if lon <= lons[0]:
        x0 = x1 = 0
        tx = 0
    elif lon >= lons[-1]:
        x0 = x1 = len(lons) - 1
        tx = 0
    else:
        x1 = next(index for index, value in enumerate(lons) if value >= lon)
        x0 = x1 - 1
        tx = (lon - lons[x0]) / (lons[x1] - lons[x0])

    if lat <= lats[0]:
        y0 = y1 = 0
        ty = 0
    elif lat >= lats[-1]:
        y0 = y1 = len(lats) - 1
        ty = 0
    else:
        y1 = next(index for index, value in enumerate(lats) if value >= lat)
        y0 = y1 - 1
        ty = (lat - lats[y0]) / (lats[y1] - lats[y0])

    a = component[y0][x0] * (1 - tx) + component[y0][x1] * tx
    b = component[y1][x0] * (1 - tx) + component[y1][x1] * tx
    return a * (1 - ty) + b * ty


def build_json(grib_path: Path, source_url: str, forecast_hour: int) -> dict:
    lons, lats, source_u, source_v = load_wind_arrays(grib_path)

    target_lons = [
        BBOX["west"] + (BBOX["east"] - BBOX["west"]) * x_index / (TARGET_NX - 1)
        for x_index in range(TARGET_NX)
    ]
    target_lats = [
        BBOX["north"] - (BBOX["north"] - BBOX["south"]) * y_index / (TARGET_NY - 1)
        for y_index in range(TARGET_NY)
    ]
    land_polygons = load_land_polygons()
    land_mask = build_land_mask(target_lons, target_lats, land_polygons)
    u_array = np.round(interpolate_component_grid(source_u, lons, lats, target_lons, target_lats), 3).astype(object)
    v_array = np.round(interpolate_component_grid(source_v, lons, lats, target_lons, target_lats), 3).astype(object)
    u_array[land_mask] = None
    v_array[land_mask] = None
    land_points = int(land_mask.sum())
    ocean_points = int(land_mask.size - land_points)

    return {
        "metadata": {
            "source": "NOAA GFS 0.25 deg 10m UGRD/VGRD via NOMADS, interpolated and masked to ocean with Natural Earth 10m land polygons",
            "source_url": source_url,
            "coastline_source": COASTLINE_URL,
            "generated_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
            "forecast_hour": forecast_hour,
            "units": "u/v m/s; rendered speed mph",
            "bbox": BBOX,
            "nx": TARGET_NX,
            "ny": TARGET_NY,
            "ocean_points": ocean_points,
            "land_points_masked": land_points,
        },
        "u": u_array.tolist(),
        "v": v_array.tolist(),
    }


def main() -> None:
    now = dt.datetime.now(dt.UTC)
    date, cycle = latest_cycle(now)
    forecast_hours = forecast_hours_for_now(date, cycle, now)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_water_mask_geojson()
    written_frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for index, forecast_hour in enumerate(forecast_hours):
            grib_path = Path(tmp) / f"gfs-wind-f{forecast_hour:03d}.grib2"
            source_url = download_grib(date, cycle, forecast_hour, grib_path)
            frame_path = forecast_output_path(forecast_hour)
            frame_path.write_text(json.dumps(build_json(grib_path, source_url, forecast_hour), separators=(",", ":")))
            if index == 0:
                shutil.copyfile(frame_path, OUT_PATH)
            valid_time = forecast_valid_time(date, cycle, forecast_hour)
            written_frames.append({
                "hour": forecast_hour,
                "label": "Now" if index == 0 else local_hour_label(valid_time),
                "tickLabel": "Now" if index == 0 else local_hour_label(valid_time),
                "valid_utc": valid_time.replace(microsecond=0).isoformat(),
                "path": str(frame_path).replace("\\", "/"),
            })
            print(f"Wrote {frame_path}")

    MANIFEST_OUT_PATH.write_text(json.dumps({
        "run": f"{date}_{cycle}z",
        "hours": forecast_hours,
        "frames": written_frames,
        "generated_utc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
    }, separators=(",", ":")))
    print(f"Wrote {OUT_PATH}")
    print(f"Wrote {MANIFEST_OUT_PATH}")


if __name__ == "__main__":
    main()
