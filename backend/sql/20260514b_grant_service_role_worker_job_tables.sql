BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.intelligence_jobs TO service_role;
    GRANT SELECT, INSERT ON public.worker_job_traces TO service_role;
  END IF;
END $$;

COMMIT;

-- Rollback:
-- REVOKE SELECT, INSERT, UPDATE ON public.intelligence_jobs FROM service_role;
-- REVOKE SELECT, INSERT ON public.worker_job_traces FROM service_role;
