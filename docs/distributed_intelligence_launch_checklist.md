# Distributed Intelligence CTO Go/No-Go Checklist

## Must Be YES To Launch
- [ ] TTFT p95 < 2.5s under load test.
- [ ] Zero cross-tenant data leaks in RLS test suite.
- [ ] Worker jobs are durable and survive process restart.
- [ ] LLM fallback tested and verified.
- [ ] Rate limits active.
- [ ] No raw sensitive data in logs after audit.
- [ ] `/healthz` operational.
- [ ] Rollback plan documented and tested in staging.

## Should Be YES, Or Launch With Documented Risk
- [ ] Queue lag p95 < 30s.
- [ ] All required indexes added.
- [ ] Cost tracking per trainer active.
- [ ] Prompt templates versioned.

## Deferred Post-Launch
- Semantic caching, blocked on a proven vector-retrieval need.
- pgvector or embedding infrastructure.
- Kubernetes or auto-scaling changes.
- Multi-region deployment.

## Phase A Status
- [x] Queue system choice documented: RQ on Redis.
- [x] Worker entrypoint exists independently of FastAPI.
- [x] Post-chat memory writes route through the worker queue.
- [x] Trainer review queueing routes through the worker queue.
- [x] Safety flag persistence routes through the worker queue.
- [x] ChatTrace log emission routes through the worker queue with inline fallback when Redis is unavailable.
- [x] Cache invalidation job exists with high-priority retry behavior.
- [x] Job visibility tables and worker trace tables are defined in migration SQL.
- [ ] Staging Redis/worker process restart durability test completed.
- [ ] Queue lag load test completed.

## Phase B Status
- [x] Required conversation/message/job indexes exist in staging.
- [x] Message history loads are bounded and newest-first at the DB query level.
- [x] Chat-session append fallback no longer loads 500 rows to calculate `message_index`.
- [x] Key user-facing tables have RLS enabled and forced in staging.
- [x] EXPLAIN audit script exists and has been run against sparse staging.
- [ ] Cross-tenant RLS runtime test completed with seeded tenant A/B rows.
- [ ] Production-like EXPLAIN ANALYZE captured with representative row counts.
- [ ] Direct Postgres connection pool configured, if/when runtime moves away from Supabase/PostgREST.

## Phase C Status
- [x] Fast path routes to the cheap model tier.
- [x] Deep path and safety paths route to the full model tier.
- [x] Context-slot token budgets are enforced at prompt build time with truncation warnings.
- [x] Provider fallback chain records attempted models and estimated token cost in trace metadata.
- [x] Primary timeout fallback is covered by tests.
- [x] All-provider failure returns a controlled `ConversationProcessingError`.
- [x] Prompt templates are versioned in files and prompt version is logged in trace/debug metadata.
- [x] Worker memory writes validate extracted data with `MemoryExtract` before writing.
- [ ] Streaming mid-response provider failure fallback tested with live providers.

## Phase D Status
- [x] ChatTrace includes worker job ID, prompt version, model fallback chain, estimated token cost, and queue enqueue latency fields.
- [x] ChatTrace emits observation metrics for TTFT, total latency, token usage, cost, fallback rate, cache miss rate, LLM error rate, and safety rates.
- [x] WorkerJobTrace emits observation metrics for job success, retry, dead-letter count, and queue lag.
- [x] Router latency metric is emitted for each routed chat request.
- [x] `/healthz` returns structured DB, Redis, and worker queue check status.
- [x] Alert thresholds are configured in `app.modules.observability.metrics.ALERT_THRESHOLDS`.
- [ ] Staging observability backend dashboards/alerts wired to the structured `observation_metric` log stream.

## Phase E Status
- [x] LLM output validation redacts schema/tenant leakage, prompt reflection, SQL-like output, and echoed trainer/client IDs.
- [x] Output validation is applied before chat replies are streamed, persisted, or returned.
- [x] Raw chat messages and raw assistant output are excluded from chat exception/validation logs.
- [x] Required chat/client/trainer/IP rate-limit scopes are active in middleware-level enforcement.
- [x] Trainer assignment and trainer context lookup use request-scoped Supabase clients.
- [x] Redis-backed production rate limiter replaces request-time service-role/Postgres RPC limiting.
- [x] Static API-handler audit blocks new direct service-role usage.
- [x] Private storage signed URL service-role usage accepted as a bounded launch exception with app-level path authorization.
- [x] Dependency-level privileged repository factories converted to request-scoped defaults, with privileged constructors limited to explicitly internal factories.
- [x] Account deletion request path queues durable worker execution and returns `202`.
- [ ] Service-role retirement migration applied and verified in staging.

## Launch Gate/Staging Verification Status
- [x] Launch migration apply helper added: `npm run launch:apply-migrations`.
- [x] Launch migration apply helper includes app-owned storage/security prerequisites before `20260511f` and skips hosted-Supabase-owned `storage.*` DDL.
- [x] Launch verification runner added: `npm run launch:verify`.
- [x] SQL validation blocks malformed JSONB casts like `DEFAULT '{}':a:jsonb`.
- [ ] Service-role retirement migration applied successfully in staging.
- [ ] Staging `/healthz` returns `ok=true` with p95 < 100ms.
- [ ] Runtime route surface preflight passes against staging.
- [ ] Staging DB security check passes.
- [ ] Authenticated chat stream smoke emits `token` and `done`.
- [ ] Storage signed URL smoke passes for an allowed own path.
- [ ] Account deletion enqueue smoke passes for a sacrificial account.
- [ ] 50-concurrent TTFT load probe records p95 < 2.5s.
- [ ] Queue lag p95 < 30s under burst load.
- [ ] Rollback exercise completed in staging.
