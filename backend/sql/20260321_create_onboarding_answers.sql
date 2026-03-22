BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  source_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  confidence_score NUMERIC(4, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.onboarding_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_answers FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_onboarding_answers_client_id ON public.onboarding_answers (client_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_answers_conversation_id ON public.onboarding_answers (conversation_id);

COMMIT;
