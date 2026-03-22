BEGIN;

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

ALTER TABLE public.user_fitness_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_fitness_profiles FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_user_fitness_profiles_client_id ON public.user_fitness_profiles (client_id);

COMMIT;
