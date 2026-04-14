# Post-Phase 12 Hardening Runbook

## 1) Staging migration apply order
Apply these SQL files in staging in this exact order:

1. `backend/sql/20260411_create_trainer_rules_and_versions.sql`
2. `backend/sql/20260411b_create_trainer_talking_points_and_memory_indexes.sql`
3. `backend/sql/20260411c_create_ai_review_outputs_and_feedback.sql`
4. `backend/sql/20260412_fix_coach_memory_internal_visibility_rls.sql`

After migration apply, run:

- `backend/sql/20260411d_verify_trainer_platform_rls.sql`

Expected outcome:
- All five trainer-platform tables exist.
- `coach_memory` exists and reports RLS enabled + forced.
- Expected trainer-owner policies are present.
- `coach_memory_select_visible` shows the hardened predicate.
- The verification script fails immediately if `coach_memory` still uses the legacy client-visible policy.

## 2) Trainer Clients Runtime Alignment Preflight
Before trainer QA and before any staging smoke run, verify the runtime API surface matches the current repo code:

```bash
BASE_URL="http://<api-host>:8000"
curl -sS -D - "$BASE_URL/healthz"
curl -sS "$BASE_URL/openapi.json" | rg '"/api/v1/trainer-home/command-center"|"/api/v1/trainer-clients/{client_id}/detail"'
curl -sS -D - "$BASE_URL/api/v1/trainer-home/command-center"
```

Expected outcome:
- `/healthz` returns `200`.
- `/openapi.json` includes `"/api/v1/trainer-home/command-center"` and `"/api/v1/trainer-clients/{client_id}/detail"`.
- unauthenticated `/api/v1/trainer-home/command-center` returns `401` or `403` (never `404`).

If `404` appears on trainer routes, treat it as a stale runtime mismatch and restart/redeploy backend from current repo code before continuing.

## 2.1) Trainer onboarding storage preflight
Before trainer onboarding QA (`Review coach settings` / `Retrain coach`), verify onboarding storage tables are reachable:

```bash
cd backend
./venv/bin/python - <<'PY'
from app.modules.trainer_onboarding.diagnostics import run_trainer_onboarding_storage_preflight
print(run_trainer_onboarding_storage_preflight())
PY
```

Expected outcome:
- `healthy: True`
- `missing_tables: []`
- `errors: {}`

If `missing_tables` contains onboarding tables, apply:
- `backend/sql/20260413_create_trainer_onboarding_profiles_and_events.sql`
- `backend/sql/20260413b_add_retrain_draft_to_trainer_onboarding_profiles.sql`

## 3) Guarded staging rollout (orchestration off -> on)
Keep orchestration off for baseline:

```bash
TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=false
```

Run staging baseline tests:

```bash
cd backend
MODE_RUN_STAGING_SUPABASE_TESTS=1 ./venv/bin/pytest -q \
  tests/test_chat_api_staging_integration.py \
  tests/test_daily_checkin_staging_integration.py \
  tests/test_trainer_platform_staging_smoke.py
```

Enable orchestration for guarded internal QA window:

```bash
TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=true
```

Re-run the same staging suite and compare parity with baseline.

Record the verification SQL output and both staging pytest runs in the rollout ticket or release note before moving on.

### Orchestration schema preflight (before enabling ON)
Confirm the workouts analytics field used by trainer-intelligence exists:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'workouts'
  AND column_name = 'feel_rating';
```

Expected outcome:
- One row with `feel_rating`.
- If missing, apply `backend/sql/20260408_add_workouts_feel_rating.sql` before enabling orchestration.

## 4) Orchestration fallback metadata check
Query assistant messages and inspect `structured_payload.orchestration` metadata:

```sql
SELECT
  conversation_id,
  role,
  created_at,
  structured_payload -> 'orchestration' AS orchestration
FROM public.conversation_messages
WHERE role = 'assistant'
ORDER BY created_at DESC
LIMIT 50;
```

Expected outcome:
- No auth/tenant scope regressions.
- No unexpected 5xx chat errors.
- Orchestration metadata reflects enabled/used/fallback states.

## 5) Required artifacts and signoff
Do not promote beyond staging until all of the following are captured:

- verification SQL output showing the hardened `coach_memory` policy check passed
- staging pytest output with `TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=false`
- staging pytest output with `TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=true`
- one recent assistant message sample showing `structured_payload.orchestration`
- release owner + approver + date recorded in the rollout ticket

If any artifact is missing, treat rollout status as not signed off.

## 6) Rollback rule
Immediately set:

```bash
TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=false
```

If any of the following are observed:
- trainer-role access regression
- cross-tenant/cross-trainer data exposure
- controlled chat error spike during smoke
