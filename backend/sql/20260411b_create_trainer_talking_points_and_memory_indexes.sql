BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_talking_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  generation_strategy TEXT NOT NULL DEFAULT 'deterministic',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_talking_points_trainer_expiry
  ON public.trainer_talking_points (trainer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_talking_points_tenant_trainer
  ON public.trainer_talking_points (tenant_id, trainer_id);

ALTER TABLE public.trainer_talking_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_talking_points FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.trainer_talking_points TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_talking_points'
      AND policyname = 'trainer_talking_points_select_own'
  ) THEN
    CREATE POLICY trainer_talking_points_select_own ON public.trainer_talking_points
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_talking_points.trainer_id
            AND t.tenant_id = trainer_talking_points.tenant_id
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
      AND tablename = 'trainer_talking_points'
      AND policyname = 'trainer_talking_points_insert_own'
  ) THEN
    CREATE POLICY trainer_talking_points_insert_own ON public.trainer_talking_points
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_talking_points.trainer_id
            AND t.tenant_id = trainer_talking_points.tenant_id
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
      AND tablename = 'trainer_talking_points'
      AND policyname = 'trainer_talking_points_update_own'
  ) THEN
    CREATE POLICY trainer_talking_points_update_own ON public.trainer_talking_points
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_talking_points.trainer_id
            AND t.tenant_id = trainer_talking_points.tenant_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_talking_points.trainer_id
            AND t.tenant_id = trainer_talking_points.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coach_memory_trainer_client_updated
  ON public.coach_memory (trainer_id, client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_coach_memory_visibility
  ON public.coach_memory ((value_json ->> 'visibility'));

COMMIT;
