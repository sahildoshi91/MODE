BEGIN;

DROP POLICY IF EXISTS coach_memory_select_visible ON public.coach_memory;
CREATE POLICY coach_memory_select_visible ON public.coach_memory
  FOR SELECT TO authenticated
  USING (
    public.auth_is_trainer_user(trainer_id)
    OR (
      public.auth_is_client_user(client_id)
      AND public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
      AND LOWER(COALESCE(value_json ->> 'is_archived', 'false')) <> 'true'
      AND (
        LOWER(COALESCE(value_json ->> 'client_visible', 'false')) = 'true'
        OR (
          LOWER(COALESCE(value_json ->> 'source', 'trainer')) = 'trainer'
          AND (
            LOWER(COALESCE(value_json ->> 'ai_usable', 'false')) = 'true'
            OR COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') = 'ai_usable'
          )
        )
        OR (
          LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
          AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
        )
      )
    )
  );

COMMIT;
