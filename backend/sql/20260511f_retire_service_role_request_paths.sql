BEGIN;

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  deletion_request_id UUID,
  actor_role TEXT CHECK (actor_role IN ('client', 'trainer', 'mixed', 'unassigned')),
  deleted_record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_status
  ON public.account_deletion_requests (user_id, status, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_job_id
  ON public.account_deletion_requests (job_id);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.account_deletion_requests TO authenticated;

DROP POLICY IF EXISTS account_deletion_requests_select_own ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_select_own
  ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS account_deletion_requests_insert_own ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_insert_own
  ON public.account_deletion_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS account_deletion_requests_update_own_queued ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_update_own_queued
  ON public.account_deletion_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status IN ('queued', 'failed'))
  WITH CHECK (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_deletion_requests TO service_role;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_upload_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_object_ownership TO authenticated;

DROP POLICY IF EXISTS storage_upload_grants_owner_select ON public.storage_upload_grants;
CREATE POLICY storage_upload_grants_owner_select
  ON public.storage_upload_grants
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_upload_grants_owner_insert ON public.storage_upload_grants;
CREATE POLICY storage_upload_grants_owner_insert
  ON public.storage_upload_grants
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_upload_grants_owner_update ON public.storage_upload_grants;
CREATE POLICY storage_upload_grants_owner_update
  ON public.storage_upload_grants
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_upload_grants_owner_delete ON public.storage_upload_grants;
CREATE POLICY storage_upload_grants_owner_delete
  ON public.storage_upload_grants
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_object_ownership_owner_select ON public.storage_object_ownership;
CREATE POLICY storage_object_ownership_owner_select
  ON public.storage_object_ownership
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_object_ownership_owner_insert ON public.storage_object_ownership;
CREATE POLICY storage_object_ownership_owner_insert
  ON public.storage_object_ownership
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_object_ownership_owner_update ON public.storage_object_ownership;
CREATE POLICY storage_object_ownership_owner_update
  ON public.storage_object_ownership
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS storage_object_ownership_owner_delete ON public.storage_object_ownership;
CREATE POLICY storage_object_ownership_owner_delete
  ON public.storage_object_ownership
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

COMMIT;

-- Rollback:
-- DROP TABLE IF EXISTS public.account_deletion_requests;
