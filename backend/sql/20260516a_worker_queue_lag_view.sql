ALTER TABLE public.intelligence_jobs
  DROP CONSTRAINT IF EXISTS intelligence_jobs_status_check;

ALTER TABLE public.intelligence_jobs
  ADD CONSTRAINT intelligence_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'success', 'failed', 'dead', 'enqueue_failed', 'running', 'retry'));

ALTER TABLE public.intelligence_jobs
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE OR REPLACE VIEW public.worker_queue_lag
WITH (security_invoker = true) AS
SELECT
  job_type,
  COUNT(*) FILTER (WHERE status = 'queued')      AS queued_count,
  COUNT(*) FILTER (WHERE status = 'processing')  AS processing_count,
  COUNT(*) FILTER (WHERE status = 'failed')      AS failed_count,
  COUNT(*) FILTER (WHERE status = 'dead')        AS dead_letter_count,
  MAX(
    EXTRACT(EPOCH FROM (NOW() - enqueued_at)) * 1000
  ) FILTER (WHERE status = 'queued')             AS max_lag_ms,
  AVG(
    EXTRACT(EPOCH FROM (NOW() - enqueued_at)) * 1000
  ) FILTER (WHERE status = 'queued')             AS avg_lag_ms
FROM public.intelligence_jobs
WHERE enqueued_at > NOW() - INTERVAL '1 hour'
GROUP BY job_type;

REVOKE ALL ON public.worker_queue_lag FROM PUBLIC;
REVOKE SELECT ON public.worker_queue_lag FROM anon, authenticated;
GRANT SELECT ON public.worker_queue_lag TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback:
-- DROP VIEW IF EXISTS public.worker_queue_lag;
