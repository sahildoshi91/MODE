from __future__ import annotations

import logging

from app.core.config import settings
from app.modules.intelligence_jobs.queue import QUEUE_NAMES


logger = logging.getLogger(__name__)


def main() -> None:
    if not settings.redis_url:
        raise RuntimeError("REDIS_URL is required to start the intelligence worker.")
    try:
        import redis  # type: ignore[import-not-found]
        from rq import Worker  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("RQ is required. Install backend requirements before starting the worker.") from exc

    logging.basicConfig(level=logging.INFO)
    timeout_seconds = max(0.001, settings.chat_cache_timeout_ms / 1000)
    connection = redis.Redis.from_url(
        str(settings.redis_url),
        socket_timeout=timeout_seconds,
        socket_connect_timeout=timeout_seconds,
    )
    queue_names = [
        QUEUE_NAMES["high"],
        QUEUE_NAMES["normal"],
        QUEUE_NAMES["low"],
    ]
    logger.info("starting_intelligence_worker queues=%s", ",".join(queue_names))
    worker = Worker(queue_names, connection=connection)
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
