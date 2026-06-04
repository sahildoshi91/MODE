BEGIN;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

-- All pre-existing trainer rows were manually provisioned and are legacy
UPDATE public.trainers SET is_legacy = TRUE WHERE is_legacy = FALSE;

COMMIT;
