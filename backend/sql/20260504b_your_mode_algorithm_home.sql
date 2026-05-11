BEGIN;

ALTER TABLE public.user_fitness_profiles
  ADD COLUMN IF NOT EXISTS user_why TEXT,
  ADD COLUMN IF NOT EXISTS algorithm_summary TEXT,
  ADD COLUMN IF NOT EXISTS algorithm_summary_updated_at TIMESTAMPTZ;

DROP POLICY IF EXISTS coach_memory_select_visible ON public.coach_memory;
CREATE POLICY coach_memory_select_visible ON public.coach_memory
  FOR SELECT TO authenticated
  USING (
    public.auth_is_trainer_user(trainer_id)
    OR (
      public.auth_is_client_user(client_id)
      AND LOWER(COALESCE(value_json ->> 'client_visible', 'false')) = 'true'
    )
  );

DROP POLICY IF EXISTS coach_memory_insert_client_visible_user ON public.coach_memory;
CREATE POLICY coach_memory_insert_client_visible_user ON public.coach_memory
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
    AND LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
    AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
    AND LOWER(COALESCE(value_json ->> 'client_visible', 'false')) = 'true'
  );

DROP POLICY IF EXISTS coach_memory_update_client_visible_user ON public.coach_memory;
CREATE POLICY coach_memory_update_client_visible_user ON public.coach_memory
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
    AND LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
    AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
  )
  WITH CHECK (
    public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
    AND LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
    AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
    AND LOWER(COALESCE(value_json ->> 'client_visible', 'false')) = 'true'
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
