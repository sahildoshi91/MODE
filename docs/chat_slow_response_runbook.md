# Slow Chat Response Runbook

## Primary Signal
Search backend logs for structured events with `"event":"chat_trace"`.

Important fields:
- `time_to_first_token_ms`: request receipt to first non-empty canonical `token` event. Status events are excluded.
- `total_response_ms`: full chat response duration.
- `route`: `FAST_PATH`, `DEEP_PATH`, `SAFETY_ESCALATION`, or a fallback route label.
- `model_used`: provider model used for the answer.
- `cache_hit`: whether digest/persona context used Redis.
- `retrieval_latency_ms`: retrieval timing when available.
- `error_category`: populated for failed/no-token streams.

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

## Triage
- If `time_to_first_token_ms` is `-1`, the chat path never emitted or observed a token. Check `error_category`, provider errors, and whether the route hit the prompt-injection guard.
- If `time_to_first_token_ms` exceeds the route target, compare `route`, `model_used`, `fallback_used`, and `cache_hit` before changing code. Slow first token with `cache_hit=false` usually points to context rebuild or provider latency.
- If `cache_hit=false` and total latency is high, verify Redis health and `REDIS_URL`.
- If `route=SAFETY_ESCALATION`, higher latency can be expected because trainer review tagging and safe response handling are active.
- If `model_used` is a fallback model, inspect provider availability and API key configuration.
- If `total_response_ms` is high but `time_to_first_token_ms` is healthy, the user saw streaming quickly; investigate provider completion length or client rendering.

## Commands
- Backend health: `npm run backend:check`
- Prompt-close check: `npm run codex:check`
- Focused tests: `./backend/venv/bin/pytest -q backend/tests/test_chat_api.py backend/tests/test_chat_sessions_api.py backend/tests/test_chat_pipeline_primitives.py`
