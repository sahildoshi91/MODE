-- Verification-only script for trainer platform hardening rollout.
-- Run after:
-- 1) 20260411_create_trainer_rules_and_versions.sql
-- 2) 20260411b_create_trainer_talking_points_and_memory_indexes.sql
-- 3) 20260411c_create_ai_review_outputs_and_feedback.sql
-- 4) 20260412_fix_coach_memory_internal_visibility_rls.sql

-- 1) Confirm required tables exist.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'coach_memory',
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
    'coach_memory',
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
    'coach_memory',
    'trainer_rules',
    'trainer_rule_versions',
    'trainer_talking_points',
    'ai_generated_outputs',
    'ai_feedback_events'
  )
ORDER BY tablename, policyname;

-- 4) Inspect the coach_memory SELECT policy expression directly.
SELECT
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'coach_memory'
  AND policyname = 'coach_memory_select_visible'
ORDER BY tablename, policyname;

-- 5) Fail hard if coach_memory still uses the legacy client-visible predicate.
DO $$
DECLARE
  coach_memory_rls_enabled BOOLEAN;
  coach_memory_rls_forced BOOLEAN;
  coach_memory_policy_qual TEXT;
  normalized_qual TEXT;
BEGIN
  SELECT
    c.relrowsecurity,
    c.relforcerowsecurity
  INTO
    coach_memory_rls_enabled,
    coach_memory_rls_forced
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'coach_memory';

  IF coach_memory_rls_enabled IS DISTINCT FROM TRUE
     OR coach_memory_rls_forced IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'coach_memory verification failed: expected RLS enabled+forced, got enabled=% forced=%',
      coach_memory_rls_enabled,
      coach_memory_rls_forced;
  END IF;

  SELECT qual
  INTO coach_memory_policy_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'coach_memory'
    AND policyname = 'coach_memory_select_visible'
    AND cmd = 'SELECT';

  IF coach_memory_policy_qual IS NULL THEN
    RAISE EXCEPTION
      'coach_memory verification failed: policy coach_memory_select_visible is missing';
  END IF;

  -- pg_policies.qual is deparsed by Postgres and may omit schema prefixes or
  -- inject ::text casts and extra parentheses. Normalize those details away so
  -- we verify the hardened predicate semantically instead of by one exact form.
  normalized_qual := lower(coach_memory_policy_qual);
  normalized_qual := regexp_replace(normalized_qual, '\s+', '', 'g');
  normalized_qual := regexp_replace(normalized_qual, 'public\.', '', 'g');
  normalized_qual := regexp_replace(normalized_qual, '::text', '', 'g');

  IF normalized_qual LIKE '%auth_can_view_client(client_id)%' THEN
    RAISE EXCEPTION
      'coach_memory verification failed: legacy auth_can_view_client(client_id) predicate is still present';
  END IF;

  IF normalized_qual !~ 'auth_is_trainer_user\(trainer_id\)'
     OR normalized_qual !~ 'auth_is_client_user\(client_id\)'
     OR normalized_qual !~ 'coalesce\(lower\(\(*value_json->>''visibility''\)*\),''internal_only''\)<>''internal_only''' THEN
    RAISE EXCEPTION
      'coach_memory verification failed: policy predicate is missing the hardened visibility guard. qual=%',
      coach_memory_policy_qual;
  END IF;
END $$;
