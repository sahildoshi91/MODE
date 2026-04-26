from __future__ import annotations

import os
from typing import Any

from app.core.config import settings
from app.db.client import get_supabase_admin_client


class StartupGuardError(RuntimeError):
    pass


def _contains_blocked_host(url: str, blocked_tokens: list[str]) -> bool:
    lowered = url.lower()
    return any(token and token in lowered for token in blocked_tokens)


def _assert_required_rls_tables() -> None:
    table_names = settings.production_required_rls_tables_list
    if not table_names:
        raise StartupGuardError("Production RLS guard is missing required table configuration")

    response = (
        get_supabase_admin_client()
        .rpc("security_assert_rls_enabled", {"p_table_names": table_names})
        .execute()
    )
    payload: Any = (response.data or {}) if isinstance(response.data, dict) else {}
    if isinstance(response.data, list) and response.data:
        payload = response.data[0] if isinstance(response.data[0], dict) else payload

    ok = bool(payload.get("ok"))
    if ok:
        return

    missing = payload.get("missing_or_unforced")
    raise StartupGuardError(
        f"Production startup blocked: required RLS tables are missing or not forced ({missing})"
    )


def run_startup_guards() -> None:
    if not settings.startup_guard_enabled:
        return

    if not settings.is_production:
        return

    if settings.expose_route_debug:
        raise StartupGuardError("Production startup blocked: expose_route_debug must be false")

    if not settings.account_deletion_enabled:
        raise StartupGuardError("Production startup blocked: account deletion must be enabled")

    if not settings.auth_password_proxy_enabled:
        raise StartupGuardError("Production startup blocked: password auth proxy must be enabled")

    if str(settings.rate_limit_backend).strip().lower() != "postgres":
        raise StartupGuardError("Production startup blocked: rate_limit_backend must be postgres")

    supabase_url = str(settings.supabase_url or "").strip()
    if not supabase_url:
        raise StartupGuardError("Production startup blocked: SUPABASE_URL is missing")
    if not supabase_url.lower().startswith("https://"):
        raise StartupGuardError("Production startup blocked: SUPABASE_URL must be https")
    if _contains_blocked_host(supabase_url, settings.production_block_staging_supabase_hosts_list):
        raise StartupGuardError("Production startup blocked: SUPABASE_URL points to staging/local host")

    service_role = str(settings.supabase_service_role_key or "").strip()
    if not service_role:
        raise StartupGuardError("Production startup blocked: SUPABASE_SERVICE_ROLE_KEY is missing")

    if str(os.getenv("EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        raise StartupGuardError(
            "Production startup blocked: EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must never be set"
        )

    _assert_required_rls_tables()
