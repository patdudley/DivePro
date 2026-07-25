import csv
import importlib.util
import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "backfill_forecast_policy_history",
    ROOT / "scripts" / "backfill_forecast_policy_history.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _row(forecast_id="fc-1"):
    return {
        "forecast_id": forecast_id,
        "forecast_run_ts_utc": "2026-07-01T15:00:00Z",
        "target_date": "2026-07-01",
        "lead_time_hours": "0",
        "prob_F": "0",
        "prob_D": "0.1",
        "prob_C": "0.7",
        "prob_B": "0.2",
        "prob_A": "0",
        "prob_Aplus": "0",
        "raw_expected_vis_ft": "12",
        "guardrail_applied": "0",
        "guarded_expected_vis_ft": "12",
    }


def test_canonical_selection_keeps_first_morning_run_and_all_horizons():
    rows = []
    for run_hour in (6, 8, 9):
        for day_out in range(10):
            row = _row(f"{run_hour}-{day_out}")
            row["forecast_run_ts_utc"] = f"2026-07-01T{run_hour + 7:02d}:00:00Z"
            row["target_date"] = f"2026-07-{1 + day_out:02d}"
            rows.append(row)
    selected, omitted = MODULE.canonical_run_timestamps(rows)
    assert selected == {"2026-07-01T15:00:00Z"}
    assert omitted == []
    report = MODULE.build_report(rows, "v3")
    assert report["canonical_headline"]["rows"] == 10
    assert report["all_call_diagnostic"]["rows"] == 30


def test_backfill_is_idempotent(tmp_path, monkeypatch, capsys):
    log_path = tmp_path / "forecast_log.csv"
    row = _row()
    with log_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)
    config = tmp_path / "forecast-config.json"
    config.write_text('{"display_policy":"v3"}')
    history = tmp_path / "history"
    argv = [
        "backfill",
        "--forecast-log",
        str(log_path),
        "--history-dir",
        str(history),
        "--config",
        str(config),
        "--write",
    ]
    monkeypatch.setattr(sys, "argv", argv)
    assert MODULE.main() == 0
    first = capsys.readouterr().out
    assert "APPENDED_RECORDS 1" in first
    assert MODULE.main() == 0
    second = capsys.readouterr().out
    assert "APPENDED_RECORDS 0" in second
    records = [
        json.loads(line)
        for path in history.glob("*.jsonl")
        for line in path.read_text().splitlines()
    ]
    assert len(records) == 1


def test_workflow_stages_only_policy_history_directory_for_new_audit():
    workflow = (ROOT / ".github" / "workflows" / "update-forecast.yml").read_text()
    assert "git add forecast_log.csv model_outputs forecast-policy-history" in workflow
