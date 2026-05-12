BEGIN;

-- The composite index below covers equality on conversation_id and the
-- created_at/id ordering used by bounded history loads. Keeping the older
-- single-column index can lead Postgres to choose an index scan plus sort.
DROP INDEX IF EXISTS public.idx_conversation_messages_conversation_id;

COMMIT;

-- Rollback:
-- CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
--   ON public.conversation_messages (conversation_id);
