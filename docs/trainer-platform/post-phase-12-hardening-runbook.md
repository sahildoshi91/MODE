# Post-Phase 12 Hardening Runbook

## 1) Staging migration apply order
Apply these SQL files in staging in this exact order:

1. `backend/sql/20260411_create_trainer_rules_and_versions.sql`
2. `backend/sql/20260411b_create_trainer_talking_points_and_memory_indexes.sql`
3. `backend/sql/20260411c_create_ai_review_outputs_and_feedback.sql`

After migration apply, run:

- `backend/sql/20260411d_verify_trainer_platform_rls.sql`

Expected outcome:
- All five tables exist.
- RLS is enabled and forced for all five.
- Expected trainer-owner policies are present.

## 2) Guarded staging rollout (orchestration off -> on)
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

## 3) Orchestration fallback metadata check
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

## 4) Rollback rule
Immediately set:

```bash
TRAINER_INTELLIGENCE_ORCHESTRATION_ENABLED=false
```

If any of the following are observed:
- trainer-role access regression
- cross-tenant/cross-trainer data exposure
- controlled chat error spike during smoke
