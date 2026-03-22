BEGIN;

CREATE OR REPLACE FUNCTION public.auth_is_trainer_user(trainer_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trainers t
    WHERE t.id = trainer_uuid
      AND t.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_client_user(client_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = client_uuid
      AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_client_assigned_to_trainer(client_uuid UUID, trainer_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = client_uuid
      AND c.assigned_trainer_id = trainer_uuid
      AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_view_client(client_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.auth_is_client_user(client_uuid)
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      JOIN public.trainers t ON t.id = c.assigned_trainer_id
      WHERE c.id = client_uuid
        AND t.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_view_trainer(trainer_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.auth_is_trainer_user(trainer_uuid)
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.assigned_trainer_id = trainer_uuid
        AND c.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_member(tenant_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trainers t
    WHERE t.tenant_id = tenant_uuid
      AND t.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.tenant_id = tenant_uuid
      AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_access_conversation(conversation_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations convo
    JOIN public.clients c ON c.id = convo.client_id
    WHERE convo.id = conversation_uuid
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.conversations convo
    JOIN public.trainers t ON t.id = convo.trainer_id
    WHERE convo.id = conversation_uuid
      AND t.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS tenants_select_member ON public.tenants;
DROP POLICY IF EXISTS trainers_select_tenant_member ON public.trainers;
DROP POLICY IF EXISTS clients_select_self_or_trainer ON public.clients;
DROP POLICY IF EXISTS client_trainer_assignments_select_visible ON public.client_trainer_assignments;
DROP POLICY IF EXISTS trainer_personas_select_visible ON public.trainer_personas;
DROP POLICY IF EXISTS trainer_personas_insert_own ON public.trainer_personas;
DROP POLICY IF EXISTS trainer_personas_update_own ON public.trainer_personas;
DROP POLICY IF EXISTS trainer_knowledge_documents_select_visible ON public.trainer_knowledge_documents;
DROP POLICY IF EXISTS trainer_knowledge_documents_insert_own ON public.trainer_knowledge_documents;
DROP POLICY IF EXISTS trainer_knowledge_documents_update_own ON public.trainer_knowledge_documents;
DROP POLICY IF EXISTS trainer_program_templates_select_visible ON public.trainer_program_templates;
DROP POLICY IF EXISTS trainer_program_templates_insert_own ON public.trainer_program_templates;
DROP POLICY IF EXISTS trainer_program_templates_update_own ON public.trainer_program_templates;
DROP POLICY IF EXISTS trainer_faq_examples_select_visible ON public.trainer_faq_examples;
DROP POLICY IF EXISTS trainer_faq_examples_insert_own ON public.trainer_faq_examples;
DROP POLICY IF EXISTS trainer_faq_examples_update_own ON public.trainer_faq_examples;
DROP POLICY IF EXISTS conversations_select_visible ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_client_or_trainer ON public.conversations;
DROP POLICY IF EXISTS conversations_update_visible ON public.conversations;
DROP POLICY IF EXISTS conversation_messages_select_visible ON public.conversation_messages;
DROP POLICY IF EXISTS conversation_messages_insert_visible ON public.conversation_messages;
DROP POLICY IF EXISTS user_fitness_profiles_select_visible ON public.user_fitness_profiles;
DROP POLICY IF EXISTS user_fitness_profiles_insert_visible ON public.user_fitness_profiles;
DROP POLICY IF EXISTS user_fitness_profiles_update_visible ON public.user_fitness_profiles;
DROP POLICY IF EXISTS onboarding_answers_select_visible ON public.onboarding_answers;
DROP POLICY IF EXISTS onboarding_answers_insert_visible ON public.onboarding_answers;
DROP POLICY IF EXISTS coach_memory_select_visible ON public.coach_memory;
DROP POLICY IF EXISTS coach_memory_insert_update_trainer ON public.coach_memory;
DROP POLICY IF EXISTS coach_memory_update_trainer ON public.coach_memory;
DROP POLICY IF EXISTS unanswered_question_queue_trainer_only ON public.unanswered_question_queue;
DROP POLICY IF EXISTS unanswered_question_queue_insert_trainer_or_client ON public.unanswered_question_queue;
DROP POLICY IF EXISTS unanswered_question_queue_update_trainer_only ON public.unanswered_question_queue;
DROP POLICY IF EXISTS trainer_response_approvals_trainer_only ON public.trainer_response_approvals;
DROP POLICY IF EXISTS trainer_response_approvals_insert_trainer_only ON public.trainer_response_approvals;

CREATE POLICY tenants_select_member ON public.tenants
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_member(id));

CREATE POLICY trainers_select_tenant_member ON public.trainers
  FOR SELECT TO authenticated
  USING (public.auth_can_view_trainer(id));

CREATE POLICY clients_select_self_or_trainer ON public.clients
  FOR SELECT TO authenticated
  USING (public.auth_can_view_client(id));

CREATE POLICY client_trainer_assignments_select_visible ON public.client_trainer_assignments
  FOR SELECT TO authenticated
  USING (
    public.auth_can_view_client(client_id)
    OR public.auth_is_trainer_user(trainer_id)
  );

CREATE POLICY trainer_personas_select_visible ON public.trainer_personas
  FOR SELECT TO authenticated
  USING (public.auth_can_view_trainer(trainer_id));

CREATE POLICY trainer_personas_insert_own ON public.trainer_personas
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_personas_update_own ON public.trainer_personas
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_knowledge_documents_select_visible ON public.trainer_knowledge_documents
  FOR SELECT TO authenticated
  USING (public.auth_can_view_trainer(trainer_id));

CREATE POLICY trainer_knowledge_documents_insert_own ON public.trainer_knowledge_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_knowledge_documents_update_own ON public.trainer_knowledge_documents
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_program_templates_select_visible ON public.trainer_program_templates
  FOR SELECT TO authenticated
  USING (public.auth_can_view_trainer(trainer_id));

CREATE POLICY trainer_program_templates_insert_own ON public.trainer_program_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_program_templates_update_own ON public.trainer_program_templates
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_faq_examples_select_visible ON public.trainer_faq_examples
  FOR SELECT TO authenticated
  USING (public.auth_can_view_trainer(trainer_id));

CREATE POLICY trainer_faq_examples_insert_own ON public.trainer_faq_examples
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_faq_examples_update_own ON public.trainer_faq_examples
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY conversations_select_visible ON public.conversations
  FOR SELECT TO authenticated
  USING (
    public.auth_can_view_client(client_id)
    OR public.auth_is_trainer_user(trainer_id)
  );

CREATE POLICY conversations_insert_client_or_trainer ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_trainer_user(trainer_id)
    OR public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
  );

CREATE POLICY conversations_update_visible ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    public.auth_can_view_client(client_id)
    OR public.auth_is_trainer_user(trainer_id)
  )
  WITH CHECK (
    public.auth_can_view_client(client_id)
    OR public.auth_is_trainer_user(trainer_id)
  );

CREATE POLICY conversation_messages_select_visible ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (public.auth_can_access_conversation(conversation_id));

CREATE POLICY conversation_messages_insert_visible ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_access_conversation(conversation_id));

CREATE POLICY user_fitness_profiles_select_visible ON public.user_fitness_profiles
  FOR SELECT TO authenticated
  USING (public.auth_can_view_client(client_id));

CREATE POLICY user_fitness_profiles_insert_visible ON public.user_fitness_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_view_client(client_id));

CREATE POLICY user_fitness_profiles_update_visible ON public.user_fitness_profiles
  FOR UPDATE TO authenticated
  USING (public.auth_can_view_client(client_id))
  WITH CHECK (public.auth_can_view_client(client_id));

CREATE POLICY onboarding_answers_select_visible ON public.onboarding_answers
  FOR SELECT TO authenticated
  USING (public.auth_can_view_client(client_id));

CREATE POLICY onboarding_answers_insert_visible ON public.onboarding_answers
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_view_client(client_id));

CREATE POLICY coach_memory_select_visible ON public.coach_memory
  FOR SELECT TO authenticated
  USING (
    public.auth_can_view_client(client_id)
    OR public.auth_is_trainer_user(trainer_id)
  );

CREATE POLICY coach_memory_insert_trainer ON public.coach_memory
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY coach_memory_update_trainer ON public.coach_memory
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY unanswered_question_queue_trainer_only ON public.unanswered_question_queue
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

CREATE POLICY unanswered_question_queue_insert_trainer_or_client ON public.unanswered_question_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_trainer_user(trainer_id)
    OR public.auth_is_client_assigned_to_trainer(client_id, trainer_id)
  );

CREATE POLICY unanswered_question_queue_update_trainer_only ON public.unanswered_question_queue
  FOR UPDATE TO authenticated
  USING (public.auth_is_trainer_user(trainer_id))
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_response_approvals_trainer_only ON public.trainer_response_approvals
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

CREATE POLICY trainer_response_approvals_insert_trainer_only ON public.trainer_response_approvals
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_trainer_user(trainer_id));

COMMIT;
