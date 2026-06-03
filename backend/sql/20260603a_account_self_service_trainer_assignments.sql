BEGIN;

ALTER TABLE public.client_trainer_assignments
  ADD COLUMN IF NOT EXISTS unassigned_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unassigned_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Dry-run only. Review this output before any human-approved data cleanup.
-- Do not replace this SELECT with a closing UPDATE in staging/prod without review.
WITH duplicate_active_assignments AS (
  SELECT
    cta.client_id,
    COUNT(*) AS active_count,
    MAX(cta.assigned_at) AS newest_assigned_at
  FROM public.client_trainer_assignments cta
  WHERE cta.unassigned_at IS NULL
  GROUP BY cta.client_id
  HAVING COUNT(*) > 1
),
rows_that_would_close AS (
  SELECT
    cta.id,
    cta.client_id,
    cta.trainer_id,
    cta.assigned_at,
    daa.active_count,
    daa.newest_assigned_at,
    CASE
      WHEN cta.assigned_at = daa.newest_assigned_at THEN FALSE
      ELSE TRUE
    END AS would_close
  FROM public.client_trainer_assignments cta
  JOIN duplicate_active_assignments daa
    ON daa.client_id = cta.client_id
  WHERE cta.unassigned_at IS NULL
)
SELECT
  'dry_run_duplicate_active_client_trainer_assignments' AS audit_name,
  *
