# Chat Pipeline Final Deliverables

DISCOVERY REPORT
================
Chat route(s): `backend/app/api/v1/chat.py` POST `/api/v1/chat` lines 134-195, GET `/api/v1/chat/history` lines 197-247, GET `/api/v1/chat/requests/{request_id}/events` lines 249-304, POST `/api/v1/chat/stream` lines 307-448; `backend/app/api/v1/chat_sessions.py` POST `/api/v1/chat/sessions/today` lines 141-168, list/continue/session detail lines 171-235 and 449-470, POST `/messages` lines 236-265, POST `/messages/stream` lines 267-446.

AI call(s): OpenAI via `OpenAIClient.create_chat_completion_with_usage` and `OpenAIClient.stream_chat_completion` in `backend/app/ai/client.py` lines 89-127, used by `ConversationService._execute_with_provider` and stream branches in `backend/app/modules/conversation/service.py` lines 1186-1195 and 2504-2568; Gemini via `GeminiClient.create_chat_completion` and `GeminiClient.stream_chat_completion` in `backend/app/ai/client.py` lines 222-264, used in `ConversationService` lines 1164-1178 and 2646-2701; Anthropic via `AnthropicClient.create_chat_completion` and `AnthropicClient.stream_chat_completion` in `backend/app/ai/client.py` lines 163-205, used in `ConversationService` lines 1198-1205 and 2435-2501. Streaming: yes for provider stream paths and SSE endpoints. Safety escalation uses system holding response `safety-escalation-hold`, no LLM call.

Auth layer: `backend/app/core/auth.py` bearer-token Supabase auth lines 68-99; `backend/app/core/dependencies.py` resolves trainer/client tenancy context lines 117-120; `backend/app/api/v1/trainer_auth.py` enforces client or trainer actor ownership lines 16-62.

Supabase usage: Conversation tables `conversations`, `conversation_messages`, `conversation_usage_events`, `conversation_usage_summary`, `conversation_ai_requests`, `conversation_ai_request_events`, `trainer_system_events`, and `coach_memory` in `backend/app/modules/conversation/repository.py`; chat session tables `chat_sessions`, `chat_messages`, `clients`, `trainers`, `user_accounts`, `client_trainer_connection_requests`, `user_fitness_profiles`, `daily_checkins`, `coach_memory`, and `workouts` in `backend/app/modules/chat_sessions/repository.py`. RLS enabled: yes for the chat/conversation/memory/session tables in `backend/sql/20260321_supabase_full_setup.sql`, `backend/sql/20260419_add_chat_request_events_and_idempotency.sql`, `backend/sql/20260418d_create_trainer_coach_workspace_primitives.sql`, and `backend/sql/20260504_create_chat_sessions.sql`.

Redis/cache: Python `redis` package in `backend/requirements.txt`; read-through helper in `backend/app/modules/conversation/cache.py`. Existing/enforced key patterns: `mode:chat_ctx:{trainer_id}:{client_id}` TTL 60s, `mode:user_digest:{trainer_id}:{client_id}` TTL 300s, `mode:trainer_persona:{trainer_id}` TTL 600s, `mode:semantic:{trainer_id}:{query_hash}` TTL 3600s. Cache miss/failure falls back to Postgres/Supabase rebuild.

Background jobs: no queue system was introduced. Chat uses post-yield/persist-after-stream callbacks and existing trainer review/coach workspace tables. Existing trainer-assistant background behavior is separate from the chat pipeline.

Memory/context strategy: bounded `UserDigest` plus trainer persona, 3-5 retrieved memory chunks, recent chat capped at 10 messages/5 turns, and current user message. Raw full-history dumps are not used in prompt assembly.

Streaming: SSE over FastAPI `StreamingResponse` in `backend/app/api/v1/chat.py` lines 307-448 and `backend/app/api/v1/chat_sessions.py` lines 267-446. Canonical events are `status`, `token`, `done`, and `error`, with temporary legacy `message_delta` aliasing.

