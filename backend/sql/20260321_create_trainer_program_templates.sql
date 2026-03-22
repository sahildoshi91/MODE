BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_program_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT,
  experience_level TEXT,
  equipment_access TEXT,
  frequency INTEGER,
  template_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_program_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_program_templates FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_program_templates_trainer_id ON public.trainer_program_templates (trainer_id);

COMMIT;
