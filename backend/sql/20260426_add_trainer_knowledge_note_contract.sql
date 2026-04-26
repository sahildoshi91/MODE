BEGIN;

ALTER TABLE public.trainer_knowledge_entries
  ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL;

UPDATE public.trainer_knowledge_entries
SET scope = CASE
  WHEN scope IN ('client_specific', 'clientspecific') THEN 'client'
  ELSE 'global'
END;

UPDATE public.trainer_knowledge_entries
SET knowledge_type = CASE
  WHEN knowledge_type IN ('coaching_rule', 'rule') THEN 'rule'
  WHEN knowledge_type = 'faq' THEN 'faq'
  WHEN knowledge_type IN ('programming_preference', 'nutrition_principle', 'communication_style', 'business_policy', 'preference') THEN 'preference'
  ELSE 'note'
END;

UPDATE public.trainer_knowledge_entries
SET source = CASE
  WHEN source = 'slash_command' THEN 'slash_command'
  WHEN source IN ('chat_capture', 'message_capture') THEN 'message_capture'
  ELSE 'manual'
END;

ALTER TABLE public.trainer_knowledge_entries
  DROP CONSTRAINT IF EXISTS trainer_knowledge_entries_scope_check;

ALTER TABLE public.trainer_knowledge_entries
  DROP CONSTRAINT IF EXISTS trainer_knowledge_entries_knowledge_type_check;

ALTER TABLE public.trainer_knowledge_entries
  DROP CONSTRAINT IF EXISTS trainer_knowledge_entries_source_check;

ALTER TABLE public.trainer_knowledge_entries
  ADD CONSTRAINT trainer_knowledge_entries_scope_check
  CHECK (scope IN ('global', 'client'));

ALTER TABLE public.trainer_knowledge_entries
  ADD CONSTRAINT trainer_knowledge_entries_knowledge_type_check
  CHECK (knowledge_type IN ('note', 'rule', 'faq', 'preference'));

ALTER TABLE public.trainer_knowledge_entries
  ADD CONSTRAINT trainer_knowledge_entries_source_check
  CHECK (source IN ('manual', 'slash_command', 'message_capture'));

CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_entries_source_message
  ON public.trainer_knowledge_entries (source_message_id);

COMMIT;
