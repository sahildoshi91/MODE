BEGIN;

-- Fix: the WITH CHECK on coach_memory_update_client_visible_user required
-- client_visible = 'true', but 20260504c's SELECT policy added a visibility
-- path for memories where source/created_by = 'user' regardless of
-- client_visible. This asymmetry caused client soft-deletes (archive) to
-- silently fail when client_visible was absent: the row was visible via SELECT
-- but the UPDATE was rejected, so the verification re-fetch found the row
-- still unarchived and raised ProfilePersistenceVerificationError.
--
-- Fix: align WITH CHECK with USING (ownership check only, no client_visible
-- requirement). The service always sets client_visible = true on creation and
-- update, so this is safe.

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
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback:
-- DROP POLICY IF EXISTS coach_memory_update_client_visible_user ON public.coach_memory;
-- CREATE POLICY coach_memory_update_client_visible_user ON public.coach_memory
--   FOR UPDATE TO authenticated
--   USING (
--     public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
--     AND LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
--     AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
--   )
--   WITH CHECK (
--     public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
--     AND LOWER(COALESCE(value_json ->> 'source', '')) = 'user'
--     AND LOWER(COALESCE(value_json ->> 'created_by', '')) = 'user'
--     AND LOWER(COALESCE(value_json ->> 'client_visible', 'false')) = 'true'
--   );
-- NOTIFY pgrst, 'reload schema';
