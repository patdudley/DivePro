import csv
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "migrate_forecast_log_display_policy",
    ROOT / "scripts" / "migrate_forecast_log_display_policy.py",
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


def test_migration_adds_blank_policy_column_and_is_idempotent(tmp_path):
    path = tmp_path / "forecast_log.csv"
    path.write_text(
        "forecast_id,guardrail_version,displayed_grade\n"
        "abc,v1-large-swell-rain-cap,C\n"
    )

    assert MIGRATION.migrate(path) is True
    assert MIGRATION.migrate(path) is False

    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows == [{
        "forecast_id": "abc",
        "guardrail_version": "v1-large-swell-rain-cap",
        "display_policy_version": "",
        "displayed_grade": "C",
    }]
