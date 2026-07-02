#!/usr/bin/env python3
"""
Capture daily camera frames for DivePro homepage cards.

This is designed for GitHub Actions. It mirrors the La Jolla capture approach:
open a fixed-size browser frame with Playwright, let the live camera render,
then screenshot the same 1280x720 viewport every run. If a camera cannot be
captured, the existing image is left in place so the homepage never breaks.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import sys
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_DIR = ROOT / "camera-snapshots"
ARCHIVE_DIR = ROOT / "camera-snapshot-history"
MANIFEST = ARCHIVE_DIR / "manifest.json"
LOCAL_TZ = ZoneInfo("America/Los_Angeles")
VIEWPORT = {"width": 1280, "height": 720}
RENDER_WAIT_MS = 12_000
CAPTURE_SERVER_HOST = "127.0.0.1"

SPOTS = [
    ("lower-keys", "qi0mY6zVQnY"),
    ("deerfield-beach", "SHfAtWHr9Ks"),
    ("utopia-sandy-channel", "jzx_n25g3kA"),
    ("utopia-reef-cam", "nmjlQlYygB4"),
    ("catalina-wrigley", "JH_NzhSsqis"),
    ("anacapa-ocean", "OAJF1Ie1m_Q"),
    ("coral-city", "7i8ARjIeM2k"),
    ("pompano-pier", "mV8zVsX_o_0"),
]


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return


@contextmanager
def local_capture_server():
    server = ThreadingHTTPServer((CAPTURE_SERVER_HOST, 0), QuietStaticHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://{CAPTURE_SERVER_HOST}:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def capture_frame(page, base_url: str, slug: str, video_id: str) -> None:
    output = SNAPSHOT_DIR / f"{slug}.jpg"
    temp_output = SNAPSHOT_DIR / f".{slug}.tmp.jpg"
    capture_url = f"{base_url}/tools/snapshot-capture.html?video={video_id}"
    page.goto(capture_url, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector("#camera", state="attached", timeout=20_000)
    page.wait_for_timeout(RENDER_WAIT_MS)
    page.screenshot(
        path=str(temp_output),
        type="jpeg",
        quality=88,
        clip={"x": 0, "y": 0, "width": VIEWPORT["width"], "height": VIEWPORT["height"]},
    )
    if temp_output.exists() and temp_output.stat().st_size > 10_000:
        temp_output.replace(output)
    else:
        temp_output.unlink(missing_ok=True)
        raise RuntimeError(f"Captured frame for {slug} was too small")


def archive_snapshot(slug: str, extension: str, captured_at: dt.datetime, source: str) -> dict | None:
    latest = SNAPSHOT_DIR / f"{slug}.{extension}"
    if not latest.exists():
        return None

    local_day = captured_at.astimezone(LOCAL_TZ).strftime("%Y-%m-%d")
    timestamp = captured_at.strftime("%H%M")
    day_dir = ARCHIVE_DIR / local_day
    day_dir.mkdir(parents=True, exist_ok=True)

    archived = day_dir / f"{slug}-{timestamp}.{extension}"
    shutil.copyfile(latest, archived)
    return {
        "captured_at_utc": captured_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "date": local_day,
        "spot": slug,
        "source": source,
        "capture_method": "playwright_fixed_viewport",
        "viewport": VIEWPORT,
        "latest_path": str(latest.relative_to(ROOT)),
        "archive_path": str(archived.relative_to(ROOT)),
    }


def load_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    data = json.loads(MANIFEST.read_text())
    return data if isinstance(data, list) else []


def update_manifest(entries: list[dict]) -> None:
    if not entries:
        return
    ARCHIVE_DIR.mkdir(exist_ok=True)
    manifest = load_manifest()
    paths = {entry["archive_path"] for entry in entries}
    manifest = [entry for entry in manifest if entry.get("archive_path") not in paths]
    manifest.extend(entries)
    manifest.sort(key=lambda entry: str(entry.get("captured_at_utc") or ""), reverse=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def bump_snapshot_versions(version: str) -> None:
    for relative in ["index.html", "spot-reports.js"]:
        path = ROOT / relative
        text = path.read_text()
        text = re.sub(r"(camera-snapshots/[^\"')?]+?\.(?:jpg|png))\?v=[A-Za-z0-9_-]+", rf"\1?v={version}", text)
        path.write_text(text)


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        print(
            "ERROR: Playwright is required for fixed-position camera screenshots. "
            "Install with: python3 -m pip install playwright && python3 -m playwright install chromium",
            file=sys.stderr,
        )
        raise exc

    SNAPSHOT_DIR.mkdir(exist_ok=True)
    failures: list[str] = []
    captured_at = dt.datetime.now(dt.UTC)
    archive_entries: list[dict] = []

    with local_capture_server() as base_url:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
            for slug, video_id in SPOTS:
                try:
                    print(f"Capturing {slug}", flush=True)
                    capture_frame(page, base_url, slug, video_id)
                    entry = archive_snapshot(slug, "jpg", captured_at, f"https://www.youtube.com/watch?v={video_id}")
                    if entry:
                        archive_entries.append(entry)
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{slug}: {exc}")
                    print(f"WARNING: {slug} failed: {exc}", file=sys.stderr, flush=True)
            browser.close()

    update_manifest(archive_entries)

    version = dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M")
    bump_snapshot_versions(version)

    if failures:
        print("Some snapshots failed; existing images were kept:")
        for failure in failures:
            print(f"- {failure}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
