# Distributed Intelligence Load Test Plan

## Scope
This plan verifies the launch gates for the four-lane architecture after Phase A lands.

## Prerequisites
- Staging web service deployed with `REDIS_URL`.
- Staging intelligence worker deployed and running.
- Launch migrations applied with `npm run launch:apply-migrations`.
- Storage lifecycle prerequisite `20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql` applied before `20260511f_retire_service_role_request_paths.sql`.
- Hosted Supabase storage signed URL service-role exception accepted and documented; do not run direct `storage.*` policy DDL as part of the launch gate.
- Test trainer/client accounts provisioned.
- Provider API keys configured for the staging environment.
- Prompt templates deployed from `backend/prompts/**/v1.txt`.

## Tests

### TTFT
- Run 50 concurrent `/api/v1/chat/stream` users across mixed trainers and clients.
- Collect `chat_trace.time_to_first_token_ms`.
- Pass target: p95 < 2.5s.
- Helper command:
  `npm run launch:verify -- --base-url <staging-url> --auth-token-file ./staging_tokens.txt --chat-load-requests 50 --chat-load-concurrency 50`

### Full Stream
- Deploy staging with `USE_FAKE_PROVIDER=false`, one uvicorn worker, and `MAX_ACTIVE_CHAT_STREAMS_PER_INSTANCE=25`.
- Run one full-stream wave at concurrency 10, 25, and 26 using `--full-stream`.
- Capture TTFT p50/p95/p99, total stream p50/p95/p99, error rate, and semaphore 429 count.
- Pass targets: 10 concurrent p95 TTFT < 2000ms with 0 errors; 25 concurrent p95 TTFT < 3000ms with error rate < 2%; 26 concurrent returns at least one HTTP 429.

### Standard API
- Run 50 concurrent requests against non-streaming chat/session endpoints.
- Pass target: p95 < 500ms.

### Health
- Probe `/healthz` once per second for 5 minutes.
- Pass target: p95 < 100ms.

### Queue Lag
- Send a burst of chat requests that produce memory and trainer-review jobs.
- Query `public.intelligence_jobs` lag for `queued` and `retry` statuses.
- Pass target: p95 < 30s.

### LLM Fallback
- Run a chaos pass with the primary provider disabled or forced to timeout.
- Confirm `chat_trace.fallback_used=true`, `model_fallback_chain` records the attempted models, and the user receives a controlled response.
- Pass target: fallback path succeeds for non-safety routes; safety escalation does not retry on a degraded model.

### Worker Restart Durability
1. Enqueue safety escalation and memory write jobs.
2. Stop the worker before completion.
3. Start the worker.
4. Confirm jobs complete or retry from Redis.

### RLS Under Mixed Tenants
- Run cross-tenant read attempts while load is active.
- Pass target: zero cross-tenant rows.

### Rate Limits
- Exceed chat per-client, trainer aggregate, and IP thresholds.
- Pass target: expected `429` responses without LLM calls.

## Current Results
Not yet run after service-role retirement and accepted storage exception. The previous May 11, 2026 staging baseline in `docs/chat_slow_response_runbook.md` was collected before the worker queue migration and did not satisfy production launch gates.

Smoke and load helper docs now live in `docs/distributed_intelligence_launch_gate_staging_verification.md`.

## Result Template
- Date:
- Commit:
- Environment:
- TTFT p95:
- Standard API p95:
- `/healthz` p95:
- Queue lag p95:
- LLM fallback result:
- Worker restart durability:
- RLS mixed-tenant result:
- Rate-limit result:
- Notes:
