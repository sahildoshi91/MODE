BEGIN;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS default_meeting_location TEXT,
  ADD COLUMN IF NOT EXISTS auto_fill_meeting_location BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.trainer_client_schedule_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  recurring_weekdays INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  preferred_meeting_location TEXT,
  auto_use_trainer_default_location BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, client_id),
  CONSTRAINT trainer_client_schedule_preferences_weekdays_valid
    CHECK (recurring_weekdays <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[])
);

CREATE TABLE IF NOT EXISTS public.trainer_client_schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('skip', 'add')),
  meeting_location_override TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, client_id, session_date)
);

ALTER TABLE public.trainer_client_schedule_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_client_schedule_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_client_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_client_schedule_exceptions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_client_schedule_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_client_schedule_exceptions TO authenticated;

CREATE INDEX IF NOT EXISTS idx_trainer_client_schedule_preferences_trainer_client
  ON public.trainer_client_schedule_preferences (trainer_id, client_id);

CREATE INDEX IF NOT EXISTS idx_trainer_client_schedule_exceptions_trainer_client_date
  ON public.trainer_client_schedule_exceptions (trainer_id, client_id, session_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_preferences'
      AND policyname = 'trainer_client_schedule_preferences_select_visible'
  ) THEN
    CREATE POLICY trainer_client_schedule_preferences_select_visible ON public.trainer_client_schedule_preferences
      FOR SELECT TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        OR public.auth_is_client_user(client_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_preferences'
      AND policyname = 'trainer_client_schedule_preferences_insert_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_preferences_insert_trainer ON public.trainer_client_schedule_preferences
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_preferences'
      AND policyname = 'trainer_client_schedule_preferences_update_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_preferences_update_trainer ON public.trainer_client_schedule_preferences
      FOR UPDATE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id))
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_preferences'
      AND policyname = 'trainer_client_schedule_preferences_delete_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_preferences_delete_trainer ON public.trainer_client_schedule_preferences
      FOR DELETE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_exceptions'
      AND policyname = 'trainer_client_schedule_exceptions_select_visible'
  ) THEN
    CREATE POLICY trainer_client_schedule_exceptions_select_visible ON public.trainer_client_schedule_exceptions
      FOR SELECT TO authenticated
      USING (
        public.auth_is_trainer_user(trainer_id)
        OR public.auth_is_client_user(client_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_exceptions'
      AND policyname = 'trainer_client_schedule_exceptions_insert_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_exceptions_insert_trainer ON public.trainer_client_schedule_exceptions
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_exceptions'
      AND policyname = 'trainer_client_schedule_exceptions_update_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_exceptions_update_trainer ON public.trainer_client_schedule_exceptions
      FOR UPDATE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id))
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_client_schedule_exceptions'
      AND policyname = 'trainer_client_schedule_exceptions_delete_trainer'
  ) THEN
    CREATE POLICY trainer_client_schedule_exceptions_delete_trainer ON public.trainer_client_schedule_exceptions
      FOR DELETE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

COMMIT;
