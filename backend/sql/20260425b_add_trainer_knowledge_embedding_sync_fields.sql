BEGIN;

ALTER TABLE public.trainer_knowledge_entries
  ADD COLUMN IF NOT EXISTS embedding_status TEXT;

ALTER TABLE public.trainer_knowledge_entries
  ADD COLUMN IF NOT EXISTS last_embedded_at TIMESTAMPTZ;

UPDATE public.trainer_knowledge_entries
SET embedding_status = 'pending'
WHERE embedding_status IS NULL;

ALTER TABLE public.trainer_knowledge_entries
  ALTER COLUMN embedding_status SET DEFAULT 'pending';

ALTER TABLE public.trainer_knowledge_entries
  ALTER COLUMN embedding_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trainer_knowledge_entries_embedding_status_check'
  ) THEN
    ALTER TABLE public.trainer_knowledge_entries
      ADD CONSTRAINT trainer_knowledge_entries_embedding_status_check
      CHECK (embedding_status IN ('pending', 'embedded', 'failed'));
  END IF;
END $$;

COMMIT;
