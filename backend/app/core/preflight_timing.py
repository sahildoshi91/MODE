from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import Request

from app.core.tenancy import TrainerContext


def elapsed_ms(started_at: float, ended_at: float | None = None) -> int:
    ended = time.perf_counter() if ended_at is None else ended_at
    return max(int((ended - started_at) * 1000), 0)


def request_state_int(request: Request, name: str) -> int | None:
    value = getattr(request.state, name, None)
    if value is None:
        return None
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return None


def request_state_bool(request: Request, name: str) -> bool:
    return bool(getattr(request.state, name, False))


def emit_authenticated_preflight_timing(
    logger: logging.Logger,
    *,
    request: Request,
    endpoint: str,
    request_id: str,
    trainer_context: TrainerContext | None = None,
    session_fetch_or_create_ms: int | None = None,
    profile_context_ms: int | None = None,
    redis_rate_limit_ms: int | None = None,
    total_preflight_ms: int | None = None,
    error_category: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    started_at = getattr(
        request.state,
        "authenticated_preflight_request_started_at",
        getattr(request.state, "chat_stream_request_started_at", None),
    )
    computed_total_preflight_ms = total_preflight_ms
    if computed_total_preflight_ms is None and isinstance(started_at, float):
        computed_total_preflight_ms = elapsed_ms(started_at)

    tenant_membership_ms = request_state_int(request, "tenant_membership_ms")
    if tenant_membership_ms is None:
        tenant_membership_ms = request_state_int(request, "trainer_context_resolve_ms")

    payload: dict[str, Any] = {
        "event": "authenticated_preflight_timing",
        "request_id": request_id,
        "endpoint": endpoint,
        "tenant_id": str(trainer_context.tenant_id or "") if trainer_context else "",
        "trainer_id": str(trainer_context.trainer_id or "") if trainer_context else "",
        "client_id": str(trainer_context.client_id or "") if trainer_context else "",
        "auth_decode_ms": request_state_int(request, "auth_decode_ms"),
        "supabase_user_lookup_ms": request_state_int(request, "supabase_user_lookup_ms"),
        "auth_get_user_ms": request_state_int(request, "auth_get_user_ms"),
        "tenant_membership_ms": tenant_membership_ms,
        "trainer_context_resolve_ms": request_state_int(request, "trainer_context_resolve_ms"),
        "session_fetch_or_create_ms": session_fetch_or_create_ms,
        "profile_context_ms": profile_context_ms,
        "redis_rate_limit_ms": redis_rate_limit_ms,
        "total_preflight_ms": computed_total_preflight_ms,
        "auth_cache_hit": request_state_bool(request, "auth_cache_hit"),
        "auth_in_process_cache_hit": request_state_bool(request, "auth_in_process_cache_hit"),
        "auth_shared_cache_hit": request_state_bool(request, "auth_shared_cache_hit"),
        "auth_local_jwt": request_state_bool(request, "auth_local_jwt"),
        "auth_singleflight_wait_ms": request_state_int(request, "auth_singleflight_wait_ms"),
        "tenant_context_cache_hit": request_state_bool(request, "tenant_context_cache_hit"),
        "tenant_context_shared_cache_hit": request_state_bool(request, "tenant_context_shared_cache_hit"),
        "tenant_context_rpc_used": request_state_bool(request, "tenant_context_rpc_used"),
        "tenant_context_singleflight_wait_ms": request_state_int(request, "tenant_context_singleflight_wait_ms"),
        "error_category": error_category,
    }
    if extra:
        payload.update(extra)
    logger.warning(json.dumps(payload, default=str))
