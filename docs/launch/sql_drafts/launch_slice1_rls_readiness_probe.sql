-- NOT APPLIED — HUMAN REVIEW REQUIRED
-- Launch Slice 1 RLS readiness probe.
-- This file is not a migration and must not be applied by automation.
-- Intended use: human DB owner runs read-only catalog checks against staging
-- after confirming the target Supabase project and backup posture.

-- Chat request-event drift check:
-- Existing migration 20260419 allowed:
--   ack, progress, delta, completed, failed, heartbeat
-- Current SSE encoder emits:
--   status, token, message_delta, done, error
-- Review all returned constraints and policies before drafting a real migration.
SELECT
  conname,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.conversation_ai_request_events'::regclass
ORDER BY conname;

SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('conversation_ai_requests', 'conversation_ai_request_events')
ORDER BY tablename, policyname;

-- Proposed migration sketch only:
-- 1. Drop the current event_type CHECK constraint by its inspected name.
-- 2. Add a replacement CHECK that includes historical values plus
--    status, token, message_delta, done, error.
-- 3. Replace trainer-only request/event policies with tenant-scoped policies
--    that also permit the assigned client actor where product intends client
--    event reads/writes.
-- 4. Add tenant-pair guardrails through existing assignment functions or
--    reviewed EXISTS checks against client_trainer_assignments.

WITH expected_tables(schema_name, table_name, launch_area) AS (
  VALUES
    ('public', 'user_accounts', 'accounts_onboarding'),
    ('public', 'user_roles', 'accounts_onboarding'),
    ('public', 'onboarding_states', 'accounts_onboarding'),
    ('public', 'trainer_profile_core', 'accounts_onboarding'),
    ('public', 'trainer_invite_codes', 'accounts_onboarding'),
    ('public', 'tenants', 'tenant_graph'),
    ('public', 'trainers', 'tenant_graph'),
    ('public', 'clients', 'tenant_graph'),
    ('public', 'client_trainer_assignments', 'tenant_graph'),
    ('public', 'conversations', 'chat_history'),
    ('public', 'conversation_messages', 'chat_history'),
    ('public', 'chat_sessions', 'chat_history'),
    ('public', 'chat_messages', 'chat_history'),
    ('public', 'conversation_usage_events', 'chat_history'),
    ('public', 'user_fitness_profiles', 'fitness_checkin'),
    ('public', 'daily_checkins', 'fitness_checkin'),
    ('public', 'generated_checkin_plans', 'fitness_checkin'),
    ('public', 'onboarding_answers', 'fitness_checkin'),
    ('public', 'trainer_personas', 'trainer_knowledge'),
    ('public', 'trainer_knowledge_documents', 'trainer_knowledge'),
    ('public', 'trainer_knowledge_entries', 'trainer_knowledge'),
    ('public', 'trainer_program_templates', 'trainer_knowledge'),
    ('public', 'trainer_faq_examples', 'trainer_knowledge'),
    ('public', 'coach_memory', 'trainer_knowledge'),
    ('public', 'intelligence_jobs', 'workers_observability'),
    ('public', 'worker_job_traces', 'workers_observability'),
    ('public', 'mobile_analytics_events', 'workers_observability'),
    ('public', 'account_deletion_requests', 'workers_observability'),
    ('public', 'storage_upload_grants', 'storage_lifecycle'),
    ('public', 'storage_object_ownership', 'storage_lifecycle')
),
rls_posture AS (
  SELECT
    e.launch_area,
    e.schema_name,
    e.table_name,
    c.oid IS NOT NULL AS table_exists,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    COUNT(p.oid) AS policy_count
  FROM expected_tables e
  LEFT JOIN pg_namespace n
    ON n.nspname = e.schema_name
  LEFT JOIN pg_class c
    ON c.relnamespace = n.oid
   AND c.relname = e.table_name
   AND c.relkind IN ('r', 'p')
  LEFT JOIN pg_policy p
    ON p.polrelid = c.oid
  GROUP BY e.launch_area, e.schema_name, e.table_name, c.oid, c.relrowsecurity, c.relforcerowsecurity
)
SELECT
  launch_area,
  schema_name,
  table_name,
  table_exists,
  rls_enabled,
  rls_forced,
  policy_count,
  CASE
    WHEN NOT table_exists THEN 'REVIEW_MISSING_OR_DEFERRED'
    WHEN NOT rls_enabled THEN 'BLOCKER_RLS_DISABLED'
    WHEN NOT rls_forced THEN 'BLOCKER_RLS_NOT_FORCED'
    WHEN policy_count = 0 THEN 'BLOCKER_NO_POLICIES'
    ELSE 'OK'
  END AS launch_status
FROM rls_posture
ORDER BY launch_area, schema_name, table_name;

-- Broad policy heuristic. Every row returned needs human review.
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    LOWER(COALESCE(qual, '')) IN ('true', '(true)')
    OR LOWER(COALESCE(with_check, '')) IN ('true', '(true)')
  )
ORDER BY schemaname, tablename, policyname;

-- Grants exposed to Data API roles. Every row should be intentional.
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'storage')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_schema, table_name, grantee, privilege_type;

-- Privileged RPC exposure heuristic. Every row needs human review.
SELECT
  routine_schema,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND (
    routine_name ILIKE '%service%'
    OR routine_name ILIKE '%security%'
    OR routine_name ILIKE '%storage%'
    OR routine_name ILIKE '%delete%'
    OR routine_name ILIKE '%rate_limit%'
  )
ORDER BY routine_schema, routine_name, grantee;

-- Supabase Storage policy posture for owner-supported review.
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename IN ('objects', 'buckets')
ORDER BY tablename, policyname;
