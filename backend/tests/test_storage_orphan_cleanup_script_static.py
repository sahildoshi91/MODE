from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "storage_orphan_cleanup.py"


def test_storage_orphan_cleanup_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected storage_orphan_cleanup.py to exist"


def test_storage_orphan_cleanup_script_has_required_keywords() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "dry-run" in source
    assert "Storage orphan cleanup: PASSED" in source
    assert "run_cleanup" in source
    assert "record_cleanup_heartbeat" in source
    assert "run-source" in source
    assert "expected-interval-minutes" in source
    assert "release_gate" in source
