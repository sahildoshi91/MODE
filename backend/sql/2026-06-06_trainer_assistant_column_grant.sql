BEGIN;

-- Grant column-level UPDATE access for assistant_last_client_id to authenticated role.
-- The RLS UPDATE policy below restricts writes to a trainer's own row only,
-- preventing any cross-trainer mutation of this column.
GRANT UPDATE (assistant_last_client_id) ON public.trainers TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainers'
      AND policyname = 'trainers_update_own_assistant_last_client'
  ) THEN
    CREATE POLICY trainers_update_own_assistant_last_client ON public.trainers
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

COMMIT;
