BEGIN;

ALTER TABLE public.conversations
  ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
