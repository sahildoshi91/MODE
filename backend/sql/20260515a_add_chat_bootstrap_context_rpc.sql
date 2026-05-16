BEGIN;

CREATE OR REPLACE FUNCTION public.chat_bootstrap_context()
RETURNS TABLE (
  tenant_id UUID,
  trainer_id UUID,
  trainer_user_id UUID,
  trainer_display_name TEXT,
  client_id UUID,
  client_user_id UUID,
  persona_id UUID,
  persona_name TEXT,
  trainer_onboarding_completed BOOLEAN,
  trainer_onboarding_status TEXT,
  trainer_onboarding_completed_steps INTEGER,
  trainer_onboarding_total_steps INTEGER,
  trainer_onboarding_last_step TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH trainer_match AS (
  SELECT
    t.tenant_id,
    t.id AS trainer_id,
    t.user_id AS trainer_user_id,
    t.display_name AS trainer_display_name,
    NULL::UUID AS client_id,
    NULL::UUID AS client_user_id
  FROM public.trainers t
  WHERE t.user_id = auth.uid()
  ORDER BY t.created_at DESC
  LIMIT 1
),
client_match AS (
  SELECT
    c.tenant_id,
    c.assigned_trainer_id AS trainer_id,
    t.user_id AS trainer_user_id,
    t.display_name AS trainer_display_name,
    c.id AS client_id,
    c.user_id AS client_user_id
  FROM public.clients c
  LEFT JOIN public.trainers t
    ON t.id = c.assigned_trainer_id
  WHERE c.user_id = auth.uid()
  ORDER BY
    CASE WHEN c.assigned_trainer_id IS NULL THEN 0 ELSE 1 END DESC,
    c.created_at DESC
  LIMIT 1
),
active_context AS (
  SELECT 0 AS priority, * FROM trainer_match
  UNION ALL
  SELECT 1 AS priority, * FROM client_match
  ORDER BY priority
  LIMIT 1
),
persona AS (
  SELECT
    p.id,
    p.persona_name,
    p.onboarding_preferences
  FROM public.trainer_personas p
  JOIN active_context ac
    ON ac.trainer_id = p.trainer_id
  WHERE p.is_default IS TRUE
  ORDER BY p.created_at DESC
  LIMIT 1
),
onboarding AS (
  SELECT
    op.onboarding_status,
    op.onboarding_progress,
    op.last_completed_step
  FROM public.trainer_onboarding_profiles op
  JOIN active_context ac
    ON ac.trainer_id = op.trainer_id
  LIMIT 1
),
normalized AS (
  SELECT
    ac.*,
    persona.id AS persona_id,
    persona.persona_name,
    COALESCE(
      LOWER(persona.onboarding_preferences->>'trainer_onboarding_completed') IN ('true', '1', 'yes'),
      FALSE
    ) AS fallback_completed,
    COALESCE(NULLIF(LOWER(onboarding.onboarding_status), ''), 'not_started') AS raw_status,
    onboarding.onboarding_progress,
    onboarding.last_completed_step
  FROM active_context ac
  LEFT JOIN persona ON TRUE
  LEFT JOIN onboarding ON TRUE
),
progress AS (
  SELECT
    *,
    CASE
      WHEN onboarding_progress->>'total_steps' ~ '^[0-9]+$'
        THEN GREATEST((onboarding_progress->>'total_steps')::INTEGER, 1)
      ELSE 8
    END AS total_steps,
    CASE
      WHEN onboarding_progress->>'completed_steps' ~ '^[0-9]+$'
        THEN GREATEST((onboarding_progress->>'completed_steps')::INTEGER, 0)
      WHEN fallback_completed THEN 8
      ELSE 0
    END AS raw_completed_steps
  FROM normalized
)
SELECT
  p.tenant_id,
  p.trainer_id,
  p.trainer_user_id,
  p.trainer_display_name,
  p.client_id,
  p.client_user_id,
  p.persona_id,
  p.persona_name,
  (p.fallback_completed OR p.raw_status = 'completed') AS trainer_onboarding_completed,
  CASE
    WHEN p.fallback_completed OR p.raw_status = 'completed' THEN 'completed'
    WHEN p.raw_status IN ('not_started', 'in_progress', 'calibration_pending') THEN p.raw_status
    ELSE 'not_started'
  END AS trainer_onboarding_status,
  CASE
    WHEN p.fallback_completed OR p.raw_status = 'completed' THEN p.total_steps
    ELSE LEAST(p.raw_completed_steps, p.total_steps)
  END AS trainer_onboarding_completed_steps,
  p.total_steps AS trainer_onboarding_total_steps,
  p.last_completed_step AS trainer_onboarding_last_step
FROM progress p;
$$;

REVOKE ALL ON FUNCTION public.chat_bootstrap_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_bootstrap_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_bootstrap_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_bootstrap_context() TO service_role;

COMMENT ON FUNCTION public.chat_bootstrap_context()
IS 'Returns the authenticated user chat tenant/client/trainer bootstrap context in one RLS-protected SECURITY INVOKER round trip.';

COMMIT;
