BEGIN;

-- Trainer-owned artifacts must remain trainer-private. Clients should never be
-- able to query these rows directly, even when assigned to the trainer.

DROP POLICY IF EXISTS trainer_personas_select_visible ON public.trainer_personas;
CREATE POLICY trainer_personas_select_visible ON public.trainer_personas
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

DROP POLICY IF EXISTS trainer_knowledge_documents_select_visible ON public.trainer_knowledge_documents;
CREATE POLICY trainer_knowledge_documents_select_visible ON public.trainer_knowledge_documents
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

DROP POLICY IF EXISTS trainer_program_templates_select_visible ON public.trainer_program_templates;
CREATE POLICY trainer_program_templates_select_visible ON public.trainer_program_templates
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

DROP POLICY IF EXISTS trainer_faq_examples_select_visible ON public.trainer_faq_examples;
CREATE POLICY trainer_faq_examples_select_visible ON public.trainer_faq_examples
  FOR SELECT TO authenticated
  USING (public.auth_is_trainer_user(trainer_id));

COMMIT;
