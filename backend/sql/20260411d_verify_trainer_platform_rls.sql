-- Verification-only script for trainer platform hardening rollout.
-- Run after:
-- 1) 20260411_create_trainer_rules_and_versions.sql
-- 2) 20260411b_create_trainer_talking_points_and_memory_indexes.sql
-- 3) 20260411c_create_ai_review_outputs_and_feedback.sql

-- 1) Confirm required tables exist.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'trainer_rules',
    'trainer_rule_versions',
    'trainer_talking_points',
    'ai_generated_outputs',
    'ai_feedback_events'
  )
ORDER BY table_name;

-- 2) Confirm RLS is enabled and forced.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n
  ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'trainer_rules',
    'trainer_rule_versions',
    'trainer_talking_points',
    'ai_generated_outputs',
    'ai_feedback_events'
  )
ORDER BY c.relname;

-- 3) Confirm expected policies exist.
SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'trainer_rules',
    'trainer_rule_versions',
    'trainer_talking_points',
    'ai_generated_outputs',
    'ai_feedback_events'
  )
ORDER BY tablename, policyname;
