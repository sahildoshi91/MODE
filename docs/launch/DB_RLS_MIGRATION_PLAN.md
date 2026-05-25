# DB/RLS Migration Plan

Planning date: 2026-05-25

## DO NOT APPLY WITHOUT HUMAN APPROVAL
This document and anything under `docs/launch/sql_drafts/` is planning-only. Do not run it against production or staging, and do not promote it to `backend/sql/` until a human DB owner approves the exact migration.

## Chat Event Schema/RLS Drift Summary
- Existing chat request-event persistence appears to have schema constraints designed around older event types.
- Current stream encoding emits `status`, `token`, `message_delta`, `done`, and `error` events.
- If the DB constraint does not allow these event types, stream event persistence can fail even when the client-visible stream succeeds.
- Request-event RLS appears trainer-oriented in the audit notes; client chat streams also need safe request-event writes/reads through the intended backend/service path.

## Existing vs Emitted Event Types
| Area | Event types |
| --- | --- |
| Existing DB constraint to confirm | Older request-event/event names from prior migrations; exact allowed values must be inspected in staging before migration. |
| Current encoder emits | `status`, `token`, `message_delta`, `done`, `error` |
| Compatibility goal | Allow current encoder event types while preserving historical rows and blocking arbitrary cross-tenant reads/writes. |

## Request-Event RLS Concern
- A trainer-only write policy may block client-originated chat stream request events.
- The safe target is not broad client table access; it is tenant/trainer/client-scoped access through the backend's authenticated actor context.
- Any policy must preserve tenant isolation and must not let one client read another client's request events.

## Tenant-Pair Guardrail Concern
- Several write paths rely on app logic to pair `trainer_id`, `client_id`, and `tenant_id`.
- v1 can use a centralized default tenant/trainer selection, but migrations must not permanently encode a global single-trainer assumption.
- Guardrails should verify that every client-scoped chat/session/message/event write belongs to an active trainer-client assignment in the same tenant.

## Proposed Migration Steps
1. Inspect staging catalog for current `ai_request_events` or equivalent event table constraints, policies, grants, and indexes.
2. Add or replace the non-destructive event-type constraint to include `status`, `token`, `message_delta`, `done`, and `error` while preserving historical supported values.
3. Add tenant/client/trainer indexes needed by policy checks if missing.
4. Tighten request-event RLS so trainers and clients only access events belonging to their own tenant-scoped conversations/sessions.
5. Add tenant-pair guardrails for chat/session/message/event writes that reference both `trainer_id` and `client_id`.
6. Run tenant A/B runtime tests through authenticated app/API paths.
7. Only after staging evidence is approved, promote reviewed SQL into the normal `backend/sql/` migration flow.

## Proposed Tests
- Client A can stream chat and request-event persistence accepts `status`, `token`, `message_delta`, `done`, and `error`.
- Client A cannot read Client B request events, messages, sessions, conversations, or memory/profile rows.
- Trainer A can read assigned Client A request events but not Client B unless assigned in the same tenant.
- Unassigned client cannot create chat/session/message rows for an arbitrary trainer.
- Historical event rows remain readable to authorized actors after constraint migration.
- Backend integration tests cover disabled streaming/provider behavior without relying on DB migration side effects.

## Rollback Plan
- Keep old constraint definition captured before migration.
- If event persistence breaks, rollback constraint to the previous definition and disable request-event persistence if a kill switch exists.
- If RLS blocks valid users, rollback only the affected policy in staging first and keep client chat routed through backend APIs.
- If a cross-tenant leak is observed, stop rollout, disable affected write/read path, and restore the previous approved policy set.

## Required Human Approvals
- DB owner approval of exact SQL diff.
- Product/privacy approval of retention implications for chat events.
- Backend owner approval that app code writes carry correct tenant/trainer/client context.
- Staging backup/snapshot confirmation before any migration is applied.

## Draft SQL
- `docs/launch/sql_drafts/launch_slice1_rls_readiness_probe.sql`

That draft is inspection-only and must remain labeled `NOT APPLIED — HUMAN REVIEW REQUIRED`.
