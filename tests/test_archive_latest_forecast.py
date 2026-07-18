# ABOUTME: Tests the forecast history archiver — it must read the pipeline's
# ABOUTME: model_outputs/latest_forecast.json, not a stale root-level mirror.
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "archive_latest_forecast", ROOT / "scripts" / "archive_latest_forecast.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_latest_reads_from_model_outputs():
    mod = _load_module()
    assert mod.LATEST == ROOT / "model_outputs" / "latest_forecast.json"


def test_archive_appends_history(tmp_path, monkeypatch):
    mod = _load_module()
    latest = tmp_path / "latest_forecast.json"
    latest.write_text(json.dumps({
        "date": "2026-07-01", "grade": "B", "generated_at": "2026-07-01T14:00:00Z",
        "estimated_visibility_range_ft": [15, 20],
    }))
    monkeypatch.setattr(mod, "LATEST", latest)
    monkeypatch.setattr(mod, "HISTORY", tmp_path / "forecast_history.json")
    monkeypatch.setattr(mod, "DAILY_DIR", tmp_path / "forecast-history")
    assert mod.main() == 0
    history = json.loads((tmp_path / "forecast_history.json").read_text())
    assert history[0]["grade"] == "B"
    assert (tmp_path / "forecast-history" / "2026-07-01.json").exists()


def test_archive_preserves_narrative_paragraphs():
    mod = _load_module()
    report = "Result paragraph.\n\nTide paragraph.\n\nPractical paragraph."
    cleaned = mod.clean_report_text({"report_text": report})
    assert cleaned == report
