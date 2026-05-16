from __future__ import annotations

import threading
from typing import Any

import httpx

from app.core.config import settings


_POSTGREST_CLIENT_LOCK = threading.Lock()
_POSTGREST_CLIENT: httpx.Client | None = None


def clear_postgrest_client_cache() -> None:
    global _POSTGREST_CLIENT
    with _POSTGREST_CLIENT_LOCK:
        if _POSTGREST_CLIENT is not None:
            _POSTGREST_CLIENT.close()
        _POSTGREST_CLIENT = None


def _require_setting(value: str | None, setting_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise RuntimeError(f"Missing required setting: {setting_name}")
    return normalized


def _get_postgrest_client() -> httpx.Client:
    global _POSTGREST_CLIENT
    with _POSTGREST_CLIENT_LOCK:
        if _POSTGREST_CLIENT is None:
            _POSTGREST_CLIENT = httpx.Client(
                timeout=httpx.Timeout(10.0, connect=2.0),
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
            )
        return _POSTGREST_CLIENT


def authenticated_postgrest_get(
    table: str,
    *,
    access_token: str,
    params: dict[str, str] | list[tuple[str, str]],
) -> list[dict[str, Any]]:
    supabase_url = _require_setting(settings.supabase_url, "SUPABASE_URL").rstrip("/")
    anon_key = _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY")
    token = str(access_token or "").strip()
    if not token:
        raise ValueError("Authenticated PostgREST request requires an access token")

    response = _get_postgrest_client().get(
        f"{supabase_url}/rest/v1/{table}",
        params=params,
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def authenticated_postgrest_rpc(
    function_name: str,
    *,
    access_token: str,
    payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    supabase_url = _require_setting(settings.supabase_url, "SUPABASE_URL").rstrip("/")
    anon_key = _require_setting(settings.supabase_anon_key, "SUPABASE_ANON_KEY")
    token = str(access_token or "").strip()
    if not token:
        raise ValueError("Authenticated PostgREST RPC requires an access token")

    response = _get_postgrest_client().post(
        f"{supabase_url}/rest/v1/rpc/{function_name}",
        json=payload or {},
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [data]
    return []
