BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_onboarding_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  onboarding_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    onboarding_status IN ('not_started', 'in_progress', 'calibration_pending', 'completed')
  ),
  onboarding_progress JSONB NOT NULL DEFAULT '{"completed_steps":0,"total_steps":8,"current_step":"welcome"}'::jsonb,
  last_completed_step TEXT,
  identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  tone JSONB NOT NULL DEFAULT '{}'::jsonb,
  communication_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  coaching_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  scenario_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  philosophy JSONB NOT NULL DEFAULT '{}'::jsonb,
  non_negotiables JSONB NOT NULL DEFAULT '[]'::jsonb,
  boundaries JSONB NOT NULL DEFAULT '{}'::jsonb,
  media_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  calibration_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_onboarding_profiles_tenant_trainer
  ON public.trainer_onboarding_profiles (tenant_id, trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_onboarding_profiles_status
  ON public.trainer_onboarding_profiles (onboarding_status);

ALTER TABLE public.trainer_onboarding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_onboarding_profiles FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.trainer_onboarding_profiles TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_onboarding_profiles'
      AND policyname = 'trainer_onboarding_profiles_select_own'
  ) THEN
    CREATE POLICY trainer_onboarding_profiles_select_own ON public.trainer_onboarding_profiles
      FOR SELECT TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_onboarding_profiles'
      AND policyname = 'trainer_onboarding_profiles_insert_own'
  ) THEN
    CREATE POLICY trainer_onboarding_profiles_insert_own ON public.trainer_onboarding_profiles
      FOR INSERT TO authenticated
      WITH CHECK (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_onboarding_profiles'
      AND policyname = 'trainer_onboarding_profiles_update_own'
  ) THEN
    CREATE POLICY trainer_onboarding_profiles_update_own ON public.trainer_onboarding_profiles
      FOR UPDATE TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      )
      WITH CHECK (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trainer_onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  step_key TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('captured', 'clarified', 'edited', 'skipped', 'approved', 'rejected')),
  extracted_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(4, 3),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('trainer', 'assistant', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_onboarding_events_trainer_time
  ON public.trainer_onboarding_events (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_onboarding_events_conversation
  ON public.trainer_onboarding_events (conversation_id, created_at DESC);

ALTER TABLE public.trainer_onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_onboarding_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.trainer_onboarding_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_onboarding_events'
      AND policyname = 'trainer_onboarding_events_select_own'
  ) THEN
    CREATE POLICY trainer_onboarding_events_select_own ON public.trainer_onboarding_events
      FOR SELECT TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_onboarding_events'
      AND policyname = 'trainer_onboarding_events_insert_own'
  ) THEN
    CREATE POLICY trainer_onboarding_events_insert_own ON public.trainer_onboarding_events
      FOR INSERT TO authenticated
      WITH CHECK (
        public.auth_is_trainer_user(trainer_id)
        AND public.auth_is_tenant_member(tenant_id)
      );
  END IF;
END $$;

COMMIT;
