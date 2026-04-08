BEGIN;

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
#variable_conflict use_column
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
  ON CONFLICT ON CONSTRAINT user_fitness_profiles_client_id_key DO NOTHING
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    SELECT ufp.id
    INTO v_profile_id
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = v_client_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_client_id, v_tenant_id, trainer_record_id, v_profile_id;
END;
$$;

COMMIT;
