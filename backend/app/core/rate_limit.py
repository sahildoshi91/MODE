from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import HTTPException, Request, status

from app.core.auth import AuthenticatedUser
from app.core.config import settings


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


_LIMITS_BY_GROUP = {
    "chat": lambda: settings.rate_limit_chat_per_window,
    "trainer_assistant": lambda: settings.rate_limit_trainer_assistant_per_window,
    "onboarding": lambda: settings.rate_limit_onboarding_per_window,
    "mobile_events": lambda: settings.rate_limit_mobile_events_per_window,
}

_rate_limiter = _InMemoryRateLimiter()


def _request_actor_identity(user: AuthenticatedUser, request: Request) -> str:
    actor_id = str(getattr(user, "id", "") or "").strip()
    if actor_id:
        return f"user:{actor_id}"
    client_ip = request.client.host if request.client else "unknown"
    return f"ip:{client_ip}"


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
    actor = _request_actor_identity(user, request)
    context_bits = []
    if isinstance(context, dict):
        for key in sorted(context.keys()):
            value = str(context[key] or "").strip()
            if value:
                context_bits.append(f"{key}={value}")
    context_key = "|".join(context_bits)
    key = f"{group}|{actor}|{context_key}"

    allowed, retry_after_seconds = _rate_limiter.check(
        key=key,
        limit=limit,
        window_seconds=window_seconds,
    )
    if allowed:
        return

    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "detail": "Rate limit exceeded",
            "group": group,
            "retry_after_seconds": retry_after_seconds,
        },
        headers={"Retry-After": str(retry_after_seconds)},
    )
