# Slow Chat Response Runbook

## Primary Signal
Search backend logs for structured events with `"event":"chat_trace"`.

Important fields:
- `time_to_first_token_ms`: request receipt to first non-empty canonical `token` event. Status events are excluded.
- `total_response_ms`: full chat response duration.
- `route`: `FAST_PATH`, `DEEP_PATH`, `SAFETY_ESCALATION`, or a fallback route label.
- `model_used`: provider model used for the answer.
- `prompt_version`: prompt template bundle used for the request.
- `model_fallback_chain`: ordered provider/model attempts for the request.
- `tokens_cost_usd`: estimated request cost when provider usage is available.
- `cache_hit`: whether digest/persona context used Redis.
- `retrieval_latency_ms`: retrieval timing when available.
- `error_category`: populated for failed/no-token streams.
- `worker_job_id`: optional link to the Intelligence Lane job when emitted by the request path.
- `queue_enqueue_latency_ms`: enqueue timing when present.

Worker signal:
- Search backend worker logs for structured events with `"event":"worker_job_trace"`.
- Important fields: `job_id`, `job_type`, `trace_id`, `status`, `attempt_number`, `duration_ms`, `error_category`, `completed_at`.
- Use `trace_id` to connect worker jobs back to the parent `chat_trace.request_id`.

Metric signal:
- Search backend logs for `"event":"observation_metric"`.
- Key metric names: `chat.ttft_ms`, `chat.total_ms`, `router.latency_ms`, `db.query_latency_ms`, `worker.queue_lag_ms`, `worker.job_success_rate`, `worker.retry_rate`, `worker.dead_letter_count`, `llm.tokens_in`, `llm.tokens_out`, `llm.cost_usd`, `llm.fallback_rate`, `llm.error_rate`, `db.error_rate`, `cache.miss_rate`, `safety.escalation_rate`, `safety.injection_detected_rate`, `safety.trainer_review_pending_count`.

## SLO Targets
- App open / context preload: p50 < 200ms, p99 < 400ms.
- Intent router: p50 < 100ms, p99 < 200ms.
- Cache lookup: p50 < 10ms, p99 < 25ms.
- Memory retrieval: p50 < 100ms, p99 < 200ms.
- Fast path `time_to_first_token_ms`: p50 < 500ms, p99 < 1s.
- Deep path `time_to_first_token_ms`: p50 < 1.5s, p99 < 3s.
- Total fast response: p50 < 2s, p99 < 4s.
- Total deep response: p50 < 5s, p99 < 8s.

Current local verification uses mocked providers and asserts fast-path first token under 500ms. Real external-provider p50/p99 baselines must be collected from staging `chat_trace` logs before production SLO sign-off.

## Current Staging Baseline Notes

May 11, 2026 Render free-tier staging baseline against `https://mode-backend-staging.onrender.com`:

- Supabase auth alignment was fixed; hosted chat no longer returned `401 Invalid or expired session`.
- One-request probe succeeded with request ID `c45fa528-7cbe-4e23-a14c-8130a7e76d6b` and client-observed `time_to_first_token_ms=5859`.
- Full run completed 18/21 hosted streams before Render returned platform `502 Bad Gateway` with `x-render-routing: no-deploy` for the final two baseline requests and the safety check.
- Successful hosted streams had client-observed TTFT p50 `6025ms`, p95 `7620ms`, p99 `7620ms`, max `7620ms`.
- Successful hosted streams had total response p50 `7665ms`, p95 `48215ms`, p99 `48215ms`, max `48215ms`.
- Safety escalation verification did not pass because the safety request received Render 502 before the application could stream or persist review state.

This is not production-promotion ready. Next triage step is Render deploy/runtime log review for the 502/no-deploy state, then rerun the full baseline until all 20 non-safety streams plus the safety stream complete and emit `chat_trace` with `time_to_first_token_ms`.

## Triage
- If `time_to_first_token_ms` is `-1`, the chat path never emitted or observed a token. Check `error_category`, provider errors, and whether the route hit the prompt-injection guard.
- If `time_to_first_token_ms` exceeds the route target, compare `route`, `model_used`, `fallback_used`, and `cache_hit` before changing code. Slow first token with `cache_hit=false` usually points to context rebuild or provider latency.
- If `cache_hit=false` and total latency is high, verify Redis health and `REDIS_URL`.
- If `route=SAFETY_ESCALATION`, higher latency can be expected because trainer review tagging and safe response handling are active.
- If `model_used` is a fallback model, inspect provider availability and API key configuration.
- If `model_fallback_chain` contains more than one model, compare the first failure reason to provider logs before tuning routing.
- If `tokens_cost_usd` spikes for a trainer, check whether fast-path traffic is being routed to deep-path/full-model flows.
- If `prompt_version` is unexpected, verify the route flow and prompt template mapping in `backend/app/modules/conversation/orchestration.py`.
- If `total_response_ms` is high but `time_to_first_token_ms` is healthy, the user saw streaming quickly; investigate provider completion length or client rendering.
- If chat is fast but trainer review, memory, or cache changes are delayed, inspect the Intelligence Lane queue rather than the SSE path.
- If `worker.queue_lag_ms` or the oldest queued job exceeds 30s, confirm the worker process is running and connected to the same `REDIS_URL` as the web service.
- If `cache_invalidate` jobs fail repeatedly, verify Redis health. On final failure the worker attempts to force affected chat context keys to a 5 second TTL.

## Queue Debugging

Oldest queued or retrying jobs:

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

Recent worker failures:

```sql
SELECT job_id, job_type, attempt_count, last_error_category, updated_at
FROM public.intelligence_jobs
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 50;
```

Trace a request into the worker lane:

```sql
SELECT job_id, job_type, status, attempt_count, queue_name, enqueued_at, completed_at
FROM public.intelligence_jobs
WHERE trace_id = '<chat_trace.request_id>'
ORDER BY enqueued_at;
```

## Commands
- Backend health: `npm run backend:check`
- Prompt-close check: `npm run codex:check`
- Worker process: `cd backend && python -m app.workers.intelligence_worker`
- Focused tests: `./backend/venv/bin/pytest -q backend/tests/test_observability_phase_d.py backend/tests/test_llm_orchestration.py backend/tests/test_chat_api.py backend/tests/test_chat_sessions_api.py backend/tests/test_chat_pipeline_primitives.py`
