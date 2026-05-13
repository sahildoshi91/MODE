from __future__ import annotations

import asyncio
import copy
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

from app.core.config import settings
from app.db.client import get_supabase_public_client
from app.modules.intelligence_jobs.queue import QUEUE_NAMES
from app.modules.observability.metrics import emit_db_query_metric, emit_metric


logger = logging.getLogger(__name__)

HEALTH_TIMEOUT_MS = 500
HEALTH_CACHE_TTL_SECONDS = 5.0
HEALTH_STALE_AFTER_SECONDS = 30.0


@dataclass(frozen=True)
class HealthCheckResult:
    status: str
    latency_ms: int
    error_category: str | None = None


@dataclass(frozen=True)
class HealthSnapshot:
    captured_at: float
    payload: dict[str, Any]


_health_snapshot: HealthSnapshot | None = None
_health_refresh_task: asyncio.Task[HealthSnapshot] | None = None
_health_refresh_lock: asyncio.Lock | None = None


async def build_healthz_payload(
    *,
    timeout_ms: int | None = None,
    cache_ttl_seconds: float | None = None,
    stale_after_seconds: float | None = None,
) -> dict[str, Any]:
    response_started_at = time.perf_counter()
    effective_timeout_ms = int(timeout_ms if timeout_ms is not None else settings.health_check_timeout_ms)
    effective_cache_ttl_seconds = float(
        cache_ttl_seconds if cache_ttl_seconds is not None else settings.health_cache_ttl_seconds
    )
    effective_stale_after_seconds = float(
        stale_after_seconds if stale_after_seconds is not None else settings.health_stale_after_seconds
    )

    snapshot = _health_snapshot
    if snapshot is None:
        _schedule_health_refresh(timeout_ms=effective_timeout_ms)
        payload = _initializing_payload()
        cache_age_ms: int | None = None
    else:
        cache_age_seconds = max(0.0, time.perf_counter() - snapshot.captured_at)
        if cache_age_seconds > effective_cache_ttl_seconds:
            _schedule_health_refresh(timeout_ms=effective_timeout_ms)
        payload = copy.deepcopy(snapshot.payload)
        cache_age_ms = int(cache_age_seconds * 1000)
        if cache_age_seconds > effective_stale_after_seconds:
            _mark_payload_stale(payload)

    payload["duration_ms"] = int((time.perf_counter() - response_started_at) * 1000)
    payload["cache_age_ms"] = cache_age_ms
    status = str(payload.get("status") or "degraded")
    emit_metric("healthz.duration_ms", payload["duration_ms"], unit="ms", tags={"status": status})
    return payload


async def refresh_health_snapshot(*, timeout_ms: int | None = None) -> HealthSnapshot:
    return await _refresh_health_snapshot(
        timeout_ms=int(timeout_ms if timeout_ms is not None else settings.health_check_timeout_ms)
    )


def reset_health_cache_for_tests() -> None:
    global _health_snapshot, _health_refresh_task, _health_refresh_lock
    _health_snapshot = None
    if _health_refresh_task and not _health_refresh_task.done():
        _health_refresh_task.cancel()
    _health_refresh_task = None
    _health_refresh_lock = None


async def _collect_health_payload(*, timeout_ms: int) -> dict[str, Any]:
    started_at = time.perf_counter()
    db, redis, queue = await asyncio.gather(
        _run_check("db", _check_db_sync, timeout_ms=timeout_ms),
        _run_check("redis", _check_redis_sync, timeout_ms=timeout_ms),
        _run_check("queue", _check_queue_sync, timeout_ms=timeout_ms),
    )
    status = "ok" if all(item.status == "ok" for item in (db, redis, queue)) else "degraded"
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    emit_metric("healthz.duration_ms", duration_ms, unit="ms", tags={"status": status})
    return {
        "status": status,
        "ok": status == "ok",
        "db": db.status,
        "redis": redis.status,
        "queue": queue.status,
        "duration_ms": 0,
        "dependency_duration_ms": duration_ms,
        "checks": {
            "db": asdict(db),
            "redis": asdict(redis),
            "queue": asdict(queue),
        },
    }


