BEGIN;

CREATE TABLE IF NOT EXISTS public.unanswered_question_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  user_question TEXT NOT NULL,
  model_draft_answer TEXT,
  confidence_score NUMERIC(4, 3),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.unanswered_question_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unanswered_question_queue FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_unanswered_question_queue_trainer_id ON public.unanswered_question_queue (trainer_id);
CREATE INDEX IF NOT EXISTS idx_unanswered_question_queue_status ON public.unanswered_question_queue (status);

COMMIT;
