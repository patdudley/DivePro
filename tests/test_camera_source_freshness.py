import datetime as dt
import pathlib
import sys

import pytest
from PIL import Image


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import scripps_camera as camera  # noqa: E402


def test_live_edge_rejects_advancing_video_that_is_behind():
    first = {"current_time": 100.0, "seekable_end": 130.0, "is_live_stream": True}
    second = {"current_time": 103.0, "seekable_end": 130.0, "is_live_stream": True}

    with pytest.raises(RuntimeError, match="behind its live edge"):
        camera.validate_live_video_states(first, second)


def test_live_edge_rejects_frozen_clock_and_accepts_current_video():
    with pytest.raises(RuntimeError, match="did not advance"):
        camera.validate_live_video_states(
            {"current_time": 100.0, "seekable_end": 101.0, "is_live_stream": True},
            {"current_time": 100.4, "seekable_end": 101.0, "is_live_stream": True},
        )

    lag = camera.validate_live_video_states(
        {"current_time": 100.0, "seekable_end": 101.0, "is_live_stream": True},
        {"current_time": 102.5, "seekable_end": 103.0, "is_live_stream": True},
    )
    assert lag == 0.5


def test_finite_prerecorded_clip_is_never_accepted_as_live():
    with pytest.raises(RuntimeError, match="finite prerecorded clip"):
        camera.validate_live_video_states(
            {
                "current_time": 5.0,
                "seekable_end": 30.0,
                "duration": 30.0,
                "is_live_stream": False,
            },
            {
                "current_time": 8.0,
                "seekable_end": 30.0,
                "duration": 30.0,
                "is_live_stream": False,
            },
        )


def test_frame_motion_distinguishes_frozen_and_moving_pixels(tmp_path):
    first = tmp_path / "first.jpg"
    frozen = tmp_path / "frozen.jpg"
    moving = tmp_path / "moving.jpg"
    Image.new("RGB", (1280, 720), (20, 90, 120)).save(first)
    Image.new("RGB", (1280, 720), (20, 90, 120)).save(frozen)
    changed = Image.new("RGB", (1280, 720), (20, 90, 120))
    for x in range(300, 900):
        for y in range(200, 500):
            changed.putpixel((x, y), (80, 150, 180))
    changed.save(moving)

    assert camera.frame_motion_score(first, frozen) < camera.MIN_FRAME_MOTION_SCORE
    assert camera.frame_motion_score(first, moving) > camera.MIN_FRAME_MOTION_SCORE


def test_hls_program_timestamp_rejects_stale_source():
    manifest = """#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2026-07-29T16:00:00Z
#EXTINF:6.0,
segment.ts
"""
    parsed = camera.parse_hls_program_datetimes(manifest)
    assert parsed == [dt.datetime(2026, 7, 29, 16, 0, tzinfo=dt.UTC)]

    with pytest.raises(RuntimeError, match="stale"):
        camera.source_timestamp_age_seconds(
            parsed[0],
            now=dt.datetime(2026, 7, 29, 16, 3, tzinfo=dt.UTC),
        )


def test_capture_metrics_must_explicitly_verify_source_freshness():
    with pytest.raises(RuntimeError, match="verified source freshness"):
        camera.apply_capture_freshness({}, {"source_freshness_verified": False})
