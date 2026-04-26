from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = REPO_ROOT / "sql" / "20260426b_harden_privileged_rpc_execute_permissions.sql"


def test_privileged_rpc_hardening_migration_exists() -> None:
    assert MIGRATION_PATH.exists(), "Expected privileged RPC hardening migration to exist"


def test_privileged_rpc_hardening_migration_revokes_public_and_authenticated() -> None:
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    assert "bootstrap_trainer_tenant" in source
    assert "assign_client_to_trainer" in source
    assert "REVOKE ALL ON FUNCTION %s FROM PUBLIC" in source
    assert "REVOKE ALL ON FUNCTION %s FROM anon" in source
    assert "REVOKE ALL ON FUNCTION %s FROM authenticated" in source
    assert "GRANT EXECUTE ON FUNCTION %s TO service_role" in source
