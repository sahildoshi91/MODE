# Generated Workout Variants QA

Use this checklist after the generated-plan variants migration is live.

## Backend Preflight
- Confirm the backend is running code that returns `request_fingerprint`, `revision_number`, and `workout_context` from `POST /api/v1/checkin/generate-plan`.
- Confirm `public.generated_checkin_plans` contains `request_fingerprint` and `revision_number`.
- Run the staging integration test in `backend/tests/test_daily_checkin_staging_integration.py` with `MODE_RUN_STAGING_SUPABASE_TESTS=1`.

## API Acceptance
- Same check-in, same time, different `environment` returns a new `plan_id` and different `request_fingerprint`.
- Same check-in, same environment, different `time_available` returns a new `plan_id` and different `request_fingerprint`.
- Same check-in, same environment, same time, `refresh_requested=true` returns a new `plan_id`, same `request_fingerprint`, and incremented `revision_number`.
- Same check-in, same environment, same time, `refresh_requested=false` reuses the latest saved revision.

## Database Checks
- Query `generated_checkin_plans` for the target `checkin_id`.
- Confirm one fingerprint bucket exists for `home_gym / 30`, one for `outdoors / 30`, and one for `home_gym / 10`.
- Confirm the `home_gym / 30` bucket has multiple rows after manual regenerate.
- Confirm the highest stored `revision_number` for `home_gym / 30` matches the latest API response.

## Manual App QA
- Complete a daily check-in and choose `Build me a training routine`.
- Generate `home_gym / 30` and record:
  - visible title
  - first warmup item
  - first exercise
  - visible duration
- Change only `environment` to `outdoors` and generate again.
- Confirm title, warmup, exercise selection, and visible plan content change.
- Change only `time_available` from `30` to `10` in the same environment and generate again.
- Confirm duration and block structure change.
- Without changing inputs, tap `Regenerate Workout`.
- Confirm a new workout appears while staying aligned to the same environment and time.
- Tap `Adjust with Coach` after each generated workout.
- Confirm the coach edits the exact visible workout variant instead of an older version.

## Failure Capture
- Record endpoint, request payload, status, and response body for any failing generate-plan request.
- Record the corresponding `generated_checkin_plans` rows for the same `checkin_id`.
- If the issue is “same workout again,” compare:
  - `request_fingerprint`
  - `revision_number`
  - `structured_content`
  - `workout_context`
