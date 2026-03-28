BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  inputs JSONB NOT NULL,
  total_score INTEGER NOT NULL CHECK (total_score BETWEEN 5 AND 25),
  assigned_mode TEXT NOT NULL CHECK (assigned_mode IN ('GREEN', 'YELLOW', 'BLUE', 'RED')),
  time_to_complete INTEGER,
  completion_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, date)
);

ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_checkins FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.daily_checkins TO authenticated;

CREATE INDEX IF NOT EXISTS idx_daily_checkins_client_date
  ON public.daily_checkins (client_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_mode_date
  ON public.daily_checkins (assigned_mode, date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_checkins'
      AND policyname = 'daily_checkins_select_visible'
  ) THEN
    CREATE POLICY daily_checkins_select_visible ON public.daily_checkins
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = daily_checkins.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = daily_checkins.client_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_checkins'
      AND policyname = 'daily_checkins_insert_own'
  ) THEN
    CREATE POLICY daily_checkins_insert_own ON public.daily_checkins
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = daily_checkins.client_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_checkins'
      AND policyname = 'daily_checkins_update_own'
  ) THEN
    CREATE POLICY daily_checkins_update_own ON public.daily_checkins
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = daily_checkins.client_id
            AND c.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = daily_checkins.client_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
