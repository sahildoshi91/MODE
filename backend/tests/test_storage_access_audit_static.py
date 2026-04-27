from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "storage_access_audit.py"


def test_storage_access_audit_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected scripts/storage_access_audit.py"


def test_storage_access_audit_contains_direct_storage_patterns() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "supabase\\.storage" in source
    assert "storage\\.from_" in source
    assert "Storage access audit: FAILED" in source
