from __future__ import annotations

import hashlib
import threading
import time

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from app.core.config import settings


_CLIENT_CACHE_LOCK = threading.Lock()
_ADMIN_CLIENT_CACHE: dict[tuple[str, str], Client] = {}
_PUBLIC_CLIENT_CACHE: dict[tuple[str, str], Client] = {}
_USER_CLIENT_CACHE: dict[tuple[str, str, str, int], tuple[float, Client]] = {}
_USER_CLIENT_TTL_SECONDS = 120


def _require_setting(value: str | None, setting_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise RuntimeError(f"Missing required setting: {setting_name}")
    return normalized


def _token_hash(access_token: str) -> str:
    return hashlib.sha256(access_token.encode("utf-8")).hexdigest()


def clear_supabase_client_cache() -> None:
    with _CLIENT_CACHE_LOCK:
        _ADMIN_CLIENT_CACHE.clear()
        _PUBLIC_CLIENT_CACHE.clear()
        _USER_CLIENT_CACHE.clear()


def get_supabase_admin_client() -> Client:
    url = _require_setting(settings.supabase_url, "SUPABASE_URL")
    key = _require_setting(settings.supabase_service_role_key, "SUPABASE_SERVICE_ROLE_KEY")
    cache_key = (url, key)
    with _CLIENT_CACHE_LOCK:
        cached = _ADMIN_CLIENT_CACHE.get(cache_key)
        if cached is not None:
            return cached
        client = create_client(url, key)
        _ADMIN_CLIENT_CACHE[cache_key] = client
        return client


def get_supabase_user_client(access_token: str) -> Client:
    url = _require_setting(settings.supabase_url, "SUPABASE_URL")
    key = _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY")
    cache_key = (url, key, _token_hash(access_token), threading.get_ident())
    now = time.monotonic()
    with _CLIENT_CACHE_LOCK:
        cached = _USER_CLIENT_CACHE.get(cache_key)
        if cached is not None:
            expires_at, client = cached
            if expires_at > now:
                return client
            _USER_CLIENT_CACHE.pop(cache_key, None)
        client = create_client(
            url,
            key,
            options=SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
                headers={
                    "Authorization": f"Bearer {access_token}",
                },
            ),
        )
        _USER_CLIENT_CACHE[cache_key] = (now + _USER_CLIENT_TTL_SECONDS, client)
        return client


def get_supabase_public_client() -> Client:
    url = _require_setting(settings.supabase_url, "SUPABASE_URL")
    key = _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY")
    cache_key = (url, key)
    with _CLIENT_CACHE_LOCK:
        cached = _PUBLIC_CLIENT_CACHE.get(cache_key)
        if cached is not None:
            return cached
        client = create_client(
            url,
            key,
            options=SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
            ),
        )
        _PUBLIC_CLIENT_CACHE[cache_key] = client
        return client


def get_supabase_client() -> Client:
    return get_supabase_admin_client()
