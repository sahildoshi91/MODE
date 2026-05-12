# Chat Pipeline Production Monitoring

## Rollout Window

Monitor the first 30 minutes after production deploy, then review the first 24 hours before disabling any legacy stream compatibility. Keep `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` during this window.

## Primary Log Signal

Every chat request should emit exactly one structured log event:

```json
{"event":"chat_trace", "...":"..."}
```

Required fields to inspect:

- `request_id`
- `trainer_id`
- `route`
- `router_confidence`
- `risk_flags`
- `cache_hit`
- `time_to_first_token_ms`
- `total_response_ms`
- `model_used`
- `fallback_used`
- `prompt_version`
- `model_fallback_chain`
- `tokens_cost_usd`
- `queue_enqueue_latency_ms`
- `escalation_triggered`
- `error_category`

Do not log or search raw user message content.

Each trace and worker completion also emits structured metric logs:

```json
{"event":"observation_metric","name":"chat.ttft_ms","value":42.0,"unit":"ms","tags":{"route":"FAST_PATH"}}
```

## SLO Watch

Use these thresholds as rollout alerts:

- Fast path first token: alert if p50 > 500ms or p99 > 1000ms.
- Deep path first token: alert if p50 > 1500ms or p99 > 3000ms.
- Fast total response: alert if p50 > 2000ms or p99 > 4000ms.
- Deep total response: alert if p50 > 5000ms or p99 > 8000ms.
- Any route: alert if `time_to_first_token_ms=-1` for more than isolated single-request failures.
- Any route: alert if `error_category` is non-null above 1 percent in a 10-minute window.
- Safety route: alert if `escalation_triggered=true` but no trainer review/system event row is created.
- Queue lag: warning if `worker.queue_lag_ms` p95 > 15s, critical if > 30s.
- Worker dead letters: warning if `worker.dead_letter_count` > 0, critical if > 5.
- Fallback rate: warning if `llm.fallback_rate` > 5 percent, critical if > 15 percent.
- Prompt injection rate: warning if `safety.injection_detected_rate` > 1 percent, critical if > 3 percent.

## Log Queries

Adapt these to the log platform in use.

Find all chat traces:

```text
"event\":\"chat_trace"
```

Find requests with no observed token:

```text
"event\":\"chat_trace" "time_to_first_token_ms\":-1
```

Find stream or provider errors:

```text
"event\":\"chat_trace" "error_category\":"
```

Find safety escalations:

```text
"event\":\"chat_trace" "SAFETY_ESCALATION"
```

Find fallback use:

```text
"event\":\"chat_trace" "fallback_used\":true
```

Find cache misses:

```text
"event\":\"chat_trace" "cache_hit\":false
```

Find observation metrics:

```text
"event\":\"observation_metric"
```

Find worker queue lag metrics:

```text
"event\":\"observation_metric" "worker.queue_lag_ms"
```

## Database Verification

Verify migration:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'conversations'
  AND column_name = 'metadata';
```

Verify recent safety escalation metadata:

```sql
SELECT id, trainer_id, client_id, metadata, updated_at
FROM public.conversations
WHERE metadata ->> 'trainer_review_pending' = 'true'
ORDER BY updated_at DESC
LIMIT 20;
```

Verify trainer notification events:

```sql
SELECT id, trainer_id, client_id, event_key, event_type, severity, visibility, status, created_at
FROM public.trainer_system_events
WHERE event_type = 'safety_escalation'
ORDER BY created_at DESC
LIMIT 20;
```

Verify queued trainer review items:

```sql
SELECT id, trainer_id, client_id, conversation_id, message_id, status, created_at
FROM public.unanswered_question_queue
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT 20;
```

Verify no global personalized cache keys exist by inspecting Redis keys. Expected personalized patterns include both trainer/client where applicable:

```text
mode:chat_ctx:{trainer_id}:{client_id}
mode:user_digest:{trainer_id}:{client_id}
mode:trainer_persona:{trainer_id}
mode:semantic:{trainer_id}:{query_hash}
```

## Manual Smoke

Run after deploy with a real staging or production test account:

1. Send: `great workout today`
   - Expected route: `FAST_PATH`.
   - Expected stream: status event before token event.
   - Expected trace: `time_to_first_token_ms` present and non-negative.

2. Send: `can we change my plan?`
   - Expected route: `DEEP_PATH`.
   - Expected behavior: bounded context, no full raw history dump.

3. Send: `my knee is really hurting`
   - Expected route: `SAFETY_ESCALATION`.
   - Expected response: calm holding guidance.
   - Expected DB: `trainer_review_pending=true`, `active_safety_flags` populated, `trainer_system_events.event_type='safety_escalation'`.

## Rollback Triggers

Rollback backend code or disable cache if any of these hold after initial triage:

- Uncaught chat 500s above 1 percent for 10 minutes.
- SSE streams hang without `done` or structured `error` events.
- `time_to_first_token_ms=-1` clusters across multiple users.
- Safety escalation does not create trainer review metadata/events.
- Cross-tenant query or cache-key issue is suspected.
- Redis issues correlate with latency or errors; first mitigation is `CHAT_CACHE_ENABLED=false`.

The database migration is additive. Do not drop `conversations.metadata` during rollback.

## Post-Rollout Decisions

After 24 hours:

- Keep Redis enabled only if cache failures remain non-blocking and SLOs improve or stay stable.
- Keep `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` until all active clients are confirmed to consume canonical `token/content`.
- Document actual p50/p99 values in the rollout ticket or update `docs/chat_slow_response_runbook.md` if targets need environment-specific notes.
