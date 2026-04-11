# PHASE 11-12 - Cleanup / Refactor and Regression Validation

## Scope
- Perform cleanup on trainer-side and shared orchestration/review internals.
- Preserve client-side contracts and behavior.
- Run full regression validation and document residual risk.

## Cleanup and Refactor Actions
- Consolidated trainer-only actor enforcement via a shared helper used by trainer APIs.
- Standardized AI output ledger metadata and payload schema tags across chat, talking-points, and generated-plan producers.
- Normalized AI feedback auto-apply flow to emit a single feedback event with final apply status and consistent metadata.
- Ensured coach-memory auto-apply provenance references a stable UUID feedback-event id.
- Enforced feature-flag no-op behavior for auto-apply when `trainer_ai_review_auto_apply_enabled=false`.
- Kept trainer-intelligence orchestration behind `trainer_intelligence_orchestration_enabled` (default off).
- Refactored trainer review UI into smaller components:
  - filters card
  - queue list
  - detail panel (edit/approve/reject + audit trail)

## Migration Checklist (Staging Before Production)
1. Apply `backend/sql/20260411_create_trainer_rules_and_versions.sql`.
2. Apply `backend/sql/20260411b_create_trainer_talking_points_and_memory_indexes.sql`.
3. Apply `backend/sql/20260411c_create_ai_review_outputs_and_feedback.sql`.
4. Verify RLS policies exist for:
   - `trainer_rules`
   - `trainer_rule_versions`
   - `trainer_talking_points`
   - `ai_generated_outputs`
   - `ai_feedback_events`
5. Smoke-test trainer-only access with non-trainer and trainer users.

## Flag Rollout Sequence
1. Keep `trainer_intelligence_orchestration_enabled=false` in production initially.
2. Keep `trainer_ai_review_auto_apply_enabled=true` in staging; optionally disable for production canary if needed.
3. Validate trainer review queue/edit/approve/reject with real trainer accounts.
4. Enable orchestration in staging and compare chat outputs against baseline (flag-off).
5. Promote orchestration to production only after parity and fallback checks pass.

## Regression Validation Summary
- Date executed: 2026-04-11.
- Fixed regression blocker: `test_progress_analytics_7d_delta_compares_previous_7_day_window` now passes after aligning change-window rounding logic.
- Full backend suite result: `111 passed, 4 skipped`.
- Protected client contract suite result:
  - `tests/test_chat_api.py`
  - `tests/test_trainer_assignment_api.py`
  - `tests/test_daily_checkin_api.py`
  - combined result: `62 passed`
- Protected client contracts to validate each run:
  - `/api/v1/checkin/*`
  - `/api/v1/chat`
  - `/api/v1/trainer-assignment/*`
- Trainer additions to validate:
  - command-center talking points ledger writes
  - generated-plan ledger writes
  - unified trainer review outputs endpoints
  - trainer-only access and tenant isolation
- Trainer-phase focused suites validated in this pass:
  - `tests/test_ai_feedback_service.py`
  - `tests/test_trainer_review_api.py`
  - `tests/test_trainer_intelligence_service.py`
  - `tests/test_trainer_intelligence_orchestration_conversation.py`
  - `tests/test_trainer_home_command_center_service.py`
  - `tests/test_trainer_clients_api.py`
  - combined result: `14 passed`

## Residual Risks
- Frontend static lint coverage remains limited while repo lacks `eslint.config.*`.
- Migration drift remains possible if environments skip incremental SQL order.
- Orchestration output quality drift is possible without staged parity checks.
