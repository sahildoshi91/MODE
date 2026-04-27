from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "staging_db_security_check.py"


def test_staging_db_security_check_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected staging_db_security_check.py to exist"


def test_staging_db_security_check_contains_required_checks() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "MODE_SECURITY_DATABASE_URL" in source
    assert "information_schema.role_routine_grants" in source
    assert "RLS posture" in source or "RLS" in source
    assert "TRUE_EXPRESSIONS" in source
    assert "cross-tenant" in source.lower()
    assert "storage deny-by-default" in source.lower()
    assert "trainer_invite_codes" in source
    assert "service-only access" in source
