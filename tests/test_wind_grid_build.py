# ABOUTME: Tests the GFS wind-grid builder's unattended-run behaviors: NOMADS
# ABOUTME: subregion subsetting, download retry with backoff, stale-frame cleanup.
import importlib.util
import pathlib
import sys
import urllib.error
from unittest.mock import MagicMock

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

# The wind script's heavy GRIB/geometry deps come from requirements-wind.txt,
# which the test environments don't install. Stub any that are missing just
# long enough to import the module, then remove the stubs so they can't leak
# into other tests (a fake numpy in sys.modules breaks pytest.approx).
_STUBBABLE = ("cfgrib", "numpy", "shapely", "shapely.geometry", "shapely.ops")


def _load_module():
    added = []
    for name in _STUBBABLE:
        if name not in sys.modules:
            sys.modules[name] = MagicMock()
            added.append(name)
    try:
        spec = importlib.util.spec_from_file_location(
            "build_gfs_wind_grid", ROOT / "scripts" / "build_gfs_wind_grid.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        for name in added:
            del sys.modules[name]


def test_download_url_enables_subregion_subsetting(monkeypatch, tmp_path):
    mod = _load_module()
    monkeypatch.setattr(mod, "_download_with_retry", lambda url, target: None)
    url = mod.download_grib("20260101", "12", 10, tmp_path / "f010.grib2")
    assert "subregion=" in url
    assert "leftlon=238.0" in url
    assert "var_UGRD=on" in url


def test_download_retries_then_succeeds(monkeypatch, tmp_path):
    mod = _load_module()
    calls = {"n": 0}

    class FakeResponse:
        def read(self, size=-1):
            return b""
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False

    def flaky_urlopen(url, timeout=None):
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.URLError("nomads 503")
        return FakeResponse()

    monkeypatch.setattr(mod.urllib.request, "urlopen", flaky_urlopen)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    mod._download_with_retry("https://example.test/x", tmp_path / "out.grib2")
    assert calls["n"] == 3
    assert (tmp_path / "out.grib2").exists()


def test_download_raises_after_exhausting_retries(monkeypatch, tmp_path):
    mod = _load_module()

    def always_fails(url, timeout=None):
        raise urllib.error.URLError("nomads down")

    monkeypatch.setattr(mod.urllib.request, "urlopen", always_fails)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    with pytest.raises(urllib.error.URLError):
        mod._download_with_retry("https://example.test/x", tmp_path / "out.grib2")


def test_remove_stale_frames_keeps_manifest_frames(monkeypatch, tmp_path):
    mod = _load_module()
    monkeypatch.setattr(mod, "OUT_PATH", tmp_path / "wind-san-diego.json")
    current = tmp_path / "wind-san-diego-f010.json"
    stale = tmp_path / "wind-san-diego-f005.json"
    unrelated = tmp_path / "wind-san-diego-manifest.json"
    for f in (current, stale, unrelated):
        f.write_text("{}")

    mod.remove_stale_frames({str(current).replace("\\", "/")})

    assert current.exists()
    assert not stale.exists()
    assert unrelated.exists()
