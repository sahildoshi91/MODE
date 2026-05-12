BEGIN;

DO $$
DECLARE
  missing_indexes TEXT[];
  rls_gaps TEXT[];
BEGIN
  SELECT ARRAY_AGG(required.index_name ORDER BY required.index_name)
    INTO missing_indexes
  FROM (
    VALUES
      ('idx_conversations_trainer_client'),
      ('idx_conversations_client_created_desc'),
      ('idx_conversation_messages_conversation_created_desc'),
      ('idx_trainer_knowledge_entries_trainer_status'),
      ('idx_intelligence_jobs_type_status_enqueued')
  ) AS required(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.indexname = required.index_name
  );

  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Phase B index verification failed. Missing indexes: %', missing_indexes;
  END IF;

  SELECT ARRAY_AGG(c.relname ORDER BY c.relname)
    INTO rls_gaps
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (
      ARRAY[
        'conversations',
        'conversation_messages',
        'chat_sessions',
        'chat_messages',
        'coach_memory',
        'trainer_knowledge_entries',
        'daily_checkins',
        'intelligence_jobs',
        'worker_job_traces'
      ]::text[]
    )
    AND (c.relrowsecurity IS DISTINCT FROM TRUE OR c.relforcerowsecurity IS DISTINCT FROM TRUE);

  IF rls_gaps IS NOT NULL THEN
    RAISE EXCEPTION 'Phase B RLS verification failed. Tables without RLS enabled+forced: %', rls_gaps;
  END IF;
END $$;

-- Cross-tenant runtime tests require seeded tenant A/B auth subjects. Template:
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config(
--   'request.jwt.claims',
--   '{"sub":"<trainer_or_client_auth_user_id>","trainer_id":"<trainer_A>","client_id":"<client_1>"}',
--   true
-- );
-- SELECT COUNT(*) FROM public.conversations WHERE trainer_id = '<trainer_A>' AND client_id = '<client_1>';
-- SELECT COUNT(*) FROM public.conversations WHERE trainer_id = '<trainer_B>';
-- ROLLBACK;

ROLLBACK;
