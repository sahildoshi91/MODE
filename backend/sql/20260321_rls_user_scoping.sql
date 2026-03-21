-- Production-safe RLS migration for user-scoped access to MODE tables.
-- Run in Supabase SQL editor or your migration runner.

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workouts FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workout_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workouts TO authenticated;

CREATE INDEX IF NOT EXISTS idx_workout_plans_user_id ON public.workout_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_user_id ON public.workouts (user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_plan_id ON public.workouts (plan_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT
      TO authenticated
      USING (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workout_plans'
      AND policyname = 'workout_plans_select_own'
  ) THEN
    CREATE POLICY workout_plans_select_own ON public.workout_plans
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workout_plans'
      AND policyname = 'workout_plans_insert_own'
  ) THEN
    CREATE POLICY workout_plans_insert_own ON public.workout_plans
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workout_plans'
      AND policyname = 'workout_plans_update_own'
  ) THEN
    CREATE POLICY workout_plans_update_own ON public.workout_plans
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workouts'
      AND policyname = 'workouts_select_own'
  ) THEN
    CREATE POLICY workouts_select_own ON public.workouts
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workouts'
      AND policyname = 'workouts_insert_own'
  ) THEN
    CREATE POLICY workouts_insert_own ON public.workouts
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workouts'
      AND policyname = 'workouts_update_own'
  ) THEN
    CREATE POLICY workouts_update_own ON public.workouts
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMIT;
