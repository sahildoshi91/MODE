BEGIN;

CREATE TABLE IF NOT EXISTS public.storage_cleanup_job_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_source TEXT NOT NULL CHECK (run_source IN ('scheduled', 'manual', 'release_gate')),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  bucket TEXT NOT NULL,
  expired_upload_paths INTEGER NOT NULL DEFAULT 0 CHECK (expired_upload_paths >= 0),
  orphan_object_paths INTEGER NOT NULL DEFAULT 0 CHECK (orphan_object_paths >= 0),
  stale_ownership_paths INTEGER NOT NULL DEFAULT 0 CHECK (stale_ownership_paths >= 0),
  deleted_user_paths INTEGER NOT NULL DEFAULT 0 CHECK (deleted_user_paths >= 0),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  expected_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (expected_interval_minutes > 0),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_job_heartbeats_source_finished
  ON public.storage_cleanup_job_heartbeats (run_source, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_job_heartbeats_status_finished
  ON public.storage_cleanup_job_heartbeats (status, finished_at DESC);

ALTER TABLE public.storage_cleanup_job_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_cleanup_job_heartbeats FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.storage_cleanup_job_heartbeats FROM PUBLIC;
REVOKE ALL ON public.storage_cleanup_job_heartbeats FROM anon;
REVOKE ALL ON public.storage_cleanup_job_heartbeats FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON public.storage_cleanup_job_heartbeats TO service_role;
  END IF;
END $$;

COMMIT;
