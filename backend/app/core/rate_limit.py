from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import HTTPException, Request, status

from app.core.auth import AuthenticatedUser
from app.core.config import settings
from app.db.client import get_supabase_admin_client


@dataclass
class _RateWindow:
    count: int
    reset_at: datetime


class _InMemoryRateLimiter:
    def __init__(self) -> None:
        self._windows: dict[str, _RateWindow] = {}
        self._lock = Lock()

    def check(
        self,
        *,
        key: str,
        limit: int,
        window_seconds: int,
        now: datetime | None = None,
    ) -> tuple[bool, int]:
        if limit <= 0:
            return True, 0
        if window_seconds <= 0:
            return True, 0
        current_time = now or datetime.now(timezone.utc)
        with self._lock:
            window = self._windows.get(key)
            if window is None or current_time >= window.reset_at:
                self._windows[key] = _RateWindow(
                    count=1,
                    reset_at=current_time + timedelta(seconds=window_seconds),
                )
                return True, 0

            if window.count >= limit:
                retry_after = int((window.reset_at - current_time).total_seconds())
                return False, max(1, retry_after)

            window.count += 1
            return True, 0


class _PostgresRateLimiter:
    def check(
        self,
        *,
        key: str,
        limit: int,
        window_seconds: int,
        now: datetime | None = None,
    ) -> tuple[bool, int]:
        if limit <= 0 or window_seconds <= 0:
            return True, 0
        payload = {
            "p_rate_key": key,
            "p_limit": int(limit),
            "p_window_seconds": int(window_seconds),
            "p_now": (now or datetime.now(timezone.utc)).isoformat(),
        }
        response = (
            get_supabase_admin_client()
            .rpc("security_enforce_rate_limit", payload)
            .execute()
        )
        data = response.data
        if isinstance(data, list):
            data = data[0] if data and isinstance(data[0], dict) else {}
        if not isinstance(data, dict):
            raise RuntimeError("Invalid rate-limit RPC response")
        allowed = bool(data.get("allowed"))
        retry_after = int(data.get("retry_after_seconds") or 1)
        return allowed, max(1, retry_after)


_LIMITS_BY_GROUP = {
    "chat": lambda: settings.rate_limit_chat_per_window,
    "trainer_assistant": lambda: settings.rate_limit_trainer_assistant_per_window,
    "onboarding": lambda: settings.rate_limit_onboarding_per_window,
    "mobile_events": lambda: settings.rate_limit_mobile_events_per_window,
    "invite_redeem": lambda: settings.rate_limit_invite_redeem_per_window,
    "login": lambda: settings.rate_limit_login_per_window,
    "signup": lambda: settings.rate_limit_signup_per_window,
    "password_reset": lambda: settings.rate_limit_password_reset_per_window,
    "memory_create": lambda: settings.rate_limit_memory_create_per_window,
    "file_upload": lambda: settings.rate_limit_file_upload_per_window,
    "expensive_ai": lambda: settings.rate_limit_expensive_ai_per_window,
}

_rate_limiter = _InMemoryRateLimiter()
_postgres_rate_limiter = _PostgresRateLimiter()


def _request_scope_keys(user: AuthenticatedUser, request: Request, group: str, context_key: str) -> list[str]:
    user_id = str(getattr(user, "id", "") or "").strip()
    client_ip = str(request.client.host if request.client else "unknown").strip() or "unknown"

    keys = []
    if user_id:
        keys.append(f"{group}|scope:user:{user_id}|{context_key}")
    keys.append(f"{group}|scope:ip:{client_ip}|{context_key}")

    context_map: dict[str, str] = {}
    for item in context_key.split("|"):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            context_map[key] = value

    trainer_id = context_map.get("trainer_id")
    tenant_id = context_map.get("tenant_id")
    if trainer_id:
        keys.append(f"{group}|scope:trainer:{trainer_id}")
    if tenant_id:
        keys.append(f"{group}|scope:tenant:{tenant_id}")
    keys.append(f"{group}|scope:global")

    unique_keys = []
    for key in keys:
        if key and key not in unique_keys:
            unique_keys.append(key)
    return unique_keys


def enforce_rate_limit(
    *,
    group: str,
    user: AuthenticatedUser,
    request: Request,
    context: dict[str, Any] | None = None,
) -> None:
    if not settings.rate_limit_enabled:
        return

    group_limit_resolver = _LIMITS_BY_GROUP.get(group)
    limit = (
        int(group_limit_resolver())
        if callable(group_limit_resolver)
        else int(settings.rate_limit_default_per_window)
    )
    window_seconds = int(settings.rate_limit_window_seconds)
    context_bits = []
    if isinstance(context, dict):
        for key in sorted(context.keys()):
            value = str(context[key] or "").strip()
            if value:
                context_bits.append(f"{key}={value}")
    context_key = "|".join(context_bits)
    keys = _request_scope_keys(user, request, group, context_key)

    backend = str(settings.rate_limit_backend or "memory").strip().lower()
    limiter = _postgres_rate_limiter if backend == "postgres" else _rate_limiter
    retry_after_seconds = 1
    for key in keys:
        try:
            allowed, retry_after_seconds = limiter.check(
                key=key,
                limit=limit,
                window_seconds=window_seconds,
            )
        except Exception as exc:
            if backend == "postgres":
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={"detail": "Rate limiter unavailable", "group": group},
                ) from exc
            raise
        if not allowed:
            break
    else:
        return

    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "detail": "Rate limit exceeded",
            "group": group,
            "scopes_checked": keys,
            "retry_after_seconds": retry_after_seconds,
        },
        headers={"Retry-After": str(retry_after_seconds)},
    )
