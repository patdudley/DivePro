# ABOUTME: Tests for community_report module — JustGetWet scraper scoring and visibility parsing.
# ABOUTME: Covers credibility weighting, visibility extraction, today-only filtering, and HTTP errors.
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import community_report as cr


_SAMPLE_HTML = """
<html><body>
<div class="article__grid-meta">
  <time datetime="2026-05-31T15:00:00Z"></time>
  <div class="article__excerpt">
    Went out on the line today at Scripps. Visibility was 20-25 ft, clean blue water.
  </div>
</div>
<div class="article__grid-meta">
  <time datetime="2026-05-31T10:00:00Z"></time>
  <div class="article__excerpt">
    Looking at the camera, looks like about 10 ft at La Jolla.
  </div>
</div>
</body></html>
"""

_STALE_HTML = """
<html><body>
<div class="article__grid-meta">
  <time datetime="2026-05-28T15:00:00Z"></time>
  <div class="article__excerpt">Dove La Jolla, 15 ft viz.</div>
</div>
</body></html>
"""


def test_score_line_dive():
    result = cr._score_post("Went out on the line today at Scripps offshore")
    assert result["weight"] == 1.0
    assert result["confidence_label"] == "high"


def test_score_la_jolla_dive():
    result = cr._score_post("Dove at La Jolla cove today, nice dive")
    assert result["weight"] == 0.8
    assert result["confidence_label"] == "high"


def test_score_camera_only():
    result = cr._score_post("Looking at the cam, La Jolla looks murky")
    assert result["weight"] == 0.3
    assert result["confidence_label"] == "low"


def test_extract_visibility_range():
    vis = cr._extract_visibility("Visibility was 20-25 ft today")
    assert vis == [20, 25]


def test_extract_visibility_single():
    vis = cr._extract_visibility("About 15 ft viz")
    assert vis is not None
    assert vis[0] < 15
    assert vis[1] > 15


def test_extract_visibility_none():
    assert cr._extract_visibility("Great dive!") is None


def test_picks_highest_weight_today_post(monkeypatch):
    import datetime
    monkeypatch.setattr(
        "community_report.datetime",
        type("FakeDT", (), {
            "now": staticmethod(lambda tz=None: datetime.datetime(2026, 5, 31, 16, 0, tzinfo=datetime.timezone.utc)),
            "fromisoformat": datetime.datetime.fromisoformat,
        })
    )
    from unittest.mock import patch, MagicMock
    resp = MagicMock()
    resp.status_code = 200
    resp.text = _SAMPLE_HTML
    with patch("requests.get", return_value=resp):
        result = cr.get_community_report()
    assert result["visibility_ft"] == [20, 25]
    assert result["weight"] == 1.0
    assert result["error"] is None


def test_returns_no_data_when_only_stale_posts(monkeypatch):
    import datetime
    monkeypatch.setattr(
        "community_report.datetime",
        type("FakeDT", (), {
            "now": staticmethod(lambda tz=None: datetime.datetime(2026, 5, 31, 16, 0, tzinfo=datetime.timezone.utc)),
            "fromisoformat": datetime.datetime.fromisoformat,
        })
    )
    from unittest.mock import patch, MagicMock
    resp = MagicMock()
    resp.status_code = 200
    resp.text = _STALE_HTML
    with patch("requests.get", return_value=resp):
        result = cr.get_community_report()
    assert result["visibility_ft"] is None
    assert result["error"] is None


def test_returns_error_dict_on_http_failure():
    from unittest.mock import patch, MagicMock
    resp = MagicMock()
    resp.status_code = 503
    with patch("requests.get", return_value=resp):
        result = cr.get_community_report()
    assert "error" in result
    assert result["error"] is not None
