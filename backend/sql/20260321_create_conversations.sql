BEGIN;

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('onboarding', 'coach', 'workout_feedback')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  current_stage TEXT NOT NULL DEFAULT 'welcome',
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversations_trainer_id ON public.conversations (trainer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON public.conversations (client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations (status);

COMMIT;
