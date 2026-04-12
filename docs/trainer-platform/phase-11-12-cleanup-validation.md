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

## Staging Hardening Evidence
- Date executed: 2026-04-11 (`America/Los_Angeles`).
- Verification SQL status: user reported running `backend/sql/20260411d_verify_trainer_platform_rls.sql` in Supabase and it passed without a `coach_memory` verification exception.
- Artifact directory: `/tmp/mode_stage_hardening_20260411_182918`
- Orchestration schema preflight:
  - `workouts.feel_rating` query succeeded.
  - Sample artifact: `feel_rating_preflight.json`
- Baseline staging command:
  - `cd backend && TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=false MODE_RUN_STAGING_SUPABASE_TESTS=1 ./venv/bin/pytest -q tests/test_chat_api_staging_integration.py tests/test_daily_checkin_staging_integration.py tests/test_trainer_platform_staging_smoke.py`
  - Result: `9 passed, 134 warnings in 96.18s (0:01:36)`
  - Warnings were Supabase client deprecation warnings for `timeout` and `verify`; no auth/RLS failures or unexpected 5xx errors were observed.
- Baseline orchestration metadata probe:
  - Artifact: `staging_off_probe.json`
  - Sample:
    - `enabled=false`
    - `used=false`
    - `fallback_reason=flag_disabled`
    - assistant row timestamp: `2026-04-12T01:32:50.131653+00:00`
- Orchestration-on staging command:
  - `cd backend && TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=true MODE_RUN_STAGING_SUPABASE_TESTS=1 ./venv/bin/pytest -q tests/test_chat_api_staging_integration.py tests/test_daily_checkin_staging_integration.py tests/test_trainer_platform_staging_smoke.py`
  - Result: `9 passed, 142 warnings in 102.37s (0:01:42)`
  - Warnings were Supabase client deprecation warnings for `timeout` and `verify`; no auth/RLS failures or unexpected 5xx errors were observed.
- Orchestration-on metadata probe:
  - Artifact: `staging_on_probe.json`
  - Sample:
    - `enabled=true`
    - `used=true`
    - `memory_count=1`
    - `trainer_rules_count=0`
    - no `fallback_reason` present
    - assistant row timestamp: `2026-04-12T01:34:41.75303+00:00`
- Functional parity verdict: `pass`
  - Trainer routes worked for trainer users.
  - Client and outsider trainer-route access remained blocked.
  - Cross-trainer access remained blocked.
  - `internal_only` coach memory remained hidden from client tokens.
  - Chat and daily check-in persistence continued to pass under real RLS with orchestration both off and on.
- Release owner: pending assignment.
- Approver: pending assignment.
- Signoff status: evidence captured, owner/approver entry still pending before promotion beyond staging.
