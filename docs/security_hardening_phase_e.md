# Phase E Security Hardening

## Status
Phase E controls are implemented for the chat/realtime lane and covered by tests. The remaining launch work moves to Launch Gate/Staging Verification after applying the service-role retirement migration in staging and running the strict static audit. Private Supabase Storage signed URL issuance remains a bounded launch exception because hosted Supabase does not allow this DB role to alter owner-managed `storage.objects` policies.

## LLM Output Validation
- `backend/app/modules/conversation/security.py` defines `validate_llm_output`.
- The validator redacts tenant/schema leakage, prompt reflection, SQL-like output, and echoed trainer/client IDs before content is streamed, persisted, or returned.
- `ConversationService` applies the validator on OpenAI, Anthropic, Gemini, safety-escalation, injection-refusal, fallback, and non-streaming reply paths.
- Validation flags are logged by category only; raw model output is not logged.

## Log Redaction
- `REDACT_FROM_LOGS` covers `message_content`, `response_content`, `safety_flag_description`, `client_name`, and `injury_description`.
- Chat exception logs include IDs and categories only, not raw user messages or raw assistant responses.

## Rate Limits
Chat now evaluates all required Phase E scopes:

- `POST /chat`: 20 requests per 60s per client via `RATE_LIMIT_CHAT_CLIENT_PER_WINDOW`.
- `POST /chat`: 200 requests per 60s per trainer via `RATE_LIMIT_CHAT_TRAINER_PER_WINDOW`.
- `POST /chat`: 500 requests per 60s per IP via `RATE_LIMIT_CHAT_IP_PER_WINDOW`.
- Any endpoint: 1000 requests per 60s per IP via `RATE_LIMIT_IP_PER_WINDOW`.

The rate limiter keeps the existing user/context-scoped bucket as an additional guard.
Production uses Redis as the fail-closed limiter backend. The former Postgres RPC limiter is deprecated for request traffic.

## Service-Role Key Audit
Direct privileged Supabase usage is retired from user-facing API request handlers and request-time foundations except for the private storage signed URL flow.

- `backend/app/api/v1/trainer_assignment.py` now uses a request-scoped Supabase client.
- `get_trainer_context` now resolves tenancy through the authenticated user's Supabase JWT, so RLS participates in context lookup.
- `backend/app/api/v1/chat.py` has no direct service-role usage.
- `backend/app/api/v1/storage_private.py` uses the service-role Supabase client only for signed upload URL creation, signed download URL creation, and upload grant/ownership lifecycle writes. App-level authorization still gates every path before any signed URL is issued.
- `backend/app/core/auth.py` verifies bearer tokens with the anon/user-scoped Supabase client while preserving disabled-user metadata checks.
- `backend/app/core/rate_limit.py` no longer imports or calls the service-role client.
- `backend/app/modules/intelligence_jobs/queue.py` enqueues Redis jobs without request-time service-role DB visibility writes.
- `backend/app/modules/conversation/repository.py` no longer opens its own admin sidecar for request-path conversation reads/writes.

Allowed service-role contexts after this phase:

- Worker handlers.
- Migration and scheduled maintenance scripts.
- Startup guards and internal diagnostics.
- The admin client factory in `backend/app/db/client.py`.
- `backend/app/api/v1/storage_private.py`, as a bounded launch exception for private Supabase Storage signed URLs.

The static audit blocks `get_supabase_admin_client()` in `backend/app/api/v1` except `storage_private.py`, request-time auth/rate-limit/queue/conversation foundations, and non-internal dependency factories.

## Account Deletion
- `DELETE /api/v1/account/me` now validates confirmation, creates an `account_deletion_requests` row with a request-scoped client, enqueues an `account_deletion` intelligence job, and returns `202`.
- The destructive deletion executor remains service-role-backed inside the worker lane only.

## Storage Exception
- `backend/sql/20260511f_retire_service_role_request_paths.sql` adds authenticated policies for app-owned upload grants, object ownership rows, and account deletion request tracking only.
- It does not alter `storage.objects` or `storage.buckets` because those tables are owner-managed by hosted Supabase.
- Path scopes remain enforced in application code before signed URL creation: own client paths, trainer workspace paths, and trainer assigned-client paths.
- Post-launch TODO: retire this exception only after a Supabase-supported storage policy owner workflow is available and verified in staging.

## Tests Added
- `test_llm_output_schema_leakage_redacted`
- `test_injection_in_llm_output_flagged`
- `test_output_validation_log_excludes_raw_response_content`
- `test_raw_message_content_not_in_logs`
- `test_rate_limit_fires_at_threshold`
- `test_redis_rate_limit_fires_at_threshold`
- `test_redis_rate_limit_unavailable_fails_closed`
- `test_service_role_key_not_used_in_request_handler`
- `test_service_role_key_not_used_in_request_time_foundations`
- `test_dependency_admin_factories_are_internal_only`
- `test_redact_log_payload_redacts_sensitive_keys`

## New Env Vars
- `RATE_LIMIT_CHAT_CLIENT_PER_WINDOW`
- `RATE_LIMIT_CHAT_TRAINER_PER_WINDOW`
- `RATE_LIMIT_CHAT_IP_PER_WINDOW`
- `RATE_LIMIT_IP_PER_WINDOW`
- `RATE_LIMIT_BACKEND=redis` in production
- `REDIS_URL` required in production
