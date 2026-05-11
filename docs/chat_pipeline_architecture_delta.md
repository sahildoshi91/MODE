# Chat Pipeline Architecture Delta

## Before
- Chat routes could answer through blocking completion paths even when SSE was used.
- Prompt context mixed profile, client context, orchestration output, and recent messages without a shared digest object.
- Routing used heuristic provider selection only; there was no explicit FAST/DEEP/SAFETY route object.
- Stream deltas used the legacy `message_delta/delta` event shape.
- Cache support was limited to unrelated in-memory workout caching.

## After
- Chat emits canonical SSE `token/content` events, with temporary `message_delta/delta` aliases for older clients.
- Deterministic SENTRY routing runs before the main model path and records `FAST_PATH`, `DEEP_PATH`, or `SAFETY_ESCALATION`. The optional LLM classifier remains deferred.
- Context is assembled through a bounded digest/persona/memory/recent-chat package. Recent chat is hard-limited to 10 messages, equivalent to 5 turns.
- Prompt injection patterns are detected and return a calm guardrail response without calling the LLM.
- Redis read-through cache helpers are available for digest/persona/chat context keys. Cache failures fail open to Supabase rebuilds.
- Safety escalation skips the main LLM path, streams a safe holding response from the system path, queues trainer review, emits a trainer-private `trainer_system_events` notification, tags conversations with `trainer_review_pending` plus `active_safety_flags`, and invalidates chat context caches immediately.
- Pre-token SSE breadcrumbs are now sourced from the deterministic route result when a route is available, with generic fallback copy only for legacy/non-chat paths.
- Session stream memory side effects run after the `done` SSE event is yielded, so memory persistence cannot block token streaming.
- Every chat response path records one structured `chat_trace` log event. `time_to_first_token_ms` measures request receipt to first non-empty canonical `token` event and excludes status breadcrumbs; for the legacy non-streaming path, the full assistant response is observed as the first token-equivalent event.
- Timeout and partial-failure paths now degrade predictably: router failure falls back to `DEEP_PATH`, streaming Postgres timeouts emit a minimal safe response, LLM creation retries use the configured retry budget, memory writes retry once, and mid-stream LLM failures emit structured SSE errors.
- Cache invalidation now fires from client check-ins, logged workouts, client profile/why/memory edits, trainer client memory edits, trainer persona mutations, and trainer queue approvals that affect a client or plan/persona context.

## Files Added
- `backend/app/modules/conversation/intent.py`
- `backend/app/modules/conversation/context.py`
- `backend/app/modules/conversation/cache.py`
- `backend/app/modules/conversation/security.py`
- `backend/app/modules/conversation/memory.py`
- `backend/app/modules/conversation/trace.py`
- `backend/sql/20260511_add_conversation_metadata.sql`
- `backend/tests/test_chat_pipeline_primitives.py`

## Interface Changes
- This blocker-fix pass adds no new external API routes, env vars, or database migrations.
- Existing chat pipeline env vars: `REDIS_URL`, `CHAT_CACHE_ENABLED`, `CHAT_CACHE_TIMEOUT_MS`, `CHAT_ROUTER_TIMEOUT_MS`, `CHAT_STREAM_LEGACY_ALIAS_ENABLED`.
- New canonical SSE token shape: `event: token`, `data: {"type":"token","content":"..."}`.
- Temporary legacy alias remains: `event: message_delta`, `data: {"type":"message_delta","delta":"...","legacy_alias":true}`.
- New SQL migration adds `conversations.metadata` for safety review state.

## Migration Steps
1. Apply `backend/sql/20260511_add_conversation_metadata.sql`.
2. Configure `REDIS_URL` for production chat caches.
3. Keep `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` until deployed clients all support canonical `token` events.

## TODOs
- Phase 8 semantic response caching remains disabled. The current trainer intelligence path has `embedding_status` metadata, but no pgvector/vector column, vector index, embedding writer, or vector similarity RPC; retrieval is currently a bounded weighted heuristic over `trainer_knowledge_entries` and client memory. Prerequisite to unblock: add a tenant-scoped vector store/retrieval RPC plus embedding generation, then cache only eligible generic responses behind `mode:semantic:{trainer_id}:{sha256(normalized_query)}`.
- Provider streaming usage tokens are zero for providers that do not return streaming usage; traces still capture timing and route/model.
- Optional LLM-backed SENTRY classification is intentionally not implemented in this pass; deterministic routing keeps the current runtime predictable until a provider-backed classifier can be benchmarked.
- Unit tests verify mocked fast-path timing and stream ordering. Real external-provider first-token SLOs require staging trace baselines before production sign-off.
