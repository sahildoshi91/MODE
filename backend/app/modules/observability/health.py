from __future__ import annotations

import asyncio
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

from app.core.config import settings
from app.db.client import get_supabase_public_client
from app.modules.intelligence_jobs.queue import QUEUE_NAMES
from app.modules.observability.metrics import emit_db_query_metric, emit_metric


HEALTH_TIMEOUT_MS = 70


@dataclass(frozen=True)
class HealthCheckResult:
    status: str
    latency_ms: int
    error_category: str | None = None


async def build_healthz_payload(*, timeout_ms: int = HEALTH_TIMEOUT_MS) -> dict[str, Any]:
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
        "duration_ms": duration_ms,
        "checks": {
            "db": asdict(db),
            "redis": asdict(redis),
            "queue": asdict(queue),
        },
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
    (
        client
        .table("trainers")
        .select("id")
        .limit(1)
        .execute()
    )


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
