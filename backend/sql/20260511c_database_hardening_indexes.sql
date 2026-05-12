BEGIN;

-- Required by Phase B: tenant-scoped active conversation lookup.
CREATE INDEX IF NOT EXISTS idx_conversations_trainer_client
  ON public.conversations (trainer_id, client_id);

-- Required by Phase B: conversation history loads by client recency.
CREATE INDEX IF NOT EXISTS idx_conversations_client_created_desc
  ON public.conversations (client_id, created_at DESC);

-- Supports the current active-conversation query shape:
-- trainer_id + client_id + status, ordered by updated_at/created_at.
CREATE INDEX IF NOT EXISTS idx_conversations_trainer_client_status_updated_created
  ON public.conversations (trainer_id, client_id, status, updated_at DESC, created_at DESC);

-- Required by Phase B: bounded message history loads.
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_created_desc
  ON public.conversation_messages (conversation_id, created_at DESC, id DESC);

-- Chat-session history and append fallback query support.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_trainer_history
  ON public.chat_sessions (user_id, role, trainer_id, session_type, session_date DESC, last_message_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_message_index_desc
  ON public.chat_messages (session_id, message_index DESC);

-- Existing schema uses daily_checkins for readiness history, not readiness_scores.
CREATE INDEX IF NOT EXISTS idx_daily_checkins_client_created_desc
  ON public.daily_checkins (client_id, created_at DESC);

-- Optional directive tables. These blocks are no-ops until/if the tables exist.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_trainer_client_created ON public.messages (trainer_id, client_id, created_at)';
  END IF;

  IF to_regclass('public.user_digests') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_digests_trainer_client ON public.user_digests (trainer_id, client_id)';
  END IF;

  IF to_regclass('public.safety_flags') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_safety_flags_client_review_required ON public.safety_flags (client_id, trainer_review_required)';
  END IF;

  IF to_regclass('public.readiness_scores') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_readiness_scores_client_created_desc ON public.readiness_scores (client_id, created_at DESC)';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback:
-- DROP INDEX IF EXISTS public.idx_readiness_scores_client_created_desc;
-- DROP INDEX IF EXISTS public.idx_safety_flags_client_review_required;
-- DROP INDEX IF EXISTS public.idx_user_digests_trainer_client;
-- DROP INDEX IF EXISTS public.idx_messages_trainer_client_created;
-- DROP INDEX IF EXISTS public.idx_daily_checkins_client_created_desc;
-- DROP INDEX IF EXISTS public.idx_chat_messages_session_message_index_desc;
-- DROP INDEX IF EXISTS public.idx_chat_sessions_user_trainer_history;
-- DROP INDEX IF EXISTS public.idx_conversation_messages_conversation_created_desc;
-- DROP INDEX IF EXISTS public.idx_conversations_trainer_client_status_updated_created;
-- DROP INDEX IF EXISTS public.idx_conversations_client_created_desc;
-- DROP INDEX IF EXISTS public.idx_conversations_trainer_client;
