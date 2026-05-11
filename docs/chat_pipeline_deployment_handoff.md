# Chat Pipeline Deployment Handoff

## Scope

This handoff covers staging then production rollout for the streaming, routed, memory-aware chat pipeline. It assumes the code in this branch is deployed as-is and the migration is applied before traffic is sent through safety escalation paths.

## Required Migration

Apply this SQL in staging first:

```bash
backend/sql/20260511_add_conversation_metadata.sql
```

Then reload PostgREST schema cache if applicable:

```sql
NOTIFY pgrst, 'reload schema';
```

Validation query:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'conversations'
  AND column_name = 'metadata';
```

Expected result: one `metadata` column with `jsonb` type.

## Required Runtime Env

Set names only; values must come from the approved secret manager.

- `REDIS_URL`
- `CHAT_CACHE_ENABLED`
- `CHAT_CACHE_TIMEOUT_MS`
- `CHAT_ROUTER_TIMEOUT_MS`
- `CHAT_STREAM_LEGACY_ALIAS_ENABLED`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended first rollout values:

- `CHAT_CACHE_ENABLED=true` when Redis is available.
- `CHAT_CACHE_TIMEOUT_MS=25`.
- `CHAT_ROUTER_TIMEOUT_MS=200`.
- `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` until every deployed client handles canonical `token/content` events.
- Leave `TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED` at the current environment value; this deployment does not require changing that flag.

## Staging Apply Order

1. Apply `backend/sql/20260511_add_conversation_metadata.sql`.
2. Reload schema cache.
3. Set chat runtime env vars in staging.
4. Deploy backend.
5. Run route preflight:

```bash
cd backend
./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url https://<staging-api-host>
```

6. Run staging integration smoke:

```bash
cd backend
MODE_RUN_STAGING_SUPABASE_TESTS=1 ./venv/bin/pytest -q \
  tests/test_chat_api_staging_integration.py \
  tests/test_daily_checkin_staging_integration.py \
  tests/test_trainer_platform_staging_smoke.py
```

7. Exercise one real client chat in staging:
   - simple fast-path message such as "great workout today"
   - plan-change message such as "can we change my plan?"
   - safety message such as "my knee is really hurting"

8. Confirm logs contain one `chat_trace` event per chat request and include `time_to_first_token_ms`.
9. Confirm safety escalation creates trainer review state:
   - `conversations.metadata.trainer_review_pending=true`
   - `conversations.metadata.active_safety_flags` has at least one flag
   - a trainer-private `trainer_system_events` row with `event_type='safety_escalation'`

## Staging SLO Baseline

Collect at least 20 staging chat traces before production promotion.

Use these fields:

- `route`
- `model_used`
- `cache_hit`
- `time_to_first_token_ms`
- `total_response_ms`
- `fallback_used`
- `error_category`

Promotion criteria:

- No uncaught chat 500s.
- No broken SSE streams; failures emit structured `error` events.
- Fast-path mocked/local tests remain under 500ms first token.
- Staging external-provider p50/p99 gaps, if any, are documented in `docs/chat_slow_response_runbook.md` or the rollout ticket.

## Production Rollout

1. Apply the same migration to production.
2. Reload schema cache.
3. Set production env vars from the secret manager.
4. Deploy backend.
5. Run runtime route preflight against production:

```bash
cd backend
./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url https://<production-api-host>
```

6. Watch `chat_trace` logs for the first 30 minutes.
7. Keep `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` until client adoption is verified.

Use `docs/chat_pipeline_production_monitoring.md` for log queries, SQL verification snippets, alert thresholds, manual smoke checks, and rollback triggers.

## Rollback

Backend rollback is safe because the migration is additive. If runtime issues appear:

1. Roll backend code back to the previous release.
2. Keep `conversations.metadata`; do not drop it during incident response.
3. Set `CHAT_CACHE_ENABLED=false` if Redis/cache behavior is suspected.
4. Keep SSE error handling enabled; do not route clients back to broken-pipe behavior.

## Sign-Off Checklist

- [ ] Migration applied in staging.
- [ ] Staging env vars set.
- [ ] Runtime route preflight passed in staging.
- [ ] Staging integration smoke passed.
- [ ] Staging chat traces captured with `time_to_first_token_ms`.
- [ ] Safety escalation row verified in `trainer_system_events`.
- [ ] Production migration applied.
- [ ] Production env vars set.
- [ ] Runtime route preflight passed in production.
- [ ] First 30 minutes of production `chat_trace` logs reviewed.
