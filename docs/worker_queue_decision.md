# Worker Queue Decision

## Decision
Use RQ on Redis for Phase A.

## Why
- Discovery found no existing queue system in the backend: no Celery, RQ, ARQ, TaskIQ, Dramatiq, Huey, worker entrypoint, or queue config.
- Redis already exists in the stack through `REDIS_URL` and `backend/app/modules/conversation/cache.py`.
- RQ is the lightest durable option compatible with the current synchronous FastAPI/Supabase code. It avoids new infrastructure while adding retry, queue isolation, process-independent workers, and queue lag visibility.

## Queues
- High: `mode:intelligence:high`
- Normal: `mode:intelligence:normal`
- Low: `mode:intelligence:low`

## Job Contract
Every queued job validates against `IntelligenceJob`:

- `job_id`
- `job_type`
- `trainer_id`
- `client_id`
- `conversation_id`
- `payload`
- `enqueued_at`
- `trace_id`

## Retry Policy
- `memory_write`: normal priority, 3 max attempts
- `cache_invalidate`: high priority, 5 max attempts
- `chat_trace_log_emit`: low priority, 3 max attempts
- `trainer_escalation_notification`: high priority, 5 max attempts
- `conversation_summarization`: low priority, 2 max attempts
- `safety_flag_persistence`: high priority, 5 max attempts

## Idempotency
- `job_id` is the primary idempotency key in `public.intelligence_jobs`.
- Workers skip jobs already marked `success`.
- Memory writes use deterministic `memory_key` upsert behavior for duplicate execution safety.
- Trainer-review jobs dedupe by `trainer_id`, `client_id`, `conversation_id`, and `message_id` when a message ID is available.
- Safety escalation trainer events use a deterministic `event_key`.

## Failure Behavior
- Enqueue failure is logged and does not fail chat.
- Worker final failures emit `worker_job_trace` with status `failed`.
- Safety flag and trainer escalation final failures log high-severity events.
- Cache invalidation final failure forces chat context and digest keys to a 5 second TTL when Redis is reachable.

## How To Run
From `backend/`:

```bash
python -m app.workers.intelligence_worker
```

Render starts the worker with the same command in `render.yaml`.
Set `INTELLIGENCE_WORKER_CONCURRENCY` to run multiple RQ worker processes in one worker service.
Staging uses `4` so burst tests can drain post-chat jobs without a long single-worker backlog.

## How To Monitor
Queue lag:

```sql
SELECT
  job_type,
  status,
  EXTRACT(EPOCH FROM (now() - MIN(enqueued_at))) * 1000 AS oldest_lag_ms,
  COUNT(*) AS job_count
FROM public.intelligence_jobs
WHERE status IN ('queued', 'retry')
GROUP BY job_type, status
ORDER BY oldest_lag_ms DESC;
```

Dead/final failures:

```sql
SELECT job_type, last_error_category, COUNT(*)
FROM public.intelligence_jobs
WHERE status = 'failed'
GROUP BY job_type, last_error_category
ORDER BY COUNT(*) DESC;
```

Worker traces:

```sql
SELECT job_type, status, attempt_number, duration_ms, completed_at
FROM public.worker_job_traces
ORDER BY completed_at DESC
LIMIT 50;
```

## New Env Vars
- `REDIS_URL`

`REDIS_URL` was already present in backend settings. It is now required for production worker queue durability.
