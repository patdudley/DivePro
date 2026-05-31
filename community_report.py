# ABOUTME: Fetches and parses JustGetWet.com dive reports for La Jolla.
# ABOUTME: Returns credibility-weighted visibility estimate based on location and activity signals.

import re
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

_JUSTGETWET_URL = "https://justgetwet.com/blogs/dive-reports-and-conditions/tagged/la-jolla-dive-conditions"
_TIMEOUT = 15

_NO_DATA = {
    "visibility_ft": None,
    "weight": 0.0,
    "confidence_label": "low",
    "source_excerpt": None,
    "error": None,
}


def _score_post(text):
    lower = text.lower()
    is_line = any(kw in lower for kw in ("the line", "line divers", "line diving", "offshore line"))
    is_la_jolla = any(kw in lower for kw in ("la jolla", "scripps", "cove", "shores"))
    is_jetty = any(kw in lower for kw in ("mission bay", "jetty"))
    dove = any(kw in lower for kw in ("went", "dove", "dive", "diving", "freedivers", "went out"))
    camera = any(kw in lower for kw in ("looking at the cam", "cam showing", "looks like", "camera"))

    if is_line and dove:
        weight = 1.0
    elif is_la_jolla and dove:
        weight = 0.8
    elif dove and not is_jetty and not is_la_jolla:
        weight = 0.7
    elif is_jetty and dove:
        weight = 0.5
    elif is_la_jolla and camera:
        weight = 0.3
    elif is_la_jolla:
        weight = 0.4
    else:
        weight = 0.2

    confidence_label = "high" if weight >= 0.7 else "medium" if weight >= 0.4 else "low"
    return {"weight": weight, "confidence_label": confidence_label}


def _extract_visibility(text):
    m = re.search(r'(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:ft|feet|\')', text, re.IGNORECASE)
    if m:
        return [int(m.group(1)), int(m.group(2))]
    m = re.search(r'(\d+)\s*(?:ft|feet|\')', text, re.IGNORECASE)
    if m:
        val = int(m.group(1))
        margin = max(3, round(val * 0.12))
        return [max(0, val - margin), val + margin]
    return None


def _is_today(article):
    time_el = article.find("time")
    if not time_el:
        return False
    dt_str = time_el.get("datetime", "")
    if not dt_str:
        return False
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.date() == datetime.now(timezone.utc).date()
    except (ValueError, AttributeError):
        return False


def get_community_report():
    """Fetch JustGetWet La Jolla tag page and return the best credibility-weighted visibility estimate.

    Returns dict: visibility_ft, weight, confidence_label, source_excerpt, error.
    Returns _NO_DATA (error=None) when no today posts are found.
    Returns {"error": str} on HTTP or parse failure.
    """
    try:
        resp = requests.get(_JUSTGETWET_URL, timeout=_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}", "visibility_ft": None, "weight": 0.0,
                    "confidence_label": "low", "source_excerpt": None}

        soup = BeautifulSoup(resp.text, "html.parser")
        all_articles = soup.find_all("div", class_="article__grid-meta")[:10]
        todays_articles = [a for a in all_articles if _is_today(a)]

        if not todays_articles:
            return dict(_NO_DATA)

        best = None
        for article in todays_articles:
            excerpt_el = article.find(class_="article__excerpt") or article
            text = excerpt_el.get_text(" ", strip=True)
            score = _score_post(text)
            vis = _extract_visibility(text)
            score["visibility_ft"] = vis
            score["source_excerpt"] = text[:300]
            if best is None or score["weight"] > best["weight"]:
                best = score

        if best is None or best["visibility_ft"] is None:
            return dict(_NO_DATA)

        return {
            "visibility_ft": best["visibility_ft"],
            "weight": best["weight"],
            "confidence_label": best["confidence_label"],
            "source_excerpt": best["source_excerpt"],
            "error": None,
        }
    except Exception as exc:
        return {"error": str(exc), "visibility_ft": None, "weight": 0.0,
                "confidence_label": "low", "source_excerpt": None}
