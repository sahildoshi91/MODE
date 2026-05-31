BEGIN;

ALTER TABLE public.daily_checkins
  ADD COLUMN IF NOT EXISTS checkin_response JSONB;

COMMIT;
