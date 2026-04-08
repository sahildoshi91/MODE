BEGIN;

CREATE OR REPLACE FUNCTION public.bootstrap_trainer_tenant(
  trainer_user_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  trainer_display_name TEXT,
  default_persona_name TEXT DEFAULT 'Default Coach',
  tone_description TEXT DEFAULT 'Warm, direct, and practical.',
  coaching_philosophy TEXT DEFAULT 'Build sustainable consistency first, then layer intensity.'
)
RETURNS TABLE (
  tenant_id UUID,
  trainer_id UUID,
  persona_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_trainer_id UUID;
  v_persona_id UUID;
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (tenant_name, tenant_slug)
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.trainers (tenant_id, user_id, display_name)
  VALUES (v_tenant_id, trainer_user_id, trainer_display_name)
  ON CONFLICT ON CONSTRAINT trainers_tenant_id_user_id_key DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING id INTO v_trainer_id;

  INSERT INTO public.trainer_personas (
    trainer_id,
    persona_name,
    tone_description,
    coaching_philosophy,
    communication_rules,
    onboarding_preferences,
    fallback_behavior,
    is_default
  )
  VALUES (
    v_trainer_id,
    default_persona_name,
    tone_description,
    coaching_philosophy,
    jsonb_build_object(
      'tone', 'warm_practical',
      'verbosity', 'concise',
      'question_style', 'one_question_at_a_time'
    ),
    jsonb_build_object(
      'quick_replies', true,
      'allow_skip', true
    ),
    jsonb_build_object(
      'queue_low_confidence', true,
      'reveal_review_queue_to_client', false
    ),
    TRUE
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_persona_id;

  IF v_persona_id IS NULL THEN
    SELECT tp.id
    INTO v_persona_id
    FROM public.trainer_personas tp
    WHERE tp.trainer_id = v_trainer_id
      AND tp.is_default = TRUE
    ORDER BY tp.created_at ASC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_tenant_id AS tenant_id, v_trainer_id AS trainer_id, v_persona_id AS persona_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_client_to_trainer(
  client_user_id UUID,
  trainer_record_id UUID
)
RETURNS TABLE (
  client_id UUID,
  tenant_id UUID,
  trainer_id UUID,
  profile_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_client_id UUID;
  v_profile_id UUID;
BEGIN
  SELECT t.tenant_id
  INTO v_tenant_id
  FROM public.trainers t
  WHERE t.id = trainer_record_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Trainer % not found', trainer_record_id;
  END IF;

  INSERT INTO public.clients (tenant_id, user_id, assigned_trainer_id)
  VALUES (v_tenant_id, client_user_id, trainer_record_id)
  ON CONFLICT ON CONSTRAINT clients_tenant_id_user_id_key DO UPDATE
    SET assigned_trainer_id = EXCLUDED.assigned_trainer_id
  RETURNING id INTO v_client_id;

  INSERT INTO public.client_trainer_assignments (client_id, trainer_id)
  VALUES (v_client_id, trainer_record_id);

  INSERT INTO public.user_fitness_profiles (client_id, onboarding_status)
  VALUES (v_client_id, 'not_started')
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    SELECT ufp.id
    INTO v_profile_id
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = v_client_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_client_id AS client_id, v_tenant_id AS tenant_id, trainer_record_id AS trainer_id, v_profile_id AS profile_id;
END;
$$;

COMMIT;