Env vars: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `CHAT_CACHE_ENABLED`, `CHAT_CACHE_TIMEOUT_MS`, `CHAT_ROUTER_TIMEOUT_MS`, `CHAT_STREAM_LEGACY_ALIAS_ENABLED`, `CHAT_STAGING_OPENAI_ONLY`, `EXPOSE_ROUTE_DEBUG`, `TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED`.

Critical risks identified: SENTRY is deterministic in this pass and the optional LLM classifier remains TODO; semantic cache remains TODO because no vector store/vector RPC exists; provider streaming token usage may be zero when provider APIs do not return usage during streaming; unit tests prove mocked stream ordering/timing but not real external-provider SLOs; real external-provider latency needs staging trace baselines before production SLO sign-off; `CHAT_STREAM_LEGACY_ALIAS_ENABLED` should stay true until all clients support canonical token events.

## Architecture Delta

See `docs/chat_pipeline_architecture_delta.md`.

Before: chat could use blocking request/response, unstructured context, no explicit SENTRY route schema, and legacy stream delta shape.

After: chat classifies intent deterministically before the main model path, uses bounded prompt context, streams canonical SSE token events, sources pre-token status copy from the route result, records structured `chat_trace` events including `time_to_first_token_ms`, fails open on cache misses, and escalates safety cases with trainer notification metadata instead of deep personalization.

## New Env Variables

No new env variables were added by the blocker-fix pass. Existing chat pipeline env vars remain:

- `REDIS_URL`
- `CHAT_CACHE_ENABLED`
- `CHAT_CACHE_TIMEOUT_MS`
- `CHAT_ROUTER_TIMEOUT_MS`
- `CHAT_STREAM_LEGACY_ALIAS_ENABLED`

## Migration Steps

No new database migrations were added by the blocker-fix pass. Existing full pipeline migration steps remain:

1. Apply `backend/sql/20260511_add_conversation_metadata.sql`.
2. Run `NOTIFY pgrst, 'reload schema';` against the active Supabase project after migration if PostgREST schema cache is in use.
3. Configure `REDIS_URL` for production/staging chat cache. Leave cache disabled or unset locally if Redis is unavailable; chat falls back to Supabase.
4. Keep `CHAT_STREAM_LEGACY_ALIAS_ENABLED=true` until deployed clients all consume canonical `token/content` stream events.

## Tests Run

- `./backend/venv/bin/pytest -q backend/tests/test_chat_pipeline_primitives.py backend/tests/test_gemini_chat_override.py`
- `./backend/venv/bin/pytest -q backend/tests/test_chat_pipeline_primitives.py backend/tests/test_gemini_chat_override.py backend/tests/test_conversation_service_failures.py backend/tests/test_chat_api.py backend/tests/test_chat_sessions_api.py backend/tests/test_prompt_guardrails_static.py backend/tests/test_prompt_injection_adversarial.py backend/tests/test_ai_client.py backend/tests/test_daily_checkin_api.py backend/tests/test_profiles_trainer_schedule_api.py backend/tests/test_trainer_clients_api.py backend/tests/test_trainer_coach_api.py backend/tests/test_trainer_coach_repository.py`
- `npm test -- --runInBand src/features/chat/hooks/__tests__/useChatStreaming.test.js src/features/chat/hooks/__tests__/useChatMessages.test.js`
- `npm test`
- `./backend/venv/bin/python -m compileall backend/app`
- `git diff --check`
- `npm run lint`
- `npm run backend:check`
- `npm run codex:check`

Latest results: 183 backend focused tests and 18 subtests passed; frontend chat streaming/message hook tests passed; full frontend Jest passed with 456 tests across 71 suites; compileall passed; diff whitespace check passed; lint passed; backend health passed after starting `npm run backend:dev`; `npm run codex:check` passed against the local backend.

## Runbook

See `docs/chat_slow_response_runbook.md`.