FROM rows_that_would_close
ORDER BY client_id, would_close DESC, assigned_at DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_trainer_assignments_one_active_per_client
  ON public.client_trainer_assignments (client_id)
  WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS public.trainer_assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'assigned_by_invite',
      'unassigned_for_reassign',
      'client_self_detach'
    )
  ),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_assignment_events FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_assignment_events_client_created
  ON public.trainer_assignment_events (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trainer_assignment_events_trainer_created
  ON public.trainer_assignment_events (trainer_id, created_at DESC);

REVOKE ALL ON public.trainer_assignment_events FROM PUBLIC;
REVOKE ALL ON public.trainer_assignment_events FROM anon;
REVOKE ALL ON public.trainer_assignment_events FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON public.trainer_assignment_events TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.account_self_detach_trainer_assignment(
  p_user_id UUID
)
RETURNS TABLE (
  client_id UUID,
  trainer_id UUID,
  event_type TEXT,
  previous_trainer_id UUID,
  target_client_id UUID,
  target_trainer_id UUID,
  event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_assigned RECORD;
  v_closed RECORD;
  v_client_closed_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  PERFORM 1
  FROM public.clients c
  WHERE c.user_id = p_user_id
  FOR UPDATE;

  FOR v_assigned IN
    SELECT
      c.id AS client_id,
      c.assigned_trainer_id AS trainer_id
    FROM public.clients c
    WHERE c.user_id = p_user_id
      AND c.assigned_trainer_id IS NOT NULL
    ORDER BY c.created_at DESC
  LOOP
    v_client_closed_count := 0;

    FOR v_closed IN
      UPDATE public.client_trainer_assignments cta
      SET
        unassigned_at = COALESCE(cta.unassigned_at, v_now),
        unassigned_by_user_id = p_user_id,
        unassigned_reason = 'client_self_detach',
        updated_at = v_now
      WHERE cta.client_id = v_assigned.client_id
        AND cta.unassigned_at IS NULL
      RETURNING cta.client_id, cta.trainer_id
    LOOP
      v_client_closed_count := v_client_closed_count + 1;

      INSERT INTO public.trainer_assignment_events (
        trainer_id,
        client_id,
        actor_user_id,
        event_type,
        reason,
        metadata,
        created_at
      )
      VALUES (
        v_closed.trainer_id,
        v_closed.client_id,
        p_user_id,
        'client_self_detach',
        'client_self_detach',
        jsonb_build_object('source', 'account_settings'),
        v_now
      )
      RETURNING id INTO event_id;

      client_id := v_closed.client_id;
      trainer_id := v_closed.trainer_id;
      event_type := 'client_self_detach';
      previous_trainer_id := v_closed.trainer_id;
      target_client_id := NULL;
      target_trainer_id := NULL;
      RETURN NEXT;
    END LOOP;

    IF v_client_closed_count = 0 THEN
      INSERT INTO public.trainer_assignment_events (
        trainer_id,
        client_id,
        actor_user_id,
        event_type,
        reason,
        metadata,
        created_at
      )
      VALUES (
        v_assigned.trainer_id,
        v_assigned.client_id,
        p_user_id,
        'client_self_detach',
        'client_self_detach',
        jsonb_build_object('source', 'account_settings', 'history_gap', TRUE),
        v_now
      )
      RETURNING id INTO event_id;

      client_id := v_assigned.client_id;
      trainer_id := v_assigned.trainer_id;
      event_type := 'client_self_detach';
      previous_trainer_id := v_assigned.trainer_id;
      target_client_id := NULL;
      target_trainer_id := NULL;
      RETURN NEXT;
    END IF;
  END LOOP;

  UPDATE public.clients c
  SET assigned_trainer_id = NULL
  WHERE c.user_id = p_user_id
    AND c.assigned_trainer_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_reassign_trainer_by_invite(
  p_user_id UUID,
  p_invite_id UUID,
  p_trainer_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  client_id UUID,
  trainer_id UUID,
  event_type TEXT,
  previous_trainer_id UUID,
  target_client_id UUID,
  target_trainer_id UUID,
  event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_target_client_id UUID;
  v_source_client_id UUID;
  v_profile_id UUID;
  v_invite_id UUID;
  v_closed RECORD;
  v_closed_count INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_invite_id IS NULL OR p_trainer_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'user, invite, trainer, and tenant are required';
  END IF;

  SELECT tic.id
  INTO v_invite_id
  FROM public.trainer_invite_codes tic
  JOIN public.trainers t
    ON t.id = tic.trainer_id
  WHERE tic.id = p_invite_id
    AND tic.trainer_id = p_trainer_id
    AND tic.tenant_id = p_tenant_id
    AND tic.is_active IS TRUE
    AND tic.used_at IS NULL
    AND tic.revoked_at IS NULL
    AND (tic.expires_at IS NULL OR tic.expires_at > v_now)
    AND t.is_active IS TRUE
  FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite code is inactive';
  END IF;

  PERFORM 1
  FROM public.clients c
  WHERE c.user_id = p_user_id
  FOR UPDATE;

  INSERT INTO public.clients (
    tenant_id,
    user_id,
    assigned_trainer_id
  )
  VALUES (
    p_tenant_id,
    p_user_id,
    p_trainer_id
  )
  ON CONFLICT ON CONSTRAINT clients_tenant_id_user_id_key DO UPDATE
    SET assigned_trainer_id = EXCLUDED.assigned_trainer_id
  RETURNING id INTO v_target_client_id;

  SELECT c.id
  INTO v_source_client_id
  FROM public.clients c
  JOIN public.user_fitness_profiles ufp
    ON ufp.client_id = c.id
  LEFT JOIN public.tenants tenant
    ON tenant.id = c.tenant_id
  WHERE c.user_id = p_user_id
    AND c.id <> v_target_client_id
  ORDER BY
    CASE WHEN tenant.slug = 'mode-self-guided' THEN 0 ELSE 1 END,
    c.created_at DESC
  LIMIT 1;

  FOR v_closed IN
    UPDATE public.client_trainer_assignments cta
    SET
      unassigned_at = COALESCE(cta.unassigned_at, v_now),
      unassigned_by_user_id = p_user_id,
      unassigned_reason = 'client_reassigned_by_invite',
      updated_at = v_now
    FROM public.clients c
    WHERE cta.client_id = c.id
      AND c.user_id = p_user_id
      AND cta.unassigned_at IS NULL
    RETURNING cta.client_id, cta.trainer_id
  LOOP
    v_closed_count := v_closed_count + 1;

    INSERT INTO public.trainer_assignment_events (
      trainer_id,
      client_id,
      actor_user_id,
      event_type,
      reason,
      metadata,
      created_at
    )
    VALUES (
      v_closed.trainer_id,
      v_closed.client_id,
      p_user_id,
      'unassigned_for_reassign',
      'client_reassigned_by_invite',
      jsonb_build_object(
        'source', 'account_settings',
        'target_client_id', v_target_client_id,
        'target_trainer_id', p_trainer_id
      ),
      v_now
    )
    RETURNING id INTO event_id;

    client_id := v_closed.client_id;
    trainer_id := v_closed.trainer_id;
    event_type := 'unassigned_for_reassign';
    previous_trainer_id := v_closed.trainer_id;
    target_client_id := v_target_client_id;
    target_trainer_id := p_trainer_id;
    RETURN NEXT;
  END LOOP;

  UPDATE public.clients c
  SET assigned_trainer_id = CASE
    WHEN c.id = v_target_client_id THEN p_trainer_id
    ELSE NULL
  END
  WHERE c.user_id = p_user_id;

  INSERT INTO public.client_trainer_assignments (
    client_id,
    trainer_id,
    assigned_at,
    updated_at
  )
  VALUES (
    v_target_client_id,
    p_trainer_id,
    v_now,
    v_now
  );

  IF v_source_client_id IS NOT NULL AND v_source_client_id <> v_target_client_id THEN
    INSERT INTO public.user_fitness_profiles (
      client_id,
      primary_goal,
      is_training_for_event,
      event_type,
      event_name,
      event_date,
      injuries_present,
      injury_notes,
      equipment_access,
      workout_frequency_target,
      experience_level,
      preferred_session_length,
      current_mode,
      onboarding_status,
      training_location,
      minimum_win,
      weekly_availability,
      onboarding_completed_at,
      onboarding_last_step,
      created_at,
      updated_at
    )
    SELECT
      v_target_client_id,
      ufp.primary_goal,
      ufp.is_training_for_event,
      ufp.event_type,
      ufp.event_name,
      ufp.event_date,
      ufp.injuries_present,
      ufp.injury_notes,
      ufp.equipment_access,
      ufp.workout_frequency_target,
      ufp.experience_level,
      ufp.preferred_session_length,
      ufp.current_mode,
      COALESCE(ufp.onboarding_status, 'not_started'),
      ufp.training_location,
      ufp.minimum_win,
      ufp.weekly_availability,
      ufp.onboarding_completed_at,
      ufp.onboarding_last_step,
      v_now,
      v_now
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = v_source_client_id
    ON CONFLICT ON CONSTRAINT user_fitness_profiles_client_id_key DO NOTHING
    RETURNING id INTO v_profile_id;

    UPDATE public.user_fitness_profiles target
    SET
      primary_goal = COALESCE(target.primary_goal, source.primary_goal),
      is_training_for_event = COALESCE(target.is_training_for_event, source.is_training_for_event),
      event_type = COALESCE(target.event_type, source.event_type),
      event_name = COALESCE(target.event_name, source.event_name),
      event_date = COALESCE(target.event_date, source.event_date),
      injuries_present = COALESCE(target.injuries_present, source.injuries_present),
      injury_notes = COALESCE(target.injury_notes, source.injury_notes),
      equipment_access = COALESCE(target.equipment_access, source.equipment_access),
      workout_frequency_target = COALESCE(target.workout_frequency_target, source.workout_frequency_target),
      experience_level = COALESCE(target.experience_level, source.experience_level),
      preferred_session_length = COALESCE(target.preferred_session_length, source.preferred_session_length),
      current_mode = COALESCE(target.current_mode, source.current_mode),
      training_location = COALESCE(target.training_location, source.training_location),
      minimum_win = COALESCE(target.minimum_win, source.minimum_win),
      weekly_availability = COALESCE(target.weekly_availability, source.weekly_availability),
      onboarding_completed_at = COALESCE(target.onboarding_completed_at, source.onboarding_completed_at),
      onboarding_last_step = COALESCE(target.onboarding_last_step, source.onboarding_last_step),
      updated_at = v_now
    FROM public.user_fitness_profiles source
    WHERE target.client_id = v_target_client_id
      AND source.client_id = v_source_client_id
      AND source.client_id <> target.client_id;
  END IF;

  INSERT INTO public.user_fitness_profiles (
    client_id,
    onboarding_status,
    created_at,
    updated_at
  )
  VALUES (
    v_target_client_id,
    'not_started',
    v_now,
    v_now
  )
  ON CONFLICT ON CONSTRAINT user_fitness_profiles_client_id_key DO NOTHING
  RETURNING id INTO v_profile_id;

  UPDATE public.trainer_invite_codes tic
  SET
    is_active = FALSE,
    used_at = v_now,
    used_by_user_id = p_user_id,
    updated_at = v_now
  WHERE tic.id = p_invite_id
    AND tic.trainer_id = p_trainer_id
    AND tic.tenant_id = p_tenant_id
    AND tic.is_active IS TRUE
    AND tic.used_at IS NULL
    AND tic.revoked_at IS NULL
  RETURNING tic.id INTO v_invite_id;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite code is inactive';
  END IF;

  INSERT INTO public.trainer_assignment_events (
    trainer_id,
    client_id,
    actor_user_id,
    event_type,
    reason,
    metadata,
    created_at
  )
  VALUES (
    p_trainer_id,
    v_target_client_id,
    p_user_id,
    'assigned_by_invite',
    'client_reassigned_by_invite',
    jsonb_build_object(
      'source', 'account_settings',
      'invite_id', p_invite_id,
      'closed_assignment_count', v_closed_count
    ),
    v_now
  )
  RETURNING id INTO event_id;

  client_id := v_target_client_id;
  trainer_id := p_trainer_id;
  event_type := 'assigned_by_invite';
  previous_trainer_id := NULL;
  target_client_id := v_target_client_id;
  target_trainer_id := p_trainer_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.account_self_detach_trainer_assignment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_self_detach_trainer_assignment(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.account_self_detach_trainer_assignment(UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.account_self_detach_trainer_assignment(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.account_self_detach_trainer_assignment(UUID)
IS 'Service-role account self-service RPC: atomically detaches a client from current trainers, audits events, and preserves client-owned data.';

COMMENT ON FUNCTION public.account_reassign_trainer_by_invite(UUID, UUID, UUID, UUID)
IS 'Service-role account self-service RPC: atomically consumes an invite, closes old trainer access, assigns the target trainer, audits events, and preserves portable client data.';

COMMIT;
