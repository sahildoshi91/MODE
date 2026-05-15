from __future__ import annotations

import logging
from multiprocessing import Process
from typing import NoReturn

from app.core.config import settings
from app.modules.intelligence_jobs.queue import QUEUE_NAMES


logger = logging.getLogger(__name__)


def _run_worker(worker_index: int, *, with_scheduler: bool) -> NoReturn:
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
    logger.info(
        "starting_intelligence_worker worker_index=%s with_scheduler=%s queues=%s",
        worker_index,
        with_scheduler,
        ",".join(queue_names),
    )
    worker = Worker(queue_names, connection=connection)
    worker.work(with_scheduler=with_scheduler)
    raise SystemExit(0)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    concurrency = max(1, int(settings.intelligence_worker_concurrency))
    if concurrency == 1:
        _run_worker(0, with_scheduler=True)

    logger.info("starting_intelligence_worker_pool concurrency=%s", concurrency)
    processes = [
        Process(target=_run_worker, args=(worker_index,), kwargs={"with_scheduler": worker_index == 0})
        for worker_index in range(concurrency)
    ]
    for process in processes:
        process.start()

    exit_code = 0
    try:
        for process in processes:
            process.join()
            if process.exitcode not in (0, None):
                exit_code = process.exitcode or 1
    except KeyboardInterrupt:
        logger.info("stopping_intelligence_worker_pool")
        for process in processes:
            if process.is_alive():
                process.terminate()
        for process in processes:
            process.join(timeout=10)
        raise

    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
