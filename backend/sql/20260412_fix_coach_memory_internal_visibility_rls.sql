BEGIN;

DROP POLICY IF EXISTS coach_memory_select_visible ON public.coach_memory;

CREATE POLICY coach_memory_select_visible ON public.coach_memory
  FOR SELECT TO authenticated
  USING (
    public.auth_is_trainer_user(trainer_id)
    OR (
      public.auth_is_client_user(client_id)
      AND COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') <> 'internal_only'
    )
  );

COMMIT;
