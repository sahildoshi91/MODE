BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  persona_name TEXT NOT NULL,
  tone_description TEXT,
  coaching_philosophy TEXT,
  communication_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_behavior JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_personas FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_personas_trainer_id ON public.trainer_personas (trainer_id);

COMMIT;
