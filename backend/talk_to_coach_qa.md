# Talk-to-Coach QA

Use this checklist for post-check-in `Talk to Coach` validation.

## Account and Context Checks
- Confirm `auth.users.id` maps to exactly one `clients.user_id` row.
- Confirm `clients.assigned_trainer_id` is non-null and points to an active trainer.
- Confirm `resolve_trainer_context` returns matching `client_id`, `trainer_id`, and `trainer_display_name`.

## Post-Checkin Launch Checks
- Complete a check-in and land on summary.
- Tap `Talk to Coach`.
- Confirm first coach message references post-check-in context and mode when available.
- Confirm mode-aware quick replies are shown before first send.

## Send/Retry Reliability
- Send first message from post-check-in chat and confirm `200` from `POST /api/v1/chat`.
- Force backend failure and confirm:
  - Draft text remains in composer.
  - Error card appears with retry CTA.
  - Retry CTA resends last failed message.
- After backend recovery, retry should succeed and clear error state.

## Router and Persistence Checks
- Confirm chat request includes `client_context.entrypoint=post_checkin` and check-in snapshot keys.
- Verify generic first message routes as `post_checkin_followup` (not plain `qa_quick`).
- Verify `conversations`, `conversation_messages`, and `conversation_usage_events` rows persist under RLS.

## Diagnostics
- For failures, capture endpoint, status code, and error detail.
- If a controlled `502` is returned, record request payload context and backend logs.
- Before running staging chat integration, run a schema preflight:
  - insert then delete a `conversations` row with `type='chat'`.
  - if insert fails, apply the SQL migrations below before retrying tests.
- If staging integration fails at setup, run:
  - `backend/sql/20260408_fix_bootstrap_rpc_ambiguity.sql`
  - `backend/sql/20260408b_fix_assign_client_rpc_client_id_ambiguity.sql`
  - `backend/sql/20260408c_repair_conversations_type_check.sql`
  then retry.
