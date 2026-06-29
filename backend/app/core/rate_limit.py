from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import HTTPException, Request, status

from app.core.auth import AuthenticatedUser
from app.core.config import settings


logger = logging.getLogger(__name__)


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
        del key, limit, window_seconds, now
        raise RuntimeError("postgres_rate_limiter_deprecated")


class _RedisRateLimiter:
    _CHECK_MANY_SCRIPT = """
local window_seconds = tonumber(ARGV[1])
local failed_index = 0
for index, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[index + 1])
  if limit > 0 and window_seconds > 0 then
    local count = redis.call("INCR", key)
    if count == 1 then
      redis.call("EXPIRE", key, window_seconds)
    end
    if failed_index == 0 and count > limit then
      failed_index = index
    end
  end
end
return failed_index
"""

    def __init__(self) -> None:
        self._client: Any | None = None
        self._client_url: str | None = None
        self._client_timeout_seconds: float | None = None
        self._client_lock = Lock()

    def _get_client(self) -> Any:
        if not settings.redis_url:
            raise RuntimeError("redis_url_missing")

        timeout_seconds = max(0.001, settings.chat_cache_timeout_ms / 1000)
        redis_url = str(settings.redis_url)
        if (
            self._client is not None
            and self._client_url == redis_url
            and self._client_timeout_seconds == timeout_seconds
        ):
            return self._client

        with self._client_lock:
            if (
                self._client is not None
                and self._client_url == redis_url
                and self._client_timeout_seconds == timeout_seconds
            ):
                return self._client

            import redis  # type: ignore[import-not-found]

            self._client = redis.Redis.from_url(
                redis_url,
                socket_timeout=timeout_seconds,
                socket_connect_timeout=timeout_seconds,
                decode_responses=True,
            )
            self._client_url = redis_url
            self._client_timeout_seconds = timeout_seconds
            return self._client

    @staticmethod
    def _bucket_key(key: str, *, now: datetime, window_seconds: int) -> str:
        bucket = int(now.timestamp() // window_seconds)
        return f"rate_limit:{key}:{bucket}"

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

        client = self._get_client()
        current_time = now or datetime.now(timezone.utc)
        redis_key = self._bucket_key(key, now=current_time, window_seconds=window_seconds)
        count = int(client.incr(redis_key))
        if count == 1:
            client.expire(redis_key, window_seconds)
        if count <= limit:
            return True, 0
        retry_after = window_seconds - int(current_time.timestamp() % window_seconds)
        return False, max(1, retry_after)

    def check_many(
        self,
        *,
        checks: list[tuple[str, int]],
        window_seconds: int,
        now: datetime | None = None,
    ) -> tuple[bool, int, str | None]:
        if window_seconds <= 0:
            return True, 0, None
        active_checks = [(key, limit) for key, limit in checks if key and int(limit) > 0]
        if not active_checks:
            return True, 0, None

        client = self._get_client()
        current_time = now or datetime.now(timezone.utc)
        eval_script = getattr(client, "eval", None)
        if not callable(eval_script):
            for key, limit in active_checks:
                allowed, retry_after = self.check(
                    key=key,
                    limit=limit,
                    window_seconds=window_seconds,
                    now=current_time,
                )
                if not allowed:
                    return False, retry_after, key
            return True, 0, None

        redis_keys = [
            self._bucket_key(key, now=current_time, window_seconds=window_seconds)
            for key, _ in active_checks
        ]
        limits = [str(int(limit)) for _, limit in active_checks]
        failed_index = int(
            eval_script(
                self._CHECK_MANY_SCRIPT,
                len(redis_keys),
                *redis_keys,
                str(int(window_seconds)),
                *limits,
            )
        )
        if failed_index <= 0:
            return True, 0, None
        failed_key = active_checks[failed_index - 1][0]
        retry_after = window_seconds - int(current_time.timestamp() % window_seconds)
        return False, max(1, retry_after), failed_key


_LIMITS_BY_GROUP = {
    "chat": lambda: settings.rate_limit_chat_per_window,
    "trainer_assistant": lambda: settings.rate_limit_trainer_assistant_per_window,
    "onboarding": lambda: settings.rate_limit_onboarding_per_window,
    "mobile_events": lambda: settings.rate_limit_mobile_events_per_window,
    "invite_create": lambda: settings.rate_limit_invite_create_per_window,
    "invite_redeem": lambda: settings.rate_limit_invite_redeem_per_window,
    "invite_redeem_failed": lambda: settings.rate_limit_invite_redeem_failed_per_window,
    "trainer_assignment_mutation": lambda: settings.rate_limit_trainer_assignment_mutation_per_window,
    "login": lambda: settings.rate_limit_login_per_window,
    "signup": lambda: settings.rate_limit_signup_per_window,
    "password_reset": lambda: settings.rate_limit_password_reset_per_window,
    "credential_password_change": lambda: settings.rate_limit_credential_password_change_per_window,
    "credential_email_change": lambda: settings.rate_limit_credential_email_change_per_window,
    "memory_create": lambda: settings.rate_limit_memory_create_per_window,
    "file_upload": lambda: settings.rate_limit_file_upload_per_window,
    "expensive_ai": lambda: settings.rate_limit_expensive_ai_per_window,
}

_WINDOWS_BY_GROUP = {
    "credential_password_change": lambda: settings.rate_limit_credential_password_change_window_seconds,
    "credential_email_change": lambda: settings.rate_limit_credential_email_change_window_seconds,
}

_rate_limiter = _InMemoryRateLimiter()
_postgres_rate_limiter = _PostgresRateLimiter()
_redis_rate_limiter = _RedisRateLimiter()


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


def _context_map(context_key: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for item in context_key.split("|"):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            values[key] = value
    return values


def _client_ip(request: Request) -> str:
    return str(request.client.host if request.client else "unknown").strip() or "unknown"


def _rate_limit_checks(
    *,
    group: str,
    user: AuthenticatedUser,
    request: Request,
    context_key: str,
    default_limit: int,
) -> list[tuple[str, int]]:
    if group != "chat":
        checks = [(key, default_limit) for key in _request_scope_keys(user, request, group, context_key)]
        checks.append((f"any|scope:ip:{_client_ip(request)}", int(settings.rate_limit_ip_per_window)))
        return _dedupe_checks(checks)

    context = _context_map(context_key)
    checks: list[tuple[str, int]] = []
    user_id = str(getattr(user, "id", "") or "").strip()
    client_id = context.get("client_id")
    trainer_id = context.get("trainer_id")
    client_ip = _client_ip(request)
    per_user_chat_limit = int(settings.per_user_chat_rate_limit)
    global_chat_limit = int(settings.global_chat_rate_limit)

    if client_id:
        checks.append((f"chat|scope:client:{client_id}", int(settings.rate_limit_chat_client_per_window)))
    if user_id and per_user_chat_limit > 0:
        checks.append((f"chat|scope:user:{user_id}", per_user_chat_limit))
    if user_id:
        checks.append((f"chat|scope:user:{user_id}|{context_key}", int(settings.rate_limit_chat_per_window)))
    if trainer_id:
        checks.append((f"chat|scope:trainer:{trainer_id}", int(settings.rate_limit_chat_trainer_per_window)))
    checks.append((f"chat|scope:ip:{client_ip}", int(settings.rate_limit_chat_ip_per_window)))
    checks.append((f"any|scope:ip:{client_ip}", int(settings.rate_limit_ip_per_window)))
    if global_chat_limit > 0:
        checks.append(("chat|scope:global", global_chat_limit))
    return _dedupe_checks(checks)


def _dedupe_checks(checks: list[tuple[str, int]]) -> list[tuple[str, int]]:
    deduped: list[tuple[str, int]] = []
    seen: set[str] = set()
    for key, limit in checks:
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append((key, limit))
    return deduped


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
    group_window_resolver = _WINDOWS_BY_GROUP.get(group)
    window_seconds = (
        int(group_window_resolver())
        if callable(group_window_resolver)
        else int(settings.rate_limit_window_seconds)
    )
    context_bits = []
    if isinstance(context, dict):
        for key in sorted(context.keys()):
            value = str(context[key] or "").strip()
            if value:
                context_bits.append(f"{key}={value}")
    context_key = "|".join(context_bits)
    checks = _rate_limit_checks(
        group=group,
        user=user,
        request=request,
        context_key=context_key,
        default_limit=limit,
    )

    backend = str(settings.rate_limit_backend or "memory").strip().lower()
    if backend == "redis":
        checked_keys = [key for key, _ in checks]
        try:
            allowed, retry_after_seconds, _failed_key = _redis_rate_limiter.check_many(
                checks=checks,
                window_seconds=window_seconds,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"detail": "Rate limiter unavailable", "group": group},
            ) from exc
        if allowed:
            return
    else:
        limiter = _postgres_rate_limiter if backend == "postgres" else _rate_limiter
        retry_after_seconds = 1
        checked_keys = []
        for key, scoped_limit in checks:
            checked_keys.append(key)
            try:
                allowed, retry_after_seconds = limiter.check(
                    key=key,
                    limit=scoped_limit,
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

    logger.warning(
        json.dumps({
            "event": "rate_limit_event",
            "group": group,
            "backend": backend,
            "retry_after_seconds": retry_after_seconds,
            "scopes_checked_count": len(checked_keys),
            "user_id_present": bool(getattr(user, "id", None)),
        })
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "detail": "Rate limit exceeded",
            "group": group,
            "scopes_checked": checked_keys,
            "retry_after_seconds": retry_after_seconds,
        },
        headers={"Retry-After": str(retry_after_seconds)},
    )
