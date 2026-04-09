BEGIN;

CREATE TABLE IF NOT EXISTS public.generated_checkin_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  checkin_id UUID NOT NULL REFERENCES public.daily_checkins(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('training', 'nutrition')),
  assigned_mode TEXT NOT NULL CHECK (assigned_mode IN ('BEAST', 'BUILD', 'RECOVER', 'REST')),
  environment TEXT,
  time_available INTEGER,
  nutrition_day_note TEXT,
  used_yesterday_context BOOLEAN NOT NULL DEFAULT FALSE,
  request_fingerprint TEXT NOT NULL,
  revision_number INTEGER NOT NULL DEFAULT 1,
  raw_content JSONB NOT NULL,
  structured_content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, checkin_id, plan_type, request_fingerprint, revision_number)
);

ALTER TABLE public.generated_checkin_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_checkin_plans FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.generated_checkin_plans TO authenticated;

CREATE INDEX IF NOT EXISTS idx_generated_checkin_plans_client_date
  ON public.generated_checkin_plans (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_checkin_plans_checkin_type
  ON public.generated_checkin_plans (checkin_id, plan_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'generated_checkin_plans'
      AND policyname = 'generated_checkin_plans_select_visible'
  ) THEN
    CREATE POLICY generated_checkin_plans_select_visible ON public.generated_checkin_plans
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = generated_checkin_plans.client_id
            AND c.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          JOIN public.trainers t ON t.id = c.assigned_trainer_id
          WHERE c.id = generated_checkin_plans.client_id
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
      AND tablename = 'generated_checkin_plans'
      AND policyname = 'generated_checkin_plans_insert_own'
  ) THEN
    CREATE POLICY generated_checkin_plans_insert_own ON public.generated_checkin_plans
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = generated_checkin_plans.client_id
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
      AND tablename = 'generated_checkin_plans'
      AND policyname = 'generated_checkin_plans_update_own'
  ) THEN
    CREATE POLICY generated_checkin_plans_update_own ON public.generated_checkin_plans
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = generated_checkin_plans.client_id
            AND c.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = generated_checkin_plans.client_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
