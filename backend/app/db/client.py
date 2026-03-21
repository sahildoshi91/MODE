from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

from app.core.config import settings


def get_supabase_admin_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_user_client(access_token: str) -> Client:
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            headers={
                "Authorization": f"Bearer {access_token}",
            },
        ),
    )


def get_supabase_client() -> Client:
    return get_supabase_admin_client()
