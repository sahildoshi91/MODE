BEGIN;

ALTER TABLE public.intelligence_jobs
  DROP CONSTRAINT IF EXISTS intelligence_jobs_job_type_check;

ALTER TABLE public.intelligence_jobs
  ADD CONSTRAINT intelligence_jobs_job_type_check
  CHECK (
    job_type IN (
      'memory_write',
      'cache_invalidate',
      'chat_trace_log_emit',
      'trainer_escalation_notification',
      'conversation_summarization',
      'safety_flag_persistence',
      'account_deletion'
    )
  );

COMMIT;

-- Rollback:
-- ALTER TABLE public.intelligence_jobs DROP CONSTRAINT IF EXISTS intelligence_jobs_job_type_check;
-- ALTER TABLE public.intelligence_jobs
--   ADD CONSTRAINT intelligence_jobs_job_type_check
--   CHECK (
--     job_type IN (
--       'memory_write',
--       'cache_invalidate',
--       'chat_trace_log_emit',
--       'trainer_escalation_notification',
--       'conversation_summarization',
--       'safety_flag_persistence'
--     )
--   );
