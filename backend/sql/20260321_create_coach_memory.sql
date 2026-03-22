BEGIN;

CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_memory FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_coach_memory_trainer_id ON public.coach_memory (trainer_id);
CREATE INDEX IF NOT EXISTS idx_coach_memory_client_id ON public.coach_memory (client_id);

COMMIT;
