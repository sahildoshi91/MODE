BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_faq_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  approved_answer TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_faq_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_faq_examples FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_faq_examples_trainer_id ON public.trainer_faq_examples (trainer_id);

COMMIT;
