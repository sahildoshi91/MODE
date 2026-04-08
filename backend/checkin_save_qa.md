# Check-In Save QA

Use this checklist when a daily check-in lands on the pending summary instead of saving.

## Account Linkage
- Confirm the logged-in `auth.users.id` matches `clients.user_id` for the affected account.
- Confirm exactly one `clients` row exists for that `auth.users.id`.
- Confirm the resolved `clients.id` is the same `client_id` used by the backend trainer context.
- Confirm `assigned_trainer_id` is valid for the same tenant as the client row.

## Daily Check-In Policies
- Confirm the `daily_checkins` table exists with the `client_id`, `date`, `inputs`, `total_score`, and `assigned_mode` columns.
- Confirm the RLS policies from `backend/sql/20260327_create_daily_checkins.sql` are present in the target Supabase project.
- Confirm the authenticated role still has `SELECT`, `INSERT`, and `UPDATE` on `public.daily_checkins`.

## Save-Path Verification
- Submit a check-in with the affected user's JWT against `POST /api/v1/checkin`.
- Record the HTTP status and `detail` returned by the API.
- If the API returns an ownership mismatch, compare `trainer_context.client_user_id` to the authenticated user.
- If the API returns an RLS/PostgREST error, record the `code`, `hint`, and `details` values from backend logs.

## Good vs Failing Account Comparison
- Compare `auth.users.id -> clients.user_id -> clients.id -> daily_checkins.client_id` for one failing account and one working account.
- If the linkage matches on both, treat the issue as systemic and inspect the request-scoped Supabase JWT / RLS behavior.
- If the linkage differs only on the failing account, repair the underlying client record before retrying.
