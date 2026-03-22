BEGIN;

CREATE TABLE IF NOT EXISTS public.trainers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainers FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainers_tenant_id ON public.trainers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trainers_user_id ON public.trainers (user_id);

COMMIT;
