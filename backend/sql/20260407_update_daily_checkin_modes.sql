BEGIN;

ALTER TABLE public.daily_checkins
  DROP CONSTRAINT IF EXISTS daily_checkins_assigned_mode_check;

ALTER TABLE public.daily_checkins
  ADD CONSTRAINT daily_checkins_assigned_mode_check
  CHECK (assigned_mode IN ('BEAST', 'BUILD', 'RECOVER', 'REST'));

COMMIT;
