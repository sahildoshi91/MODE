BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id_id
  ON public.conversation_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS public.conversation_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  thoughts_tokens INTEGER NOT NULL DEFAULT 0 CHECK (thoughts_tokens >= 0),
  route_flow TEXT,
  route_reason TEXT,
  task_type TEXT,
  response_mode TEXT,
  fallback_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT conversation_usage_events_message_belongs_to_conversation
    FOREIGN KEY (conversation_id, message_id)
    REFERENCES public.conversation_messages(conversation_id, id)
    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_usage_events_conversation_id
  ON public.conversation_usage_events (conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_usage_events_provider_model_created_at
  ON public.conversation_usage_events (provider, model, created_at DESC);

ALTER TABLE public.conversation_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_usage_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.conversation_usage_events TO authenticated;

DROP POLICY IF EXISTS conversation_usage_events_select_visible ON public.conversation_usage_events;
CREATE POLICY conversation_usage_events_select_visible ON public.conversation_usage_events
  FOR SELECT TO authenticated
  USING (public.auth_can_access_conversation(conversation_id));

DROP POLICY IF EXISTS conversation_usage_events_insert_visible ON public.conversation_usage_events;
CREATE POLICY conversation_usage_events_insert_visible ON public.conversation_usage_events
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_access_conversation(conversation_id));

CREATE OR REPLACE VIEW public.conversation_usage_summary
WITH (security_invoker = on) AS
WITH usage_base AS (
  SELECT
    e.conversation_id,
    e.provider,
    e.model,
    e.prompt_tokens,
    e.completion_tokens,
    e.total_tokens,
    e.thoughts_tokens,
    e.created_at
  FROM public.conversation_usage_events e
),
last_usage AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id,
    provider AS last_execution_provider,
    model AS last_execution_model,
    created_at AS last_usage_at
  FROM usage_base
  ORDER BY conversation_id, created_at DESC, model DESC
)
SELECT
  b.conversation_id,
  COALESCE(SUM(b.prompt_tokens), 0)::INTEGER AS total_prompt_tokens,
  COALESCE(SUM(b.completion_tokens), 0)::INTEGER AS total_completion_tokens,
  COALESCE(SUM(b.total_tokens), 0)::INTEGER AS total_tokens,
  COALESCE(SUM(b.thoughts_tokens), 0)::INTEGER AS total_thoughts_tokens,
  COUNT(*)::INTEGER AS usage_event_count,
  COALESCE(ARRAY_AGG(DISTINCT b.model) FILTER (WHERE b.model IS NOT NULL), ARRAY[]::TEXT[]) AS models_used,
  COALESCE(ARRAY_AGG(DISTINCT b.provider) FILTER (WHERE b.provider IS NOT NULL), ARRAY[]::TEXT[]) AS providers_used,
  l.last_execution_provider,
  l.last_execution_model,
  l.last_usage_at
FROM usage_base b
LEFT JOIN last_usage l
  ON l.conversation_id = b.conversation_id
GROUP BY
  b.conversation_id,
  l.last_execution_provider,
  l.last_execution_model,
  l.last_usage_at;

GRANT SELECT ON public.conversation_usage_summary TO authenticated;

COMMIT;
