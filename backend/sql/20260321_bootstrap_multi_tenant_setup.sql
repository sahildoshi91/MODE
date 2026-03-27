-- Multi-tenant bootstrap helpers for Supabase SQL editor.
-- Run this file after the table creation migrations and the RLS policy migration.
-- These functions are intended for setup/admin use in the SQL editor.

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
  new_tenant_id UUID;
  new_trainer_id UUID;
  new_persona_id UUID;
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (tenant_name, tenant_slug)
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.trainers (tenant_id, user_id, display_name)
  VALUES (new_tenant_id, trainer_user_id, trainer_display_name)
  ON CONFLICT ON CONSTRAINT trainers_tenant_id_user_id_key DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING id INTO new_trainer_id;

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
    new_trainer_id,
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
  RETURNING id INTO new_persona_id;

  IF new_persona_id IS NULL THEN
    SELECT tp.id
    INTO new_persona_id
    FROM public.trainer_personas tp
    WHERE tp.trainer_id = new_trainer_id
      AND tp.is_default = TRUE
    ORDER BY tp.created_at ASC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT new_tenant_id, new_trainer_id, new_persona_id;
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
  target_tenant_id UUID;
  new_client_id UUID;
  new_profile_id UUID;
BEGIN
  SELECT t.tenant_id
  INTO target_tenant_id
  FROM public.trainers t
  WHERE t.id = trainer_record_id;

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Trainer % not found', trainer_record_id;
  END IF;

  INSERT INTO public.clients (tenant_id, user_id, assigned_trainer_id)
  VALUES (target_tenant_id, client_user_id, trainer_record_id)
  ON CONFLICT ON CONSTRAINT clients_tenant_id_user_id_key DO UPDATE
    SET assigned_trainer_id = EXCLUDED.assigned_trainer_id
  RETURNING id INTO new_client_id;

  INSERT INTO public.client_trainer_assignments (client_id, trainer_id)
  VALUES (new_client_id, trainer_record_id);

  INSERT INTO public.user_fitness_profiles (client_id, onboarding_status)
  VALUES (new_client_id, 'not_started')
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO new_profile_id;

  IF new_profile_id IS NULL THEN
    SELECT ufp.id
    INTO new_profile_id
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = new_client_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT new_client_id, target_tenant_id, trainer_record_id, new_profile_id;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_trainer_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
IS 'Admin helper: create or upsert a tenant, trainer row, and default persona.';

COMMENT ON FUNCTION public.assign_client_to_trainer(UUID, UUID)
IS 'Admin helper: assign a client auth user to a trainer and ensure a profile row exists.';

COMMIT;

-- Example usage:
-- 1. Create trainer tenant + default persona
-- SELECT * FROM public.bootstrap_trainer_tenant(
--   '00000000-0000-0000-0000-000000000001',
--   'MODE Demo Coaching',
--   'mode-demo-coaching',
--   'Coach Maya'
-- );
--
-- 2. Assign a client to that trainer
-- SELECT * FROM public.assign_client_to_trainer(
--   '00000000-0000-0000-0000-000000000002',
--   'trainer-row-uuid-from-step-1'
-- );
