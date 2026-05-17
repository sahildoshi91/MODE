ALTER TABLE public.intelligence_jobs
  DROP CONSTRAINT IF EXISTS intelligence_jobs_status_check;

ALTER TABLE public.intelligence_jobs
  ADD CONSTRAINT intelligence_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'success', 'failed', 'dead', 'enqueue_failed', 'running', 'retry'));

ALTER TABLE public.intelligence_jobs
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE OR REPLACE VIEW public.worker_queue_lag AS
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

GRANT SELECT ON public.worker_queue_lag TO authenticated;
GRANT SELECT ON public.worker_queue_lag TO anon;
GRANT SELECT ON public.worker_queue_lag TO service_role;

-- Rollback:
-- DROP VIEW IF EXISTS public.worker_queue_lag;
