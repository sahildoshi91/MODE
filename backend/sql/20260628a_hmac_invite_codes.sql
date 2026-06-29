BEGIN;

-- Allow code column to be NULL so new HMAC rows don't store plaintext.
ALTER TABLE public.trainer_invite_codes
  ALTER COLUMN code DROP NOT NULL;

-- Allow code_hash to be NULL temporarily; it is NOT NULL in prod from the prior
-- migration but new rows will always populate it, and we recreate the index below.
ALTER TABLE public.trainer_invite_codes
  ALTER COLUMN code_hash DROP NOT NULL;

-- Add pepper identifier so future pepper rotation can scope which rows are affected.
ALTER TABLE public.trainer_invite_codes
  ADD COLUMN IF NOT EXISTS hmac_pepper_id TEXT;

-- Revoke all outstanding plain-SHA256 rows in one scoped update.
-- These rows pre-date HMAC keying and cannot be safely redeemed against the new scheme.
UPDATE public.trainer_invite_codes
SET
  revoked_at = NOW(),
  is_active   = FALSE
WHERE
  used_at       IS NULL
  AND revoked_at IS NULL
  AND hmac_pepper_id IS NULL;

-- Drop the old unconditional unique index; replace it with a partial index that
-- allows NULL code_hash (revoked old rows may retain their SHA-256 hash).
DROP INDEX IF EXISTS idx_trainer_invite_codes_code_hash_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_invite_codes_code_hash_unique
  ON public.trainer_invite_codes (code_hash)
  WHERE code_hash IS NOT NULL;

-- Fast lookup path for HMAC redemption.
DROP INDEX IF EXISTS idx_trainer_invite_codes_active_hash_lookup;
CREATE INDEX IF NOT EXISTS idx_trainer_invite_codes_hmac_active_lookup
  ON public.trainer_invite_codes (code_hash, hmac_pepper_id, is_active, expires_at)
  WHERE code_hash IS NOT NULL AND hmac_pepper_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- redeem_invite_code RPC
