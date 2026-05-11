BEGIN;

ALTER TABLE public.chat_sessions
  ALTER COLUMN trainer_id DROP NOT NULL;

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_session_type_check;

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_session_type_check
  CHECK (session_type IN ('client_chat', 'atlas_client_chat', 'trainer_chat', 'coach_ai'));

CREATE TABLE IF NOT EXISTS public.client_trainer_connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL,
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  trainer_response_note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_trainer_connection_requests_one_pending
  ON public.client_trainer_connection_requests (client_id, trainer_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_client_trainer_connection_requests_trainer_status
  ON public.client_trainer_connection_requests (trainer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_trainer_connection_requests_client_status
  ON public.client_trainer_connection_requests (client_id, status, created_at DESC);

ALTER TABLE public.client_trainer_connection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_trainer_connection_requests FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.client_trainer_connection_requests TO authenticated;

DROP POLICY IF EXISTS chat_sessions_select_visible ON public.chat_sessions;
CREATE POLICY chat_sessions_select_visible ON public.chat_sessions
  FOR SELECT TO authenticated
  USING (
    (
      role = 'client'
      AND session_type = 'atlas_client_chat'
      AND trainer_id IS NULL
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
      )
    )
    OR (
      role = 'client'
      AND session_type = 'client_chat'
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
          AND c.assigned_trainer_id = chat_sessions.trainer_id
      )
    )
    OR (
      role = 'trainer'
      AND user_id = auth.uid()
      AND public.auth_is_trainer_user(trainer_id)
      AND (
        client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = chat_sessions.client_id
            AND c.assigned_trainer_id = chat_sessions.trainer_id
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_sessions_insert_visible ON public.chat_sessions;
CREATE POLICY chat_sessions_insert_visible ON public.chat_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      role = 'client'
      AND session_type = 'atlas_client_chat'
      AND trainer_id IS NULL
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
      )
    )
    OR (
      role = 'client'
      AND session_type = 'client_chat'
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
          AND c.assigned_trainer_id = chat_sessions.trainer_id
      )
    )
    OR (
      role = 'trainer'
      AND user_id = auth.uid()
      AND public.auth_is_trainer_user(trainer_id)
      AND (
        client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = chat_sessions.client_id
            AND c.assigned_trainer_id = chat_sessions.trainer_id
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_sessions_update_visible ON public.chat_sessions;
CREATE POLICY chat_sessions_update_visible ON public.chat_sessions
  FOR UPDATE TO authenticated
  USING (
    (
      role = 'client'
      AND session_type = 'atlas_client_chat'
      AND trainer_id IS NULL
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
      )
    )
    OR (
      role = 'client'
      AND session_type = 'client_chat'
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
          AND c.assigned_trainer_id = chat_sessions.trainer_id
      )
    )
    OR (
      role = 'trainer'
      AND user_id = auth.uid()
      AND public.auth_is_trainer_user(trainer_id)
    )
  )
  WITH CHECK (
    (
      role = 'client'
      AND session_type = 'atlas_client_chat'
      AND trainer_id IS NULL
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
      )
    )
    OR (
      role = 'client'
      AND session_type = 'client_chat'
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = chat_sessions.client_id
          AND c.user_id = auth.uid()
          AND c.assigned_trainer_id = chat_sessions.trainer_id
      )
    )
    OR (
      role = 'trainer'
      AND user_id = auth.uid()
      AND public.auth_is_trainer_user(trainer_id)
    )
  );

DROP POLICY IF EXISTS client_trainer_connection_requests_client_select ON public.client_trainer_connection_requests;
CREATE POLICY client_trainer_connection_requests_client_select ON public.client_trainer_connection_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_trainer_connection_requests.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS client_trainer_connection_requests_trainer_select ON public.client_trainer_connection_requests;
CREATE POLICY client_trainer_connection_requests_trainer_select ON public.client_trainer_connection_requests
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

DROP POLICY IF EXISTS client_trainer_connection_requests_client_insert ON public.client_trainer_connection_requests;
CREATE POLICY client_trainer_connection_requests_client_insert ON public.client_trainer_connection_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_trainer_connection_requests.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS client_trainer_connection_requests_trainer_update ON public.client_trainer_connection_requests;
CREATE POLICY client_trainer_connection_requests_trainer_update ON public.client_trainer_connection_requests
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
