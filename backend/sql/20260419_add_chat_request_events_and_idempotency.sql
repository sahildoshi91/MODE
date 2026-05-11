BEGIN;

CREATE TABLE IF NOT EXISTS public.conversation_ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  request_status TEXT NOT NULL DEFAULT 'request_received' CHECK (
    request_status IN ('request_received', 'working', 'streaming', 'completed', 'failed')
  ),
  client_message_id TEXT,
  idempotency_key TEXT,
  error_detail TEXT,
  latest_event_seq INTEGER NOT NULL DEFAULT 0,
  completed_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_conversation_ai_requests_conversation_created
  ON public.conversation_ai_requests (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_ai_requests_status
  ON public.conversation_ai_requests (trainer_id, request_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_ai_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.conversation_ai_requests(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ack', 'progress', 'delta', 'completed', 'failed', 'heartbeat')
  ),
  stage TEXT CHECK (
    stage IS NULL
    OR stage IN ('reviewing_message', 'checking_context', 'preparing_response', 'finalizing_response')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_conversation_ai_request_events_request_seq
  ON public.conversation_ai_request_events (request_id, seq ASC);

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_request_id_fkey;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_request_id_fkey
  FOREIGN KEY (request_id)
  REFERENCES public.conversation_ai_requests(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_client_message_id
  ON public.conversation_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_idempotency
  ON public.conversation_messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.conversation_ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_ai_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_ai_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_ai_request_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.conversation_ai_requests TO authenticated;
GRANT SELECT, INSERT ON public.conversation_ai_request_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_ai_requests'
      AND policyname = 'conversation_ai_requests_select_own'
  ) THEN
    CREATE POLICY conversation_ai_requests_select_own
      ON public.conversation_ai_requests
      FOR SELECT TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_ai_requests'
      AND policyname = 'conversation_ai_requests_insert_own'
  ) THEN
    CREATE POLICY conversation_ai_requests_insert_own
      ON public.conversation_ai_requests
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_ai_requests'
      AND policyname = 'conversation_ai_requests_update_own'
  ) THEN
    CREATE POLICY conversation_ai_requests_update_own
      ON public.conversation_ai_requests
      FOR UPDATE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id))
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_ai_request_events'
      AND policyname = 'conversation_ai_request_events_select_own'
  ) THEN
    CREATE POLICY conversation_ai_request_events_select_own
      ON public.conversation_ai_request_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.conversation_ai_requests request
          WHERE request.id = conversation_ai_request_events.request_id
            AND public.auth_is_trainer_user(request.trainer_id)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_ai_request_events'
      AND policyname = 'conversation_ai_request_events_insert_own'
  ) THEN
    CREATE POLICY conversation_ai_request_events_insert_own
      ON public.conversation_ai_request_events
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.conversation_ai_requests request
          WHERE request.id = conversation_ai_request_events.request_id
            AND public.auth_is_trainer_user(request.trainer_id)
        )
      );
  END IF;
END $$;

COMMIT;
