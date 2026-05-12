import importlib.util
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "staging_db_security_check.py"


def _load_security_check_module():
    scripts_dir = str(REPO_ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    spec = importlib.util.spec_from_file_location("staging_db_security_check_for_tests", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_staging_db_security_check_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected staging_db_security_check.py to exist"


def test_staging_db_security_check_contains_required_checks() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "MODE_SECURITY_DATABASE_URL" in source
    assert "information_schema.role_routine_grants" in source
    assert "RLS posture" in source or "RLS" in source
    assert "TRUE_EXPRESSIONS" in source
    assert "cross-tenant" in source.lower()
    assert "storage lifecycle rls" in source.lower()
    assert "accepted signed-url exception" in source.lower()
    assert "trainer_invite_codes" in source
    assert "service-only access" in source
    assert "def _policy_expr_sql" in source
    assert "regexp_replace(COALESCE" in source
    assert "[[:space:]]+" in source
    assert "MODE_RUN_STAGING_SUPABASE_TESTS=1" in source
    assert "APP_ENV=staging" in source


class _PolicyRunner:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def query_rows(self, sql: str):
        self.queries.append(sql)
        return self.rows


def test_query_scalar_ignores_psql_command_status_rows() -> None:
    module = _load_security_check_module()
    runner = module.PsqlRunner.__new__(module.PsqlRunner)
    runner.query_rows = lambda _sql: [["SET"], ["authenticated"], ["user-123"], ["1"], ["RESET"]]

    assert runner.query_scalar("SELECT COUNT(*)") == "1"


def test_multiline_authenticated_policy_scope_is_accepted() -> None:
    module = _load_security_check_module()
    runner = _PolicyRunner(
        [
            [
                "public",
                "daily_checkins",
                "daily_checkins_insert_own",
                "authenticated",
                "",
                """
                EXISTS (
                  SELECT 1
                  FROM public.clients c
                  WHERE c.id = daily_checkins.client_id
                    AND c.user_id = auth.uid()
                )
                """,
            ]
        ]
    )
    failures: list[str] = []

    module._check_dangerous_policies(runner, failures)

    assert failures == []
    assert "regexp_replace(COALESCE(qual" in runner.queries[0]


def test_dangerous_true_policy_still_fails() -> None:
    module = _load_security_check_module()
    runner = _PolicyRunner([["public", "clients", "clients_select_all", "authenticated", "true", ""]])
    failures: list[str] = []

    module._check_dangerous_policies(runner, failures)

    assert "Dangerous policy detected (public.clients:clients_select_all): USING (true)" in failures


def test_ephemeral_cross_tenant_fixture_requires_staging_guard(monkeypatch) -> None:
    module = _load_security_check_module()
    monkeypatch.setenv("MODE_RUN_STAGING_SUPABASE_TESTS", "1")
    monkeypatch.setattr(module.settings, "app_env", "development")
    monkeypatch.setattr(module.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(module.settings, "supabase_anon_key", "anon")
    monkeypatch.setattr(module.settings, "supabase_service_role_key", "service")

    failures = module._ephemeral_fixture_guard_failures()

    assert failures == ["APP_ENV=staging"]
