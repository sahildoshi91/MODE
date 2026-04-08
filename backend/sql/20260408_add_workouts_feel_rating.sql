BEGIN;

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS feel_rating INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workouts_feel_rating_check'
      AND conrelid = 'public.workouts'::regclass
  ) THEN
    ALTER TABLE public.workouts
      ADD CONSTRAINT workouts_feel_rating_check CHECK (feel_rating IS NULL OR (feel_rating BETWEEN 1 AND 5));
  END IF;
END $$;

COMMIT;
