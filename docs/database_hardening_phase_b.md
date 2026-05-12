# Database Hardening Phase B

## Phase
Phase B: Database Hardening / Data Fortress Lane.

## What Changed
- Added tenant/history indexes in `backend/sql/20260511c_database_hardening_indexes.sql`.
- Added a follow-up migration to remove the redundant single-column conversation-message index after the composite history index exists: `backend/sql/20260511e_drop_redundant_conversation_message_index.sql`.
- Bounded `ConversationRepository.list_messages()` to max 50 and changed it to fetch newest rows first, then reverse for prompt rendering.
- Bounded `ConversationRepository.list_messages_with_payload()` to max 200.
- Replaced chat-session append fallback that loaded 500 rows with a single `message_index DESC LIMIT 1` query.
- Added `backend/sql/20260511d_verify_data_fortress_phase_b.sql` for index/RLS posture verification.
- Added `backend/scripts/phase_b_database_audit.py` for live RLS/index/EXPLAIN checks without printing database secrets.
- Added `backend/scripts/apply_phase_b_migrations.py` because local `psql` is unavailable but `psycopg` is installed.

## Index Audit
Added or verified:
- `conversations(trainer_id, client_id)` via `idx_conversations_trainer_client`
- `conversations(client_id, created_at DESC)` via `idx_conversations_client_created_desc`
- `conversation_messages(conversation_id, created_at DESC, id DESC)` via `idx_conversation_messages_conversation_created_desc`
- `intelligence_jobs(job_type, status, enqueued_at)` via `idx_intelligence_jobs_type_status_enqueued`
- `chat_sessions(user_id, role, trainer_id, session_type, session_date DESC, last_message_at DESC NULLS LAST, created_at DESC)`
- `chat_messages(session_id, message_index DESC)`
- `daily_checkins(client_id, created_at DESC)` as the current readiness-history analogue

Existing:
- `trainer_knowledge_entries(trainer_id, status, updated_at DESC)` supports trainer-scoped lookups.
- `daily_checkins(client_id, date DESC)` already supports the current readiness/check-in query shape.

Absent directive tables:
- `messages`: not present; the real table is `conversation_messages`.
- `user_digests`: not present; digest is currently computed/cached, not table-backed.
- `safety_flags`: not present; safety flags live in `conversations.metadata.active_safety_flags`.
- `readiness_scores`: not present; readiness history currently uses `daily_checkins`.

The migration includes conditional no-op index blocks for those absent tables so it remains safe if they are added later.

## Live Staging Verification
Applied to staging using:

```bash
set -a; source .env.staging; set +a; ./backend/venv/bin/python backend/scripts/apply_phase_b_migrations.py
```

Audited using:

```bash
set -a; source .env.staging; set +a; ./backend/venv/bin/python backend/scripts/phase_b_database_audit.py
```

Result:
- Required Phase B indexes: present.
- RLS enabled and forced: yes for `conversations`, `conversation_messages`, `chat_sessions`, `chat_messages`, `coach_memory`, `trainer_knowledge_entries`, `daily_checkins`, `intelligence_jobs`, and `worker_job_traces`.
- Cross-tenant runtime test: skipped because staging did not have enough tenant A/B sample rows.

EXPLAIN highlights:
- `conversations_trainer_client`: index scan using `idx_conversations_trainer_client_status_updated_created`; execution ~0.027ms on sparse staging.
- `conversations_client_history`: index scan using `idx_conversations_client_created_desc`; execution ~0.025ms on sparse staging.
- `conversation_messages_history`: index-only scan using `idx_conversation_messages_conversation_created_desc`; execution ~0.028ms on sparse staging.
- `intelligence_jobs_visibility`: index scan using `idx_intelligence_jobs_type_status_enqueued`; execution ~0.039ms on sparse staging.

Note: staging is sparse, so several plans are labeled `index_usability_plan` and use placeholder UUIDs. They prove index eligibility, not production cardinality.

## RLS Audit
The live audit confirmed RLS enabled+forced for the key user-facing tables. Policies are currently based on Supabase `auth.uid()` helper functions such as `auth_is_trainer_user`, `auth_can_view_client`, and `auth_is_client_assigned_to_trainer`, rather than raw `request.jwt.claims.trainer_id/client_id` predicates.

No cross-tenant leak was found, but the requested tenant A/B runtime query could not be completed on staging because there were not enough seeded tenant rows.

## Connection Pool
The app still uses Supabase/PostgREST through `supabase-py`; it does not hold direct Postgres connections in the chat streaming path. Direct Postgres usage in Phase B is limited to short-lived audit/migration scripts. A server-side Postgres pool with `pool_size=10`, `max_overflow=5`, `pool_timeout=30s`, and `pool_recycle=1800s` remains not applicable until the runtime moves from Supabase REST calls to direct Postgres connections.

## Remaining Risk
- Full cross-tenant RLS runtime tests need seeded tenant A/B users in staging.
- Production-like EXPLAIN ANALYZE needs representative row counts; sparse staging can only prove index eligibility.
