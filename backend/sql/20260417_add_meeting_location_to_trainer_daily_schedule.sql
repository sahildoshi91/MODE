BEGIN;

ALTER TABLE public.trainer_daily_schedule
  ADD COLUMN IF NOT EXISTS meeting_location TEXT;

COMMIT;
