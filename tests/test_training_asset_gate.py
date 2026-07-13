import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_visibility_training_assets", ROOT / "scripts/check_visibility_training_assets.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_asset_gate_blocks_incomplete_recovery(tmp_path):
    assert MODULE.inspect(tmp_path)["ready"] is False


def test_asset_gate_records_hashes_when_complete(tmp_path):
    for name in MODULE.REQUIRED_ASSETS:
        (tmp_path / name).write_text("asset")
    (tmp_path / "build_training_data.py").write_text("builder")
    (tmp_path / "training_source_config.json").write_text("{}")
    report = MODULE.inspect(tmp_path)
    assert report["ready"] is True
    assert all(item["sha256"] for item in report["assets"].values())
