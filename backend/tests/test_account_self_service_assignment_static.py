from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = REPO_ROOT / "sql" / "20260603a_account_self_service_trainer_assignments.sql"


def _source() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


def test_account_self_service_assignment_migration_adds_integrity_columns_and_event_log() -> None:
    source = _source()
    assert "ADD COLUMN IF NOT EXISTS unassigned_by_user_id" in source
    assert "ADD COLUMN IF NOT EXISTS unassigned_reason" in source
    assert "ADD COLUMN IF NOT EXISTS updated_at" in source
    assert "CREATE TABLE IF NOT EXISTS public.trainer_assignment_events" in source
    assert "actor_user_id" in source
    assert "metadata JSONB NOT NULL DEFAULT '{}'::jsonb" in source


def test_account_self_service_assignment_migration_has_dry_run_backfill_only() -> None:
    source = _source()
    assert "dry_run_duplicate_active_client_trainer_assignments" in source
    assert "rows_that_would_close" in source
    dry_run_section = source.split("CREATE UNIQUE INDEX", 1)[0]
    assert "UPDATE public.client_trainer_assignments" not in dry_run_section


def test_account_self_service_assignment_migration_has_partial_unique_active_index() -> None:
    source = _source()
    assert "idx_client_trainer_assignments_one_active_per_client" in source
    assert "ON public.client_trainer_assignments (client_id)" in source
    assert "WHERE unassigned_at IS NULL" in source


def test_account_self_service_assignment_rpcs_are_service_role_only() -> None:
    source = _source()
    assert "CREATE OR REPLACE FUNCTION public.account_self_detach_trainer_assignment" in source
    assert "CREATE OR REPLACE FUNCTION public.account_reassign_trainer_by_invite" in source
    assert "REVOKE ALL ON FUNCTION public.account_self_detach_trainer_assignment(UUID) FROM authenticated" in source
    assert "REVOKE ALL ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) FROM authenticated" in source
    assert "GRANT EXECUTE ON FUNCTION public.account_self_detach_trainer_assignment(UUID) TO service_role" in source
    assert "GRANT EXECUTE ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) TO service_role" in source


def test_no_authenticated_direct_clients_update_grants_exist() -> None:
    sql_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((REPO_ROOT / "sql").glob("*.sql"))
    )
    assert "GRANT SELECT, INSERT, UPDATE ON public.clients TO authenticated" not in sql_sources
    assert "GRANT UPDATE ON public.clients TO authenticated" not in sql_sources
