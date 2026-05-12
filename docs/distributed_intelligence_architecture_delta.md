# Distributed Intelligence Architecture Delta

## Phase
Phases A-E: Worker Queue Migration, Database Hardening, LLM Orchestration, Observability Expansion, and Security Hardening.

## What Changed From v1/v2
- Post-chat intelligence work no longer depends on FastAPI request-lifecycle side effects as the production path.
- Memory writes, trainer review queueing, safety flag persistence, cache invalidation, and ChatTrace log emission now use an `IntelligenceJob` payload contract and RQ-backed queues.
- A standalone worker entrypoint runs the Intelligence Lane outside the FastAPI web process: `python -m app.workers.intelligence_worker`.
- Job visibility is persisted in `public.intelligence_jobs`; worker completion emits `worker_job_trace` logs and writes `public.worker_job_traces`.
- ChatTrace has been extended with Phase-D-compatible fields for worker job linkage, prompt version, model fallback chain, token cost, and queue enqueue latency.
- Render now defines a separate worker service alongside the existing web service.
- Phase B added tenant-scoped indexes, bounded message-history loading, and live RLS/index audit tooling.
- Phase C adds prompt template files, enforced context-slot token budgets, model routing tiers, provider fallback metadata, prompt-version tracing, estimated token cost tracing, and validated memory extracts before durable worker writes.
- Phase D adds structured observation metrics emitted from ChatTrace and WorkerJobTrace, router latency metrics, DB health latency metrics, alert threshold configuration, and a structured `/healthz` response for DB/Redis/queue checks.
- Phase E adds LLM output validation/redaction on chat reply paths, Redis-backed multi-scope chat/IP rate limits, request-scoped trainer assignment/context/account-deletion paths, async account deletion via worker job, and a strict service-role request-path audit with one bounded private-storage signed URL exception.

## Files Added
- `backend/app/modules/intelligence_jobs/__init__.py`
- `backend/app/modules/intelligence_jobs/schemas.py`
- `backend/app/modules/intelligence_jobs/queue.py`
- `backend/app/modules/intelligence_jobs/repository.py`
- `backend/app/modules/intelligence_jobs/handlers.py`
- `backend/app/workers/__init__.py`
- `backend/app/workers/intelligence_worker.py`
- `backend/app/modules/conversation/orchestration.py`
- `backend/app/modules/observability/__init__.py`
- `backend/app/modules/observability/metrics.py`
- `backend/app/modules/observability/health.py`
- `backend/prompts/system/v1.txt`
- `backend/prompts/trainer_persona/v1.txt`
- `backend/prompts/safety/v1.txt`
- `backend/sql/20260511b_create_intelligence_jobs.sql`
- `backend/sql/20260511c_database_hardening_indexes.sql`
- `backend/sql/20260511d_verify_data_fortress_phase_b.sql`
- `backend/sql/20260511e_drop_redundant_conversation_message_index.sql`
- `backend/sql/20260511f_retire_service_role_request_paths.sql`
- `backend/scripts/phase_b_database_audit.py`
- `backend/scripts/apply_phase_b_migrations.py`
- `backend/tests/test_database_hardening_static.py`
- `backend/tests/test_intelligence_queue.py`
- `backend/tests/test_llm_orchestration.py`
- `backend/tests/test_observability_phase_d.py`
- `backend/tests/test_security_phase_e.py`
- `docs/database_hardening_phase_b.md`
- `docs/security_hardening_phase_e.md`
- `docs/worker_queue_decision.md`
- `docs/distributed_intelligence_architecture_delta.md`
- `docs/distributed_intelligence_launch_checklist.md`
- `docs/distributed_intelligence_load_test_plan.md`

## Files Modified
- `backend/requirements.txt`
- `backend/app/api/v1/chat.py`
- `backend/app/api/v1/chat_sessions.py`
- `backend/app/api/v1/trainer_assignment.py`
- `backend/app/modules/conversation/cache.py`
- `backend/app/modules/conversation/context.py`
- `backend/app/modules/conversation/repository.py`
- `backend/app/modules/conversation/routing.py`
- `backend/app/modules/conversation/schemas.py`
- `backend/app/modules/conversation/service.py`
- `backend/app/modules/conversation/trace.py`
- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/dependencies.py`
- `backend/app/core/rate_limit.py`
- `backend/app/core/auth.py`
- `backend/app/modules/chat_sessions/repository.py`
- `backend/app/modules/account_deletion/repository.py`
- `backend/app/api/v1/account.py`
- `backend/app/api/v1/storage_private.py`
- `backend/app/modules/intelligence_jobs/handlers.py`
- `backend/app/modules/intelligence_jobs/schemas.py`
- `backend/app/modules/intelligence_jobs/queue.py`
- `backend/tests/test_conversation_router.py`
- `render.yaml`
- `docs/chat_slow_response_runbook.md`

## New Env Vars
- `REDIS_URL`
- `HEALTH_CHECK_TIMEOUT_MS`
- `HEALTH_CACHE_TTL_SECONDS`
- `HEALTH_STALE_AFTER_SECONDS`
- `RATE_LIMIT_CHAT_CLIENT_PER_WINDOW`
- `RATE_LIMIT_CHAT_TRAINER_PER_WINDOW`
- `RATE_LIMIT_CHAT_IP_PER_WINDOW`
- `RATE_LIMIT_IP_PER_WINDOW`

`REDIS_URL` already existed in app settings for the Redis read-through cache; Phase A makes it required for production worker queue durability.
The health variables tune cached dependency probes so `/healthz` can stay fast while still reporting DB, Redis, and queue status.
The rate-limit variables have safe defaults in code and allow staging/production overrides without code changes. Production release gates now require `RATE_LIMIT_BACKEND=redis` with `REDIS_URL`.

## Migration Steps
1. Apply launch migrations with `MODE_SECURITY_DATABASE_URL='postgres://...' npm run launch:apply-migrations`.
2. Confirm the helper applies `20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql` before `20260511f_retire_service_role_request_paths.sql` and skips hosted-Supabase-owned `storage.*` policy DDL.
3. Run `NOTIFY pgrst, 'reload schema';` if PostgREST schema cache is active.
4. Configure `REDIS_URL` on the web service and worker service.
5. Deploy the web service and the worker service together.
6. Confirm `/healthz` for the web process, then confirm worker logs include `starting_intelligence_worker`.

## Rollback
1. Stop the worker service.
2. Revert the application deployment to the previous release.
3. Optional database rollback:
   - Drop policies and table added in `backend/sql/20260511f_retire_service_role_request_paths.sql` using the rollback block comments in that file.
   - `DROP TABLE IF EXISTS public.worker_job_traces;`
   - `DROP TABLE IF EXISTS public.intelligence_jobs;`

## Deferred To Later Phases
- Phase B added Data Fortress indexes, bounded history query guards, and live sparse-staging RLS/index audit tooling. Representative cross-tenant runtime tests still need seeded tenant A/B data.
- Phase C implemented model routing, token-budget enforcement, fallback-chain tests, prompt template versioning, prompt-version trace logging, and structured memory extract validation.
- Phase D implemented observation metrics, alert thresholds, worker/job metric expansion, router latency capture, DB health latency capture, and structured `/healthz`.
- Phase E added streaming LLM output validation, sensitive log redaction helpers, Redis request rate limiting, request-scoped account/auth/dependency defaults, async account deletion, and strict service-role request-path audit tests. Private storage signed URL issuance remains a documented launch exception until a Supabase-supported storage policy owner workflow is available. Launch Gate/Staging Verification remains gated by applying the service-role retirement migration and running staging smoke coverage.
