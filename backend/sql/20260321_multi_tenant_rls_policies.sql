BEGIN;

GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.trainers TO authenticated;
GRANT SELECT ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.conversation_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_fitness_profiles TO authenticated;
GRANT SELECT ON public.onboarding_answers TO authenticated;
GRANT SELECT ON public.coach_memory TO authenticated;
GRANT SELECT ON public.trainer_program_templates TO authenticated;
GRANT SELECT ON public.trainer_knowledge_documents TO authenticated;
GRANT SELECT ON public.trainer_faq_examples TO authenticated;
GRANT SELECT ON public.trainer_personas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_personas TO authenticated;
GRANT SELECT ON public.client_trainer_assignments TO authenticated;
GRANT SELECT, INSERT ON public.onboarding_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_knowledge_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_program_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_faq_examples TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coach_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.unanswered_question_queue TO authenticated;
GRANT SELECT, INSERT ON public.trainer_response_approvals TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'tenants_select_member'
  ) THEN
    CREATE POLICY tenants_select_member ON public.tenants
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.tenant_id = tenants.id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.tenant_id = tenants.id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainers' AND policyname = 'trainers_select_tenant_member'
  ) THEN
    CREATE POLICY trainers_select_tenant_member ON public.trainers
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.assigned_trainer_id = trainers.id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers teammate
          WHERE teammate.tenant_id = trainers.tenant_id
            AND teammate.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'clients_select_self_or_trainer'
  ) THEN
    CREATE POLICY clients_select_self_or_trainer ON public.clients
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = clients.assigned_trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'client_trainer_assignments' AND policyname = 'client_trainer_assignments_select_visible'
  ) THEN
    CREATE POLICY client_trainer_assignments_select_visible ON public.client_trainer_assignments
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = client_trainer_assignments.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = client_trainer_assignments.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_select_visible'
  ) THEN
    CREATE POLICY trainer_personas_select_visible ON public.trainer_personas
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_personas.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.assigned_trainer_id = trainer_personas.trainer_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_insert_own'
  ) THEN
    CREATE POLICY trainer_personas_insert_own ON public.trainer_personas
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_personas.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_update_own'
  ) THEN
    CREATE POLICY trainer_personas_update_own ON public.trainer_personas
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_personas.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_personas.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_select_visible'
  ) THEN
    CREATE POLICY trainer_knowledge_documents_select_visible ON public.trainer_knowledge_documents
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_knowledge_documents.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.assigned_trainer_id = trainer_knowledge_documents.trainer_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_insert_own'
  ) THEN
    CREATE POLICY trainer_knowledge_documents_insert_own ON public.trainer_knowledge_documents
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_knowledge_documents.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_update_own'
  ) THEN
    CREATE POLICY trainer_knowledge_documents_update_own ON public.trainer_knowledge_documents
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_knowledge_documents.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_knowledge_documents.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_select_visible'
  ) THEN
    CREATE POLICY trainer_program_templates_select_visible ON public.trainer_program_templates
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_program_templates.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.assigned_trainer_id = trainer_program_templates.trainer_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_insert_own'
  ) THEN
    CREATE POLICY trainer_program_templates_insert_own ON public.trainer_program_templates
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_program_templates.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_update_own'
  ) THEN
    CREATE POLICY trainer_program_templates_update_own ON public.trainer_program_templates
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_program_templates.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_program_templates.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_select_visible'
  ) THEN
    CREATE POLICY trainer_faq_examples_select_visible ON public.trainer_faq_examples
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_faq_examples.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.assigned_trainer_id = trainer_faq_examples.trainer_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_insert_own'
  ) THEN
    CREATE POLICY trainer_faq_examples_insert_own ON public.trainer_faq_examples
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_faq_examples.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_update_own'
  ) THEN
    CREATE POLICY trainer_faq_examples_update_own ON public.trainer_faq_examples
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_faq_examples.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_faq_examples.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_select_visible'
  ) THEN
    CREATE POLICY conversations_select_visible ON public.conversations
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = conversations.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = conversations.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_insert_client_or_trainer'
  ) THEN
    CREATE POLICY conversations_insert_client_or_trainer ON public.conversations
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = conversations.client_id
            AND c.user_id = auth.uid()
            AND c.assigned_trainer_id = conversations.trainer_id
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = conversations.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_update_visible'
  ) THEN
    CREATE POLICY conversations_update_visible ON public.conversations
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = conversations.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = conversations.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = conversations.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = conversations.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversation_messages' AND policyname = 'conversation_messages_select_visible'
  ) THEN
    CREATE POLICY conversation_messages_select_visible ON public.conversation_messages
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.conversations convo
          JOIN public.clients c ON c.id = convo.client_id
          WHERE convo.id = conversation_messages.conversation_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.conversations convo
          JOIN public.trainers t ON t.id = convo.trainer_id
          WHERE convo.id = conversation_messages.conversation_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversation_messages' AND policyname = 'conversation_messages_insert_visible'
  ) THEN
    CREATE POLICY conversation_messages_insert_visible ON public.conversation_messages
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.conversations convo
          JOIN public.clients c ON c.id = convo.client_id
          WHERE convo.id = conversation_messages.conversation_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.conversations convo
          JOIN public.trainers t ON t.id = convo.trainer_id
          WHERE convo.id = conversation_messages.conversation_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_select_visible'
  ) THEN
    CREATE POLICY user_fitness_profiles_select_visible ON public.user_fitness_profiles
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = user_fitness_profiles.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = user_fitness_profiles.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_insert_visible'
  ) THEN
    CREATE POLICY user_fitness_profiles_insert_visible ON public.user_fitness_profiles
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = user_fitness_profiles.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = user_fitness_profiles.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_update_visible'
  ) THEN
    CREATE POLICY user_fitness_profiles_update_visible ON public.user_fitness_profiles
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = user_fitness_profiles.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = user_fitness_profiles.client_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = user_fitness_profiles.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = user_fitness_profiles.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_answers' AND policyname = 'onboarding_answers_select_visible'
  ) THEN
    CREATE POLICY onboarding_answers_select_visible ON public.onboarding_answers
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = onboarding_answers.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = onboarding_answers.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_answers' AND policyname = 'onboarding_answers_insert_visible'
  ) THEN
    CREATE POLICY onboarding_answers_insert_visible ON public.onboarding_answers
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = onboarding_answers.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = onboarding_answers.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'coach_memory_select_visible'
  ) THEN
    CREATE POLICY coach_memory_select_visible ON public.coach_memory
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = coach_memory.client_id
            AND (c.user_id = auth.uid() OR t.user_id = auth.uid())
            AND t.id = coach_memory.trainer_id
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'coach_memory_insert_update_trainer'
  ) THEN
    CREATE POLICY coach_memory_insert_update_trainer ON public.coach_memory
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = coach_memory.trainer_id
            AND t.user_id = auth.uid()
        )
      );
    CREATE POLICY coach_memory_update_trainer ON public.coach_memory
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = coach_memory.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = coach_memory.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'unanswered_question_queue' AND policyname = 'unanswered_question_queue_trainer_only'
  ) THEN
    CREATE POLICY unanswered_question_queue_trainer_only ON public.unanswered_question_queue
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = unanswered_question_queue.trainer_id
            AND t.user_id = auth.uid()
        )
      );
    CREATE POLICY unanswered_question_queue_insert_trainer_or_client ON public.unanswered_question_queue
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = unanswered_question_queue.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = unanswered_question_queue.client_id
            AND c.user_id = auth.uid()
            AND c.assigned_trainer_id = unanswered_question_queue.trainer_id
        )
      );
    CREATE POLICY unanswered_question_queue_update_trainer_only ON public.unanswered_question_queue
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = unanswered_question_queue.trainer_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = unanswered_question_queue.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_response_approvals' AND policyname = 'trainer_response_approvals_trainer_only'
  ) THEN
    CREATE POLICY trainer_response_approvals_trainer_only ON public.trainer_response_approvals
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_response_approvals.trainer_id
            AND t.user_id = auth.uid()
        )
      );
    CREATE POLICY trainer_response_approvals_insert_trainer_only ON public.trainer_response_approvals
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.trainers t
          WHERE t.id = trainer_response_approvals.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
