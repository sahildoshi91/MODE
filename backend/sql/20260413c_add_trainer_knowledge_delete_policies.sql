BEGIN;

GRANT DELETE ON public.trainer_knowledge_documents TO authenticated;
GRANT DELETE ON public.trainer_rules TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_knowledge_documents'
      AND policyname = 'trainer_knowledge_documents_delete_own'
  ) THEN
    CREATE POLICY trainer_knowledge_documents_delete_own ON public.trainer_knowledge_documents
      FOR DELETE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_rules'
      AND policyname = 'trainer_rules_delete_own'
  ) THEN
    CREATE POLICY trainer_rules_delete_own ON public.trainer_rules
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rules.trainer_id
            AND t.tenant_id = trainer_rules.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
