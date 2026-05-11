BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_conversations_metadata_gin
  ON public.conversations USING GIN (metadata);

COMMIT;
