BEGIN;

CREATE TABLE IF NOT EXISTS public.client_trainer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ
);

ALTER TABLE public.client_trainer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_trainer_assignments FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_client_trainer_assignments_client_id ON public.client_trainer_assignments (client_id);
CREATE INDEX IF NOT EXISTS idx_client_trainer_assignments_trainer_id ON public.client_trainer_assignments (trainer_id);

COMMIT;
