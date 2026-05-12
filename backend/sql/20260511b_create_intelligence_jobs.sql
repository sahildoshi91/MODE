CREATE TABLE IF NOT EXISTS public.intelligence_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'memory_write',
      'cache_invalidate',
      'chat_trace_log_emit',
      'trainer_escalation_notification',
      'conversation_summarization',
      'safety_flag_persistence'
    )
  ),
  trainer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'retry', 'success', 'failed')),
  priority TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT,
  rq_job_id TEXT,
  queue_name TEXT,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_type_status_enqueued
  ON public.intelligence_jobs (job_type, status, enqueued_at);

CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_trace_id
  ON public.intelligence_jobs (trace_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_trainer_status
  ON public.intelligence_jobs (trainer_id, status, enqueued_at DESC);

CREATE TABLE IF NOT EXISTS public.worker_job_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL REFERENCES public.intelligence_jobs(job_id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'retry', 'failed')),
  attempt_number INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_category TEXT,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_job_traces_trace_id
  ON public.worker_job_traces (trace_id);

CREATE INDEX IF NOT EXISTS idx_worker_job_traces_type_status_completed
  ON public.worker_job_traces (job_type, status, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_job_traces_trainer_completed
  ON public.worker_job_traces (trainer_id, completed_at DESC);

ALTER TABLE public.intelligence_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intelligence_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.worker_job_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_job_traces FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_jobs_select_tenant ON public.intelligence_jobs;
CREATE POLICY intelligence_jobs_select_tenant ON public.intelligence_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trainers t
      WHERE t.id::text = intelligence_jobs.trainer_id
        AND t.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id::text = intelligence_jobs.client_id
        AND c.user_id = auth.uid()
        AND c.assigned_trainer_id::text = intelligence_jobs.trainer_id
    )
  );

DROP POLICY IF EXISTS worker_job_traces_select_tenant ON public.worker_job_traces;
CREATE POLICY worker_job_traces_select_tenant ON public.worker_job_traces
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trainers t
      WHERE t.id::text = worker_job_traces.trainer_id
        AND t.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id::text = worker_job_traces.client_id
        AND c.user_id = auth.uid()
        AND c.assigned_trainer_id::text = worker_job_traces.trainer_id
    )
  );

GRANT SELECT ON public.intelligence_jobs TO authenticated;
GRANT SELECT ON public.worker_job_traces TO authenticated;

-- Rollback:
-- DROP TABLE IF EXISTS public.worker_job_traces;
-- DROP TABLE IF EXISTS public.intelligence_jobs;
