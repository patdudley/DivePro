#!/usr/bin/env python3
"""
Capture daily camera frames for DivePro homepage cards.

This is designed for GitHub Actions. It uses yt-dlp to resolve YouTube live
streams and ffmpeg to save one current frame per camera. If a stream cannot be
resolved, the existing image is left in place so the homepage never breaks.
"""

from __future__ import annotations

import datetime as dt
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_DIR = ROOT / "camera-snapshots"

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


def run(command: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def resolve_stream_url(video_id: str) -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    result = run(
        [
            "yt-dlp",
            "--no-warnings",
            "--no-playlist",
            "-f",
            "best[height<=1080]/best",
            "-g",
            url,
        ],
        timeout=120,
    )
    stream_urls = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not stream_urls:
        raise RuntimeError(f"No stream URL returned for {video_id}")
    return stream_urls[-1]


def capture_frame(slug: str, video_id: str) -> None:
    output = SNAPSHOT_DIR / f"{slug}.jpg"
    temp_output = SNAPSHOT_DIR / f".{slug}.tmp.jpg"
    stream_url = resolve_stream_url(video_id)
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            stream_url,
            "-frames:v",
            "1",
            "-vf",
            "scale=1280:-2",
            str(temp_output),
        ],
        timeout=120,
    )
    if temp_output.exists() and temp_output.stat().st_size > 10_000:
        temp_output.replace(output)
    else:
        temp_output.unlink(missing_ok=True)
        raise RuntimeError(f"Captured frame for {slug} was too small")


def refresh_san_diego_snapshot() -> None:
    source = ROOT / "pier-screenshot.png"
    target = SNAPSHOT_DIR / "san-diego.png"
    if source.exists():
        shutil.copyfile(source, target)


def bump_snapshot_versions(version: str) -> None:
    for relative in ["index.html", "spot-reports.js"]:
        path = ROOT / relative
        text = path.read_text()
        text = re.sub(r"(camera-snapshots/[^\"')?]+?\.(?:jpg|png))\?v=[A-Za-z0-9_-]+", rf"\1?v={version}", text)
        path.write_text(text)


def main() -> int:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    failures: list[str] = []
    for slug, video_id in SPOTS:
        try:
            print(f"Capturing {slug}")
            capture_frame(slug, video_id)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{slug}: {exc}")
            print(f"WARNING: {slug} failed: {exc}", file=sys.stderr)

    refresh_san_diego_snapshot()
    version = dt.datetime.utcnow().strftime("%Y%m%d-%H%M")
    bump_snapshot_versions(version)

    if failures:
        print("Some snapshots failed; existing images were kept:")
        for failure in failures:
            print(f"- {failure}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
