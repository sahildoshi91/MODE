BEGIN;

CREATE TABLE IF NOT EXISTS public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL UNIQUE REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('client', 'trainer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.onboarding_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL UNIQUE REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  flow_key TEXT NOT NULL DEFAULT 'client_v1',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  current_step TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainer_profile_core (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL UNIQUE REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  trainer_name TEXT,
  contact_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trainer_invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_invite_codes_code_unique
  ON public.trainer_invite_codes (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_trainer_invite_codes_trainer_id
  ON public.trainer_invite_codes (trainer_id);

CREATE INDEX IF NOT EXISTS idx_trainer_invite_codes_tenant_id
  ON public.trainer_invite_codes (tenant_id);

CREATE TABLE IF NOT EXISTS public.mobile_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_analytics_events_user_event_time
  ON public.mobile_analytics_events (user_id, event_name, event_timestamp DESC);

ALTER TABLE public.user_fitness_profiles
  ADD COLUMN IF NOT EXISTS training_location TEXT,
  ADD COLUMN IF NOT EXISTS minimum_win TEXT,
  ADD COLUMN IF NOT EXISTS weekly_availability INTEGER,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_last_step TEXT;

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_states FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_profile_core ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_profile_core FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_invite_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_analytics_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.user_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.onboarding_states TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_profile_core TO authenticated;
GRANT SELECT, INSERT ON public.mobile_analytics_events TO authenticated;

DROP POLICY IF EXISTS user_accounts_select_own ON public.user_accounts;
CREATE POLICY user_accounts_select_own ON public.user_accounts
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS user_accounts_insert_own ON public.user_accounts;
CREATE POLICY user_accounts_insert_own ON public.user_accounts
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS user_accounts_update_own ON public.user_accounts;
CREATE POLICY user_accounts_update_own ON public.user_accounts
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = user_roles.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS user_roles_insert_own ON public.user_roles;
CREATE POLICY user_roles_insert_own ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = user_roles.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS user_roles_update_own ON public.user_roles;
CREATE POLICY user_roles_update_own ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = user_roles.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = user_roles.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onboarding_states_select_own ON public.onboarding_states;
CREATE POLICY onboarding_states_select_own ON public.onboarding_states
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = onboarding_states.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onboarding_states_insert_own ON public.onboarding_states;
CREATE POLICY onboarding_states_insert_own ON public.onboarding_states
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = onboarding_states.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onboarding_states_update_own ON public.onboarding_states;
CREATE POLICY onboarding_states_update_own ON public.onboarding_states
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = onboarding_states.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = onboarding_states.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS trainer_profile_core_select_own ON public.trainer_profile_core;
CREATE POLICY trainer_profile_core_select_own ON public.trainer_profile_core
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = trainer_profile_core.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS trainer_profile_core_insert_own ON public.trainer_profile_core;
CREATE POLICY trainer_profile_core_insert_own ON public.trainer_profile_core
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = trainer_profile_core.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS trainer_profile_core_update_own ON public.trainer_profile_core;
CREATE POLICY trainer_profile_core_update_own ON public.trainer_profile_core
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = trainer_profile_core.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_accounts ua
      WHERE ua.id = trainer_profile_core.user_account_id
        AND ua.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mobile_analytics_events_select_own ON public.mobile_analytics_events;
CREATE POLICY mobile_analytics_events_select_own ON public.mobile_analytics_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS mobile_analytics_events_insert_own ON public.mobile_analytics_events;
CREATE POLICY mobile_analytics_events_insert_own ON public.mobile_analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

COMMIT;
