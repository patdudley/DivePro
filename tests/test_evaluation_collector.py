from datetime import datetime, timezone

import pytest

from scripts.collect_evaluation_observations import parse_page


def _article(timestamp, text, href="/blogs/dive-reports/example"):
    return f"""
    <div class="article__grid-meta">
      <a href="{href}">report</a>
      <time datetime="{timestamp}"></time>
      <div class="article__excerpt">{text}</div>
    </div>
    """


def test_collects_all_reports_without_retaining_prose():
    html = _article("2030-07-12T16:00:00Z", "Dove La Jolla Shores. Vis: 10-15 ft") + \
           _article("2030-07-12T18:00:00Z", "Dove the line. Visibility 20+ ft", "/blogs/dive-reports/line")
    payload = parse_page(html, "2030-07-12", datetime(2030, 7, 12, 20, tzinfo=timezone.utc), "run-1")

    assert len(payload["records"]) == 2
    assert {r["vis_value_type"] for r in payload["records"]} == {"closed_range", "censored_min"}
    assert sum(r["is_primary_candidate"] for r in payload["records"]) == 1
    assert all("excerpt" not in key for r in payload["records"] for key in r)
    assert "Dove" not in str(payload)


def test_uses_pacific_date_at_utc_boundary():
    html = _article("2030-07-13T06:30:00Z", "Dove La Jolla. Vis: 10-15 ft")
    payload = parse_page(html, "2030-07-12", datetime(2030, 7, 13, 7, tzinfo=timezone.utc), "run-2")
    assert payload["records"][0]["record_type"] == "observation"
    assert payload["records"][0]["observation_date"] == "2030-07-12"


def test_no_today_report_is_distinct_from_parser_failure():
    html = _article("2030-07-11T16:00:00Z", "Dove La Jolla. Vis: 10-15 ft")
    payload = parse_page(html, "2030-07-12", datetime(2030, 7, 12, 20, tzinfo=timezone.utc), "run-3")
    record = payload["records"][0]
    assert record["record_type"] == "no_report"
    assert record["posts_scanned_count"] == 1
    assert record["visibility_midpoint_ft"] is None


def test_zero_selector_matches_is_failure():
    with pytest.raises(ValueError, match="selector matched zero"):
        parse_page("<html></html>", "2030-07-12", datetime.now(timezone.utc), "run-4")


def test_parser_uses_visibility_value_not_wave_height():
    html = _article(
        "2030-07-12T16:00:00Z",
        "Dove La Jolla. Surf was 3-5 ft. Visibility was 10-15 ft.",
    )
    record = parse_page(
        html, "2030-07-12", datetime(2030, 7, 12, 20, tzinfo=timezone.utc), "run-5"
    )["records"][0]
    assert record["visibility_min_ft"] == 10
    assert record["visibility_max_ft"] == 15


def test_unlabeled_wave_height_is_not_treated_as_visibility():
    html = _article("2030-07-12T16:00:00Z", "Dove La Jolla. Surf was 3-5 ft.")
    record = parse_page(
        html, "2030-07-12", datetime(2030, 7, 12, 20, tzinfo=timezone.utc), "run-6"
    )["records"][0]
    assert record["record_type"] == "no_report"
