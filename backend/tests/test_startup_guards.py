import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.config import settings
from app.core.startup_guards import StartupGuardError, run_startup_guards


class _FakeRpcResponse:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _FakeAdminClient:
    def __init__(self, rpc_payload):
        self._rpc_payload = rpc_payload

    def rpc(self, _name, _params):
        return _FakeRpcResponse(self._rpc_payload)


class StartupGuardsTests(unittest.TestCase):
    def setUp(self):
        self.original = {
            "app_env": settings.app_env,
            "startup_guard_enabled": settings.startup_guard_enabled,
            "expose_route_debug": settings.expose_route_debug,
            "account_deletion_enabled": settings.account_deletion_enabled,
            "account_deletion_contract_enforced": settings.account_deletion_contract_enforced,
            "personal_data_inventory_path": settings.personal_data_inventory_path,
            "auth_password_proxy_enabled": settings.auth_password_proxy_enabled,
            "rate_limit_backend": settings.rate_limit_backend,
            "redis_url": settings.redis_url,
            "supabase_url": settings.supabase_url,
            "supabase_service_role_key": settings.supabase_service_role_key,
            "production_required_rls_tables": settings.production_required_rls_tables,
            "production_block_staging_supabase_hosts": settings.production_block_staging_supabase_hosts,
        }
        settings.app_env = "production"
        settings.startup_guard_enabled = True
        settings.expose_route_debug = False
        settings.account_deletion_enabled = True
        settings.account_deletion_contract_enforced = True
        settings.personal_data_inventory_path = "security/personal_data_inventory.json"
        settings.auth_password_proxy_enabled = True
        settings.rate_limit_backend = "redis"
        settings.redis_url = "redis://localhost:6379/0"
        settings.supabase_url = "https://example.supabase.co"
        settings.supabase_service_role_key = "service-role"
        settings.production_required_rls_tables = "clients,trainers,trainer_invite_codes"
        settings.production_block_staging_supabase_hosts = "staging,localhost,127.0.0.1"
        os.environ.pop("EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", None)

    def tearDown(self):
        settings.app_env = self.original["app_env"]
        settings.startup_guard_enabled = self.original["startup_guard_enabled"]
        settings.expose_route_debug = self.original["expose_route_debug"]
        settings.account_deletion_enabled = self.original["account_deletion_enabled"]
        settings.account_deletion_contract_enforced = self.original["account_deletion_contract_enforced"]
        settings.personal_data_inventory_path = self.original["personal_data_inventory_path"]
        settings.auth_password_proxy_enabled = self.original["auth_password_proxy_enabled"]
        settings.rate_limit_backend = self.original["rate_limit_backend"]
        settings.redis_url = self.original["redis_url"]
        settings.supabase_url = self.original["supabase_url"]
        settings.supabase_service_role_key = self.original["supabase_service_role_key"]
        settings.production_required_rls_tables = self.original["production_required_rls_tables"]
        settings.production_block_staging_supabase_hosts = self.original["production_block_staging_supabase_hosts"]
        os.environ.pop("EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", None)

    def test_startup_guards_pass_with_safe_configuration(self):
        with patch(
            "app.core.startup_guards.get_supabase_admin_client",
            return_value=_FakeAdminClient([{"ok": True, "missing_or_unforced": []}]),
        ):
            run_startup_guards()

    def test_startup_guards_fail_when_debug_route_is_enabled(self):
        settings.expose_route_debug = True
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_fail_when_rate_limiter_is_not_redis(self):
        settings.rate_limit_backend = "memory"
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_fail_when_redis_url_is_missing(self):
        settings.redis_url = None
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_fail_when_client_service_role_env_is_set(self):
        os.environ["EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] = "leak"
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_fail_when_deletion_contract_is_disabled(self):
        settings.account_deletion_contract_enforced = False
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_fail_when_staging_uses_memory_backend(self):
        # Staging is not is_production, but the shared-env rate-limit guard must still
        # refuse the in-memory backend (per-process counters do not hold across workers).
        settings.app_env = "staging"
        settings.rate_limit_backend = "memory"
        with self.assertRaises(StartupGuardError):
            run_startup_guards()

    def test_startup_guards_pass_in_staging_with_redis_backend(self):
        settings.app_env = "staging"
        settings.rate_limit_backend = "redis"
        # Staging returns before the production-only guards (RLS assertion etc.).
        run_startup_guards()

    def test_startup_guards_fail_when_rls_assertion_fails(self):
        with patch(
            "app.core.startup_guards.get_supabase_admin_client",
            return_value=_FakeAdminClient([{"ok": False, "missing_or_unforced": ["coach_memory"]}]),
        ):
            with self.assertRaises(StartupGuardError):
                run_startup_guards()


if __name__ == "__main__":
    unittest.main()
