from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

from app.core.config import settings


def _require_setting(value: str | None, setting_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise RuntimeError(f"Missing required setting: {setting_name}")
    return normalized


def get_supabase_admin_client() -> Client:
    return create_client(
        _require_setting(settings.supabase_url, "SUPABASE_URL"),
        _require_setting(settings.supabase_service_role_key, "SUPABASE_SERVICE_ROLE_KEY"),
    )


def get_supabase_user_client(access_token: str) -> Client:
    return create_client(
        _require_setting(settings.supabase_url, "SUPABASE_URL"),
        _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY"),
        options=SyncClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            headers={
                "Authorization": f"Bearer {access_token}",
            },
        ),
    )


def get_supabase_public_client() -> Client:
    return create_client(
        _require_setting(settings.supabase_url, "SUPABASE_URL"),
        _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY"),
        options=SyncClientOptions(
            auto_refresh_token=False,
            persist_session=False,
        ),
    )


def get_supabase_client() -> Client:
    return get_supabase_admin_client()
