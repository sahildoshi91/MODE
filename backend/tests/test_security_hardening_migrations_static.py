from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read_sql(name: str) -> str:
    return (REPO_ROOT / "sql" / name).read_text(encoding="utf-8")


def test_invite_codes_service_only_migration_hardens_access() -> None:
    source = _read_sql("20260426d_harden_trainer_invite_codes_service_only.sql")
    assert "ADD COLUMN IF NOT EXISTS code_hash" in source
    assert "ADD COLUMN IF NOT EXISTS used_at" in source
    assert "ADD COLUMN IF NOT EXISTS used_by_user_id" in source
    assert "ADD COLUMN IF NOT EXISTS revoked_at" in source
    assert "REVOKE ALL ON public.trainer_invite_codes FROM anon" in source
    assert "REVOKE ALL ON public.trainer_invite_codes FROM authenticated" in source
    assert "DROP POLICY IF EXISTS" in source


def test_rpc_execute_allowlist_migration_revokes_broad_access() -> None:
    source = _read_sql("20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql")
    assert "security_enforce_rate_limit" in source
    assert "security_assert_rls_enabled" in source
    assert "REVOKE ALL ON FUNCTION %s FROM PUBLIC" in source
    assert "REVOKE ALL ON FUNCTION %s FROM anon" in source
    assert "REVOKE ALL ON FUNCTION %s FROM authenticated" in source
    assert "GRANT EXECUTE ON FUNCTION %s TO service_role" in source


def test_storage_lockdown_migration_denies_anon_and_authenticated_access() -> None:
    source = _read_sql("20260426f_lockdown_storage_objects_service_signed_urls_only.sql")
    assert "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY" in source
    assert "ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY" in source
    assert "REVOKE ALL ON storage.objects FROM anon" in source
    assert "REVOKE ALL ON storage.objects FROM authenticated" in source
    assert "UPDATE storage.buckets" in source
    assert "SET public = FALSE" in source
    assert "USING (FALSE)" in source
    assert "WITH CHECK (FALSE)" in source


def test_account_deletion_audit_table_is_service_scoped() -> None:
    source = _read_sql("20260426g_add_account_deletion_audit_log.sql")
    assert "CREATE TABLE IF NOT EXISTS public.account_deletion_audits" in source
    assert "REVOKE ALL ON public.account_deletion_audits FROM anon" in source
    assert "REVOKE ALL ON public.account_deletion_audits FROM authenticated" in source
    assert "GRANT SELECT, INSERT ON public.account_deletion_audits TO service_role" in source


def test_storage_upload_lifecycle_tables_and_security_catalog_rpc_are_service_scoped() -> None:
    source = _read_sql("20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql")
    assert "CREATE TABLE IF NOT EXISTS public.storage_upload_grants" in source
    assert "CREATE TABLE IF NOT EXISTS public.storage_object_ownership" in source
    assert "REVOKE ALL ON public.storage_upload_grants FROM anon" in source
    assert "REVOKE ALL ON public.storage_object_ownership FROM authenticated" in source
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_upload_grants TO service_role" in source
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_object_ownership TO service_role" in source
    assert "CREATE OR REPLACE FUNCTION public.security_list_public_tables()" in source
    assert "GRANT EXECUTE ON FUNCTION public.security_list_public_tables() TO service_role" in source


def test_storage_cleanup_heartbeat_table_is_service_scoped() -> None:
    source = _read_sql("20260426i_add_storage_cleanup_job_heartbeats.sql")
    assert "CREATE TABLE IF NOT EXISTS public.storage_cleanup_job_heartbeats" in source
    assert "run_source IN ('scheduled', 'manual', 'release_gate')" in source
    assert "REVOKE ALL ON public.storage_cleanup_job_heartbeats FROM anon" in source
    assert "ALTER TABLE public.storage_cleanup_job_heartbeats ENABLE ROW LEVEL SECURITY" in source
    assert "GRANT SELECT, INSERT ON public.storage_cleanup_job_heartbeats TO service_role" in source
