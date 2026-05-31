BEGIN;

ALTER TABLE public.daily_checkins
  ADD COLUMN IF NOT EXISTS checkin_response_attempted BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.daily_checkins
SET checkin_response_attempted = TRUE
WHERE checkin_response IS NOT NULL;

COMMIT;
