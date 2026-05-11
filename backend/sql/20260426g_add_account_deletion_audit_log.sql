BEGIN;

CREATE TABLE IF NOT EXISTS public.account_deletion_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id UUID NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('client', 'trainer', 'mixed', 'unassigned')),
  deleted_record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.account_deletion_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_audits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_deletion_audits FROM PUBLIC;
REVOKE ALL ON public.account_deletion_audits FROM anon;
REVOKE ALL ON public.account_deletion_audits FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON public.account_deletion_audits TO service_role;
  END IF;
END $$;

COMMIT;