async def _refresh_health_snapshot(*, timeout_ms: int) -> HealthSnapshot:
    global _health_snapshot
    lock = _get_health_refresh_lock()
    async with lock:
        payload = await _collect_health_payload(timeout_ms=timeout_ms)
        snapshot = HealthSnapshot(captured_at=time.perf_counter(), payload=payload)
        _health_snapshot = snapshot
        return snapshot


def _schedule_health_refresh(*, timeout_ms: int) -> None:
    global _health_refresh_task
    if _health_refresh_task and not _health_refresh_task.done():
        return
    _health_refresh_task = asyncio.create_task(_refresh_health_snapshot(timeout_ms=timeout_ms))
    _health_refresh_task.add_done_callback(_log_health_refresh_failure)


def _log_health_refresh_failure(task: asyncio.Task[HealthSnapshot]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception as exc:  # pragma: no cover - defensive logging for production probes.
        logger.warning("health_snapshot_refresh_failed", extra={"error_category": exc.__class__.__name__})


def _get_health_refresh_lock() -> asyncio.Lock:
    global _health_refresh_lock
    if _health_refresh_lock is None:
        _health_refresh_lock = asyncio.Lock()
    return _health_refresh_lock


def _initializing_payload() -> dict[str, Any]:
    unknown = HealthCheckResult(status="unknown", latency_ms=0, error_category="NoHealthSnapshot")
    return {
        "status": "degraded",
        "ok": False,
        "db": unknown.status,
        "redis": unknown.status,
        "queue": unknown.status,
        "duration_ms": 0,
        "dependency_duration_ms": None,
        "checks": {
            "db": asdict(unknown),
            "redis": asdict(unknown),
            "queue": asdict(unknown),
        },
    }


def _mark_payload_stale(payload: dict[str, Any]) -> None:
    payload["status"] = "degraded"
    payload["ok"] = False
    payload["stale"] = True
    checks = payload.setdefault("checks", {})
    if isinstance(checks, dict):
        checks["snapshot"] = {
            "status": "stale",
            "latency_ms": 0,
            "error_category": "HealthSnapshotStale",
        }


async def _run_check(name: str, fn: Callable[[], None], *, timeout_ms: int) -> HealthCheckResult:
    started_at = time.perf_counter()
    try:
        await asyncio.wait_for(asyncio.to_thread(fn), timeout=max(0.001, timeout_ms / 1000))
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if name == "db":
            emit_db_query_metric("healthz", latency_ms, ok=True)
        return HealthCheckResult(status="ok", latency_ms=latency_ms)
    except asyncio.TimeoutError:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if name == "db":
            emit_db_query_metric("healthz", latency_ms, ok=False)
        return HealthCheckResult(status="timeout", latency_ms=latency_ms, error_category="TimeoutError")
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if name == "db":
            emit_db_query_metric("healthz", latency_ms, ok=False)
        return HealthCheckResult(status="error", latency_ms=latency_ms, error_category=exc.__class__.__name__)


def _check_db_sync() -> None:
    client = get_supabase_public_client()
    client.rpc("mode_health_ping").execute()


def _check_redis_sync() -> None:
    if not settings.redis_url:
        raise RuntimeError("redis_url_missing")
    import redis  # type: ignore[import-not-found]

    timeout_seconds = max(0.001, settings.chat_cache_timeout_ms / 1000)
    client = redis.Redis.from_url(
        str(settings.redis_url),
        socket_timeout=timeout_seconds,
        socket_connect_timeout=timeout_seconds,
    )
    client.ping()


def _check_queue_sync() -> None:
    if not settings.redis_url:
        raise RuntimeError("redis_url_missing")
    import redis  # type: ignore[import-not-found]
    from rq import Queue  # type: ignore[import-not-found]

    timeout_seconds = max(0.001, settings.chat_cache_timeout_ms / 1000)
    connection = redis.Redis.from_url(
        str(settings.redis_url),
        socket_timeout=timeout_seconds,
        socket_connect_timeout=timeout_seconds,
    )
    for queue_name in QUEUE_NAMES.values():
        Queue(queue_name, connection=connection)
    connection.ping()
