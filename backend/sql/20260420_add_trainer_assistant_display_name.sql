BEGIN;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS assistant_display_name TEXT;

COMMIT;
