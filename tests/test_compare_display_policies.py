import csv
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "compare_display_policies", ROOT / "scripts" / "compare_display_policies.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_compare_reports_policy_transitions(tmp_path):
    path = tmp_path / "forecast.csv"
    rows = [
        {"displayed_grade": "D", "guarded_expected_vis_ft": "9.8"},
        {"displayed_grade": "D", "guarded_expected_vis_ft": "10.1"},
    ]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    report = MODULE.compare(path)
    assert report["changed_rows"] == 1
    assert report["transitions"] == {"D->C": 1, "D->D": 1}