-- Atomically looks up an invite by HMAC-SHA256 code hash, locks the row,
-- closes any existing trainer assignments for the user, assigns the target
-- trainer, and marks the invite consumed. Two concurrent calls with the same
-- code produce exactly one success; the second receives 'invite code is
-- inactive'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invite_code(
  p_user_id        UUID,
  p_code_hmac      TEXT,
  p_hmac_pepper_id TEXT
)
RETURNS TABLE (
  client_id        UUID,
  trainer_id       UUID,
  event_type       TEXT,
  previous_trainer_id  UUID,
  target_client_id UUID,
  target_trainer_id    UUID,
  event_id         UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_invite_id      UUID;
  v_trainer_id     UUID;
  v_tenant_id      UUID;
  v_target_client_id UUID;
  v_source_client_id UUID;
  v_profile_id     UUID;
  v_closed         RECORD;
  v_closed_count   INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_code_hmac IS NULL OR p_hmac_pepper_id IS NULL THEN
    RAISE EXCEPTION 'user, code hmac, and pepper id are required';
  END IF;

  -- Lock the invite row atomically. If two requests arrive simultaneously,
  -- the second will wait here; once the first commits and marks is_active=FALSE,
  -- the second's WHERE clause will not match and v_invite_id remains NULL.
  SELECT tic.id, tic.trainer_id, tic.tenant_id
  INTO v_invite_id, v_trainer_id, v_tenant_id
  FROM public.trainer_invite_codes tic
  JOIN public.trainers t ON t.id = tic.trainer_id
  WHERE tic.code_hash       = p_code_hmac
    AND tic.hmac_pepper_id  = p_hmac_pepper_id
    AND tic.is_active       IS TRUE
    AND tic.used_at         IS NULL
    AND tic.revoked_at      IS NULL
    AND (tic.expires_at IS NULL OR tic.expires_at > v_now)
    AND t.is_active         IS TRUE
  FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite code is inactive';
  END IF;

  -- Lock all client rows for this user to prevent concurrent upsert races.
  PERFORM 1
  FROM public.clients c
  WHERE c.user_id = p_user_id
  FOR UPDATE;

  -- Upsert the target client row under the new trainer's tenant.
  INSERT INTO public.clients (tenant_id, user_id, assigned_trainer_id)
  VALUES (v_tenant_id, p_user_id, v_trainer_id)
  ON CONFLICT ON CONSTRAINT clients_tenant_id_user_id_key DO UPDATE
    SET assigned_trainer_id = EXCLUDED.assigned_trainer_id
  RETURNING id INTO v_target_client_id;

  -- Find any other client row with a fitness profile (migration source).
  SELECT c.id
  INTO v_source_client_id
  FROM public.clients c
  JOIN public.user_fitness_profiles ufp ON ufp.client_id = c.id
  LEFT JOIN public.tenants tenant ON tenant.id = c.tenant_id
  WHERE c.user_id = p_user_id
    AND c.id <> v_target_client_id
  ORDER BY
    CASE WHEN tenant.slug = 'mode-self-guided' THEN 0 ELSE 1 END,
    c.created_at DESC
  LIMIT 1;

  -- Close all active trainer assignments across the user's clients.
  FOR v_closed IN
    UPDATE public.client_trainer_assignments cta
    SET
      unassigned_at          = COALESCE(cta.unassigned_at, v_now),
      unassigned_by_user_id  = p_user_id,
      unassigned_reason      = 'client_reassigned_by_invite',
      updated_at             = v_now
    FROM public.clients c
    WHERE cta.client_id     = c.id
      AND c.user_id         = p_user_id
      AND cta.unassigned_at IS NULL
    RETURNING cta.client_id, cta.trainer_id
  LOOP
    v_closed_count := v_closed_count + 1;

    INSERT INTO public.trainer_assignment_events (
      trainer_id, client_id, actor_user_id, event_type, reason, metadata, created_at
    ) VALUES (
      v_closed.trainer_id,
      v_closed.client_id,
      p_user_id,
      'unassigned_for_reassign',
      'client_reassigned_by_invite',
      jsonb_build_object(
        'source',            'invite_code',
        'target_client_id',  v_target_client_id,
        'target_trainer_id', v_trainer_id
      ),
      v_now
    ) RETURNING id INTO event_id;

    client_id           := v_closed.client_id;
    trainer_id          := v_closed.trainer_id;
    event_type          := 'unassigned_for_reassign';
    previous_trainer_id := v_closed.trainer_id;
    target_client_id    := v_target_client_id;
    target_trainer_id   := v_trainer_id;
    RETURN NEXT;
  END LOOP;

  -- Set assigned_trainer_id: new tenant gets the trainer; others get NULL.
  UPDATE public.clients c
  SET assigned_trainer_id = CASE
    WHEN c.id = v_target_client_id THEN v_trainer_id
    ELSE NULL
  END
  WHERE c.user_id = p_user_id;

  -- Open the new trainer assignment.
  INSERT INTO public.client_trainer_assignments (client_id, trainer_id, assigned_at, updated_at)
  VALUES (v_target_client_id, v_trainer_id, v_now, v_now);

  -- Copy fitness profile from the source client if one exists.
  IF v_source_client_id IS NOT NULL AND v_source_client_id <> v_target_client_id THEN
    INSERT INTO public.user_fitness_profiles (
      client_id, primary_goal, is_training_for_event, event_type, event_name, event_date,
      injuries_present, injury_notes, equipment_access, workout_frequency_target,
      experience_level, preferred_session_length, current_mode, onboarding_status,
      training_location, minimum_win, weekly_availability, onboarding_completed_at,
      onboarding_last_step, created_at, updated_at
    )
    SELECT
      v_target_client_id,
      ufp.primary_goal, ufp.is_training_for_event, ufp.event_type, ufp.event_name,
      ufp.event_date, ufp.injuries_present, ufp.injury_notes, ufp.equipment_access,
      ufp.workout_frequency_target, ufp.experience_level, ufp.preferred_session_length,
      ufp.current_mode, COALESCE(ufp.onboarding_status, 'not_started'),
      ufp.training_location, ufp.minimum_win, ufp.weekly_availability,
      ufp.onboarding_completed_at, ufp.onboarding_last_step,
      v_now, v_now
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = v_source_client_id
    ON CONFLICT ON CONSTRAINT user_fitness_profiles_client_id_key DO NOTHING
    RETURNING id INTO v_profile_id;

    UPDATE public.user_fitness_profiles target
    SET
      primary_goal            = COALESCE(target.primary_goal,            source.primary_goal),
      is_training_for_event   = COALESCE(target.is_training_for_event,   source.is_training_for_event),
      event_type              = COALESCE(target.event_type,              source.event_type),
      event_name              = COALESCE(target.event_name,              source.event_name),
      event_date              = COALESCE(target.event_date,              source.event_date),
      injuries_present        = COALESCE(target.injuries_present,        source.injuries_present),
      injury_notes            = COALESCE(target.injury_notes,            source.injury_notes),
      equipment_access        = COALESCE(target.equipment_access,        source.equipment_access),
      workout_frequency_target = COALESCE(target.workout_frequency_target, source.workout_frequency_target),
      experience_level        = COALESCE(target.experience_level,        source.experience_level),
      preferred_session_length = COALESCE(target.preferred_session_length, source.preferred_session_length),
      current_mode            = COALESCE(target.current_mode,            source.current_mode),
      training_location       = COALESCE(target.training_location,       source.training_location),
      minimum_win             = COALESCE(target.minimum_win,             source.minimum_win),
      weekly_availability     = COALESCE(target.weekly_availability,     source.weekly_availability),
      onboarding_completed_at = COALESCE(target.onboarding_completed_at, source.onboarding_completed_at),
      onboarding_last_step    = COALESCE(target.onboarding_last_step,    source.onboarding_last_step),
      updated_at              = v_now
    FROM public.user_fitness_profiles source
    WHERE target.client_id  = v_target_client_id
      AND source.client_id  = v_source_client_id
      AND source.client_id <> target.client_id;
  END IF;

  -- Ensure target client has a fitness profile row even if nothing was copied.
  INSERT INTO public.user_fitness_profiles (client_id, onboarding_status, created_at, updated_at)
  VALUES (v_target_client_id, 'not_started', v_now, v_now)
  ON CONFLICT ON CONSTRAINT user_fitness_profiles_client_id_key DO NOTHING
  RETURNING id INTO v_profile_id;

  -- Atomically consume the invite. The double WHERE guard here means a second
  -- concurrent transaction that passed the FOR UPDATE wait above will fail here
  -- if the invite was already consumed in the interim (belt-and-suspenders).
  UPDATE public.trainer_invite_codes tic
  SET
    is_active         = FALSE,
    used_at           = v_now,
    used_by_user_id   = p_user_id,
    updated_at        = v_now
  WHERE tic.id             = v_invite_id
    AND tic.is_active      IS TRUE
    AND tic.used_at        IS NULL
    AND tic.revoked_at     IS NULL
  RETURNING tic.id INTO v_invite_id;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite code is inactive';
  END IF;

  -- Emit the assignment audit event.
  INSERT INTO public.trainer_assignment_events (
    trainer_id, client_id, actor_user_id, event_type, reason, metadata, created_at
  ) VALUES (
    v_trainer_id,
    v_target_client_id,
    p_user_id,
    'assigned_by_invite',
    'client_reassigned_by_invite',
    jsonb_build_object(
      'source',                  'invite_code',
      'invite_id',               v_invite_id,
      'closed_assignment_count', v_closed_count
    ),
    v_now
  ) RETURNING id INTO event_id;

  client_id           := v_target_client_id;
  trainer_id          := v_trainer_id;
  event_type          := 'assigned_by_invite';
  previous_trainer_id := NULL;
  target_client_id    := v_target_client_id;
  target_trainer_id   := v_trainer_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite_code(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invite_code(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_invite_code(UUID, TEXT, TEXT) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.redeem_invite_code(UUID, TEXT, TEXT) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.redeem_invite_code(UUID, TEXT, TEXT)
IS 'Service-role RPC: atomically looks up an invite by HMAC-SHA256 code hash, consumes it, and assigns the client. Concurrent calls for the same code produce exactly one success.';

COMMIT;
