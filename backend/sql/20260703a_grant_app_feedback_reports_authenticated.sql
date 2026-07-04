BEGIN;

-- 42501 fix: app_feedback_reports had RLS policies but no GRANT to authenticated.
-- Postgres requires both. Pattern matches trainer_onboarding_profiles/events grants.
GRANT SELECT, INSERT ON public.app_feedback_reports TO authenticated;

COMMIT;
