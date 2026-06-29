#!/usr/bin/env python3
"""Build global XYZ GFS wind tiles for future map rendering.

This is intentionally separate from build_gfs_wind_grid.py. The current
frontend still reads the existing single-region JSON path until a later tile
loader is added.

Data source:
  NOAA NOMADS GFS 0.25 deg filter endpoint
  https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl

Dependencies:
  pip: cfgrib, xarray, numpy
  system: ecCodes is required by cfgrib to parse GRIB2
  macOS: brew install eccodes

For this first checkpoint we generate only f000 and zooms 3 and 5.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import shutil
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable

import cfgrib
import numpy as np


FILTER_ENDPOINT = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
NOMADS_BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
FORECAST_HOURS = [0]
ZOOMS = [3, 5]
MERCATOR_LAT_LIMIT = 85.06
TARGET_POINTS_PER_TILE = 256
PUBLIC_WIND_DIR = Path("public/wind")


def tile_bounds(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    lon_min = x / n * 360 - 180
    lon_max = (x + 1) / n * 360 - 180
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max


def candidate_runs(now: dt.datetime) -> Iterable[dt.datetime]:
    run_hour = (now.hour // 6) * 6
    run = now.replace(hour=run_hour, minute=0, second=0, microsecond=0)

    # NOAA publish lag: if the current synoptic run is under 4 hours old,
    # start with the previous cycle. Then keep backing off until a run exists.
    if now - run < dt.timedelta(hours=4):
        run -= dt.timedelta(hours=6)

    for offset in range(40):
        yield run - dt.timedelta(hours=6 * offset)


def run_parts(run: dt.datetime) -> tuple[str, str, str]:
    date = run.strftime("%Y%m%d")
    cycle = run.strftime("%H")
    run_id = f"{date}_{cycle}z"
    return date, cycle, run_id


def idx_url(date: str, cycle: str, forecast_hour: int) -> str:
    return (
        f"{NOMADS_BASE}/gfs.{date}/{cycle}/atmos/"
        f"gfs.t{cycle}z.pgrb2.0p25.f{forecast_hour:03d}.idx"
    )


def grib_filter_url(date: str, cycle: str, forecast_hour: int) -> str:
    return (
        f"{FILTER_ENDPOINT}"
        f"?dir=%2Fgfs.{date}%2F{cycle}%2Fatmos"
        f"&file=gfs.t{cycle}z.pgrb2.0p25.f{forecast_hour:03d}"
        "&lev_10_m_above_ground=on"
        "&var_UGRD=on"
        "&var_VGRD=on"
    )


def url_exists(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            response.read(128)
        return True
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return False


def latest_available_run(now: dt.datetime | None = None) -> tuple[str, str, str]:
    now = now or dt.datetime.now(dt.UTC)
    for run in candidate_runs(now):
        date, cycle, run_id = run_parts(run)
        if url_exists(idx_url(date, cycle, FORECAST_HOURS[0])):
            return date, cycle, run_id
    raise RuntimeError("No available GFS run found in the recent candidate window")


def download_grib(date: str, cycle: str, forecast_hour: int, target: Path) -> str:
    url = grib_filter_url(date, cycle, forecast_hour)
    urllib.request.urlretrieve(url, target)
    with target.open("rb") as handle:
        magic = handle.read(4)
    if magic != b"GRIB":
        raise RuntimeError(f"Downloaded file is not GRIB2: {url}")
    return url


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


def load_wind_arrays(grib_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    datasets = cfgrib.open_datasets(str(grib_path), backend_kwargs={"indexpath": ""})
    for dataset in datasets:
        u_var = find_data_var(dataset, ("u10", "10u", "ugrd", "u-component", "u"))
        v_var = find_data_var(dataset, ("v10", "10v", "vgrd", "v-component", "v"))
        if u_var is None or v_var is None:
            continue

        lat_name = "latitude" if "latitude" in dataset.coords else "lat"
        lon_name = "longitude" if "longitude" in dataset.coords else "lon"
        lats = np.asarray(dataset[lat_name].values, dtype=np.float64)
        lons_0360 = np.asarray(dataset[lon_name].values, dtype=np.float64)
        lons = ((lons_0360 + 180) % 360) - 180
        u = np.squeeze(np.asarray(u_var.values, dtype=np.float64))
        v = np.squeeze(np.asarray(v_var.values, dtype=np.float64))

        if u.shape != (len(lats), len(lons)) or v.shape != (len(lats), len(lons)):
            raise RuntimeError(f"Unexpected U/V shape: u={u.shape} v={v.shape}")
        return lons, lats, u, v

    raise RuntimeError(f"Could not find 10m U/V wind variables in {grib_path}")


def lon_mask_for_tile(lons: np.ndarray, lon_min: float, lon_max: float, x: int, z: int) -> np.ndarray:
    # GFS source longitude is 0-360, converted to -180/180 before matching.
    # Select by value membership so the antimeridian seam does not depend on
    # the source array being contiguous after conversion.
    if lon_min <= lon_max:
        if x == (2 ** z) - 1:
            return (lons >= lon_min) & (lons <= lon_max)
        return (lons >= lon_min) & (lons < lon_max)
    return (lons >= lon_min) | (lons < lon_max)


def lat_mask_for_tile(lats: np.ndarray, lat_min: float, lat_max: float) -> np.ndarray:
    return (
        (lats >= max(lat_min, -MERCATOR_LAT_LIMIT))
        & (lats <= min(lat_max, MERCATOR_LAT_LIMIT))
        & (np.abs(lats) <= MERCATOR_LAT_LIMIT)
    )


def stride_for_tile(raw_points: int, z: int) -> int:
    # z3 tiles cover large chunks of the globe, so start coarse.
    # z5 tiles are smaller, so allow finer sampling. Then increase stride
    # dynamically to keep each tile near <=256 emitted points.
    base_stride = {3: 12, 5: 3}.get(z, 4)
    if raw_points <= TARGET_POINTS_PER_TILE:
        return 1
    dynamic_stride = math.ceil(math.sqrt(raw_points / TARGET_POINTS_PER_TILE))
    return max(base_stride, dynamic_stride)


def write_tile(path: Path, bbox: tuple[float, float, float, float], points: list[list[float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "bbox": [round(value, 6) for value in bbox],
        "points": points,
    }, separators=(",", ":")))


def build_tiles(
    lons: np.ndarray,
    lats: np.ndarray,
    u: np.ndarray,
    v: np.ndarray,
    run_id: str,
    forecast_hour: int,
) -> dict:
    hour_dir = PUBLIC_WIND_DIR / run_id / f"f{forecast_hour:03d}"
    if hour_dir.exists():
        shutil.rmtree(hour_dir)

    tiles_by_zoom = {z: 0 for z in ZOOMS}
    min_speed = math.inf
    max_speed = -math.inf

    for z in ZOOMS:
        n = 2 ** z
        for x in range(n):
            for y in range(n):
                bbox = tile_bounds(x, y, z)
                lon_min, lat_min, lon_max, lat_max = bbox
                lon_indexes = np.where(lon_mask_for_tile(lons, lon_min, lon_max, x, z))[0]
                lat_indexes = np.where(lat_mask_for_tile(lats, lat_min, lat_max))[0]
                raw_points = len(lon_indexes) * len(lat_indexes)
                if raw_points == 0:
                    continue

                stride = stride_for_tile(raw_points, z)
                selected_lons = lon_indexes[::stride]
                selected_lats = lat_indexes[::stride]
                points: list[list[float]] = []

                for lat_index in selected_lats:
                    lat = float(lats[lat_index])
                    for lon_index in selected_lons:
                        lon = float(lons[lon_index])
                        uu = float(u[lat_index, lon_index])
                        vv = float(v[lat_index, lon_index])
                        if not (math.isfinite(uu) and math.isfinite(vv)):
                            continue
                        speed = math.hypot(uu, vv)
                        min_speed = min(min_speed, speed)
                        max_speed = max(max_speed, speed)
                        points.append([round(lon, 3), round(lat, 3), round(uu, 2), round(vv, 2)])

                if not points:
                    continue

                tile_path = hour_dir / f"z{z}" / str(x) / f"{y}.json"
                write_tile(tile_path, bbox, points)
                tiles_by_zoom[z] += 1

    return {
        "tiles_by_zoom": tiles_by_zoom,
        "min_speed": min_speed if not math.isinf(min_speed) else None,
        "max_speed": max_speed if not math.isinf(max_speed) else None,
    }


def write_manifest(run_id: str) -> Path:
    manifest_path = PUBLIC_WIND_DIR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({
        "run": run_id,
        "hours": FORECAST_HOURS,
        "zooms": ZOOMS,
        "generated_utc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
    }, separators=(",", ":")))
    return manifest_path


def directory_size(path: Path) -> int:
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def main() -> None:
    date, cycle, run_id = latest_available_run()
    print(f"Selected GFS run: {run_id}")

    with tempfile.TemporaryDirectory(prefix="gfs-wind-tiles-") as tmp:
        grib_path = Path(tmp) / "gfs-wind.grib2"
        source_url = download_grib(date, cycle, FORECAST_HOURS[0], grib_path)
        print(f"Downloaded: {source_url}")
        lons, lats, u, v = load_wind_arrays(grib_path)

    # Required Mercator handling: source points beyond +/-85.06 are ignored by
    # tile lat masks and never written to XYZ tiles.
    stats = build_tiles(lons, lats, u, v, run_id, FORECAST_HOURS[0])
    manifest_path = write_manifest(run_id)
    total_size = directory_size(PUBLIC_WIND_DIR / run_id) + manifest_path.stat().st_size

    for z in ZOOMS:
        print(f"z{z} tiles written: {stats['tiles_by_zoom'][z]}")
    print(f"wind speed m/s min/max: {stats['min_speed']:.2f}/{stats['max_speed']:.2f}")
    print(f"output size bytes: {total_size}")
    print(f"manifest: {manifest_path}")


if __name__ == "__main__":
    main()
