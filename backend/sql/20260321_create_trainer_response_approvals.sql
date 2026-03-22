BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_response_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.unanswered_question_queue(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  approved_answer TEXT NOT NULL,
  response_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_response_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_response_approvals FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_response_approvals_queue_id ON public.trainer_response_approvals (queue_id);
CREATE INDEX IF NOT EXISTS idx_trainer_response_approvals_trainer_id ON public.trainer_response_approvals (trainer_id);

COMMIT;
