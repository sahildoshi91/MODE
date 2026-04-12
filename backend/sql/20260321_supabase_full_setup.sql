-- MODE full Supabase setup
-- Run this file in the Supabase SQL editor on a fresh project.
-- It creates the original workout tables, the multi-tenant coaching tables,
-- the RLS policies, and the bootstrap helper functions in the correct order.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  fitness_level TEXT,
  goals TEXT[],
  injuries TEXT[],
  equipment TEXT[],
  duration INTEGER,
  workout_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workout_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  plan_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT,
  duration INTEGER,
  plan_type TEXT,
  completed BOOLEAN DEFAULT FALSE,
  plan_id UUID REFERENCES public.workout_plans(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.client_trainer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.trainer_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  persona_name TEXT NOT NULL,
  tone_description TEXT,
  coaching_philosophy TEXT,
  communication_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_behavior JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainer_faq_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  approved_answer TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainer_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_url TEXT,
  document_type TEXT,
  raw_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexing_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainer_program_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT,
  experience_level TEXT,
  equipment_access TEXT,
  frequency INTEGER,
  template_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('onboarding', 'coach', 'chat', 'workout_feedback')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  current_stage TEXT NOT NULL DEFAULT 'welcome',
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user', 'tool')),
  message_text TEXT NOT NULL,
  structured_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_fitness_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  primary_goal TEXT,
  is_training_for_event BOOLEAN,
  event_type TEXT,
  event_name TEXT,
  event_date DATE,
  injuries_present BOOLEAN,
  injury_notes TEXT,
  equipment_access TEXT,
  workout_frequency_target INTEGER,
  experience_level TEXT,
  preferred_session_length INTEGER,
  current_mode TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  profile_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.onboarding_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  source_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  confidence_score NUMERIC(4, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unanswered_question_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  user_question TEXT NOT NULL,
  model_draft_answer TEXT,
  confidence_score NUMERIC(4, 3),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.trainer_response_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.unanswered_question_queue(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  approved_answer TEXT NOT NULL,
  response_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_plans_user_id ON public.workout_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_user_id ON public.workouts (user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_plan_id ON public.workouts (plan_id);
CREATE INDEX IF NOT EXISTS idx_trainers_tenant_id ON public.trainers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trainers_user_id ON public.trainers (user_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON public.clients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients (user_id);
CREATE INDEX IF NOT EXISTS idx_clients_assigned_trainer_id ON public.clients (assigned_trainer_id);
CREATE INDEX IF NOT EXISTS idx_client_trainer_assignments_client_id ON public.client_trainer_assignments (client_id);
CREATE INDEX IF NOT EXISTS idx_client_trainer_assignments_trainer_id ON public.client_trainer_assignments (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_personas_trainer_id ON public.trainer_personas (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_documents_trainer_id ON public.trainer_knowledge_documents (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_program_templates_trainer_id ON public.trainer_program_templates (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_faq_examples_trainer_id ON public.trainer_faq_examples (trainer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_trainer_id ON public.conversations (trainer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON public.conversations (client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations (status);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON public.conversation_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_user_fitness_profiles_client_id ON public.user_fitness_profiles (client_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_answers_client_id ON public.onboarding_answers (client_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_answers_conversation_id ON public.onboarding_answers (conversation_id);
CREATE INDEX IF NOT EXISTS idx_coach_memory_trainer_id ON public.coach_memory (trainer_id);
CREATE INDEX IF NOT EXISTS idx_coach_memory_client_id ON public.coach_memory (client_id);
CREATE INDEX IF NOT EXISTS idx_unanswered_question_queue_trainer_id ON public.unanswered_question_queue (trainer_id);
CREATE INDEX IF NOT EXISTS idx_unanswered_question_queue_status ON public.unanswered_question_queue (status);
CREATE INDEX IF NOT EXISTS idx_trainer_response_approvals_queue_id ON public.trainer_response_approvals (queue_id);
CREATE INDEX IF NOT EXISTS idx_trainer_response_approvals_trainer_id ON public.trainer_response_approvals (trainer_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_trainer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_faq_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_program_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_fitness_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unanswered_question_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_response_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_trainer_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_personas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_faq_examples FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_program_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_fitness_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_answers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coach_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE public.unanswered_question_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_response_approvals FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workout_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workouts TO authenticated;
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.trainers TO authenticated;
GRANT SELECT ON public.clients TO authenticated;
GRANT SELECT ON public.client_trainer_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.conversation_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_fitness_profiles TO authenticated;
GRANT SELECT, INSERT ON public.onboarding_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coach_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_personas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_knowledge_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_program_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_faq_examples TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.unanswered_question_queue TO authenticated;
GRANT SELECT, INSERT ON public.trainer_response_approvals TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT TO authenticated
      USING (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workout_plans' AND policyname = 'workout_plans_select_own'
  ) THEN
    CREATE POLICY workout_plans_select_own ON public.workout_plans
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workout_plans' AND policyname = 'workout_plans_insert_own'
  ) THEN
    CREATE POLICY workout_plans_insert_own ON public.workout_plans
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workout_plans' AND policyname = 'workout_plans_update_own'
  ) THEN
    CREATE POLICY workout_plans_update_own ON public.workout_plans
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workouts' AND policyname = 'workouts_select_own'
  ) THEN
    CREATE POLICY workouts_select_own ON public.workouts
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workouts' AND policyname = 'workouts_insert_own'
  ) THEN
    CREATE POLICY workouts_insert_own ON public.workouts
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workouts' AND policyname = 'workouts_update_own'
  ) THEN
    CREATE POLICY workouts_update_own ON public.workouts
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'tenants_select_member'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainers' AND policyname = 'trainers_select_tenant_member'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'clients_select_self_or_trainer'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_trainer_assignments' AND policyname = 'client_trainer_assignments_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_insert_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_personas' AND policyname = 'trainer_personas_update_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_insert_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_knowledge_documents' AND policyname = 'trainer_knowledge_documents_update_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_insert_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_program_templates' AND policyname = 'trainer_program_templates_update_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_insert_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_faq_examples' AND policyname = 'trainer_faq_examples_update_own'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_insert_client_or_trainer'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_update_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversation_messages' AND policyname = 'conversation_messages_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversation_messages' AND policyname = 'conversation_messages_insert_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_insert_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_fitness_profiles' AND policyname = 'user_fitness_profiles_update_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_answers' AND policyname = 'onboarding_answers_select_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_answers' AND policyname = 'onboarding_answers_insert_visible'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'coach_memory_select_visible'
  ) THEN
    -- Post-2026-04-12 safety fix: embed the hardened visibility guard here
    -- so fresh setup paths cannot recreate client access to internal_only rows.
    CREATE POLICY coach_memory_select_visible ON public.coach_memory
      FOR SELECT TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        OR (
          public.auth_is_client_user(client_id)
          AND COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') <> 'internal_only'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'coach_memory_insert_update_trainer'
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'coach_memory_update_trainer'
  ) THEN
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_question_queue' AND policyname = 'unanswered_question_queue_trainer_only'
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_question_queue' AND policyname = 'unanswered_question_queue_insert_trainer_or_client'
  ) THEN
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_question_queue' AND policyname = 'unanswered_question_queue_update_trainer_only'
  ) THEN
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_response_approvals' AND policyname = 'trainer_response_approvals_trainer_only'
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trainer_response_approvals' AND policyname = 'trainer_response_approvals_insert_trainer_only'
  ) THEN
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

CREATE OR REPLACE FUNCTION public.bootstrap_trainer_tenant(
  trainer_user_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  trainer_display_name TEXT,
  default_persona_name TEXT DEFAULT 'Default Coach',
  tone_description TEXT DEFAULT 'Warm, direct, and practical.',
  coaching_philosophy TEXT DEFAULT 'Build sustainable consistency first, then layer intensity.'
)
RETURNS TABLE (
  tenant_id UUID,
  trainer_id UUID,
  persona_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant_id UUID;
  new_trainer_id UUID;
  new_persona_id UUID;
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (tenant_name, tenant_slug)
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.trainers (tenant_id, user_id, display_name)
  VALUES (new_tenant_id, trainer_user_id, trainer_display_name)
  ON CONFLICT ON CONSTRAINT trainers_tenant_id_user_id_key DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING id INTO new_trainer_id;

  INSERT INTO public.trainer_personas (
    trainer_id,
    persona_name,
    tone_description,
    coaching_philosophy,
    communication_rules,
    onboarding_preferences,
    fallback_behavior,
    is_default
  )
  VALUES (
    new_trainer_id,
    default_persona_name,
    tone_description,
    coaching_philosophy,
    jsonb_build_object(
      'tone', 'warm_practical',
      'verbosity', 'concise',
      'question_style', 'one_question_at_a_time'
    ),
    jsonb_build_object(
      'quick_replies', true,
      'allow_skip', true
    ),
    jsonb_build_object(
      'queue_low_confidence', true,
      'reveal_review_queue_to_client', false
    ),
    TRUE
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_persona_id;

  IF new_persona_id IS NULL THEN
    SELECT tp.id
    INTO new_persona_id
    FROM public.trainer_personas tp
    WHERE tp.trainer_id = new_trainer_id
      AND tp.is_default = TRUE
    ORDER BY tp.created_at ASC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT new_tenant_id, new_trainer_id, new_persona_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_client_to_trainer(
  client_user_id UUID,
  trainer_record_id UUID
)
RETURNS TABLE (
  client_id UUID,
  tenant_id UUID,
  trainer_id UUID,
  profile_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_tenant_id UUID;
  new_client_id UUID;
  new_profile_id UUID;
BEGIN
  SELECT t.tenant_id
  INTO target_tenant_id
  FROM public.trainers t
  WHERE t.id = trainer_record_id;

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Trainer % not found', trainer_record_id;
  END IF;

  INSERT INTO public.clients (tenant_id, user_id, assigned_trainer_id)
  VALUES (target_tenant_id, client_user_id, trainer_record_id)
  ON CONFLICT ON CONSTRAINT clients_tenant_id_user_id_key DO UPDATE
    SET assigned_trainer_id = EXCLUDED.assigned_trainer_id
  RETURNING id INTO new_client_id;

  INSERT INTO public.client_trainer_assignments (client_id, trainer_id)
  VALUES (new_client_id, trainer_record_id);

  INSERT INTO public.user_fitness_profiles (client_id, onboarding_status)
  VALUES (new_client_id, 'not_started')
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO new_profile_id;

  IF new_profile_id IS NULL THEN
    SELECT ufp.id
    INTO new_profile_id
    FROM public.user_fitness_profiles ufp
    WHERE ufp.client_id = new_client_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT new_client_id, target_tenant_id, trainer_record_id, new_profile_id;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_trainer_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
IS 'Admin helper: create or upsert a tenant, trainer row, and default persona.';

COMMENT ON FUNCTION public.assign_client_to_trainer(UUID, UUID)
IS 'Admin helper: assign a client auth user to a trainer and ensure a profile row exists.';

-- Repair pass for recursive multi-tenant RLS policies.
-- This keeps fresh installs from hitting policy recursion between clients/trainers.

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
    -- Post-2026-04-12 safety fix: keep the canonical full-setup path aligned
    -- with the repair migration so clients never read internal_only memory rows.
    public.auth_is_trainer_user(trainer_id)
    OR (
      public.auth_is_client_user(client_id)
      AND COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') <> 'internal_only'
    )
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

-- Example usage after setup:
-- SELECT * FROM public.bootstrap_trainer_tenant(
--   'trainer-auth-user-id',
--   'MODE Demo Coaching',
--   'mode-demo-coaching',
--   'Coach Maya'
-- );
--
-- SELECT * FROM public.assign_client_to_trainer(
--   'client-auth-user-id',
--   'trainer-row-id'
-- );
