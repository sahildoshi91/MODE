BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('client', 'trainer')),
  session_type TEXT NOT NULL CHECK (session_type IN ('client_chat', 'trainer_chat', 'coach_ai')),
  session_date DATE NOT NULL,
  summary TEXT,
  title TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_daily_client_scope
  ON public.chat_sessions (user_id, role, session_type, session_date, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_daily_trainer_scope
  ON public.chat_sessions (user_id, role, session_type, session_date, trainer_id)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_trainer_history
  ON public.chat_sessions (trainer_id, role, session_type, session_date DESC, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_client_history
  ON public.chat_sessions (client_id, role, session_type, session_date DESC, last_message_at DESC NULLS LAST)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'ai', 'system')),
  content TEXT NOT NULL,
  message_index INTEGER NOT NULL CHECK (message_index >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_session_index
  ON public.chat_messages (session_id, message_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_one_opening_summary_per_session
  ON public.chat_messages (session_id)
  WHERE metadata @> '{"auto_generated_opening_summary": true}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON public.chat_messages (session_id, created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION public.append_chat_message(
  p_session_id UUID,
  p_sender_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_next_index INTEGER;
  v_row public.chat_messages;
BEGIN
  IF p_sender_type NOT IN ('user', 'ai', 'system') THEN
    RAISE EXCEPTION 'invalid sender_type';
  END IF;

  IF COALESCE(BTRIM(p_content), '') = '' THEN
    RAISE EXCEPTION 'message content must not be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text));

  SELECT COALESCE(MAX(message_index), -1) + 1
    INTO v_next_index
    FROM public.chat_messages
    WHERE session_id = p_session_id;

  INSERT INTO public.chat_messages (
    session_id,
    sender_type,
    content,
    message_index,
    metadata
  )
  VALUES (
    p_session_id,
    p_sender_type,
    p_content,
    v_next_index,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  UPDATE public.chat_sessions
    SET
      last_message_at = v_row.created_at,
      updated_at = NOW()
    WHERE id = p_session_id;

  RETURN v_row;
END;
$$;

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.chat_sessions TO authenticated;
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_chat_message(UUID, TEXT, TEXT, JSONB) TO authenticated;

DROP POLICY IF EXISTS chat_sessions_select_visible ON public.chat_sessions;
CREATE POLICY chat_sessions_select_visible ON public.chat_sessions
  FOR SELECT TO authenticated
  USING (
    (
      role = 'client'
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

DROP POLICY IF EXISTS chat_messages_select_visible ON public.chat_messages;
CREATE POLICY chat_messages_select_visible ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_sessions s
      WHERE s.id = chat_messages.session_id
    )
  );

DROP POLICY IF EXISTS chat_messages_insert_visible ON public.chat_messages;
CREATE POLICY chat_messages_insert_visible ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_sessions s
      WHERE s.id = chat_messages.session_id
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
