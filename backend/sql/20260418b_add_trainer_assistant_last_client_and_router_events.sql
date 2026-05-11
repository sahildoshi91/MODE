BEGIN;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS assistant_last_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.trainer_assistant_router_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  execution_model TEXT NOT NULL,
  fallback_applied BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_applied BOOLEAN NOT NULL DEFAULT FALSE,
  second_pass_applied BOOLEAN NOT NULL DEFAULT FALSE,
  route_reason TEXT NOT NULL,
  latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  succeeded BOOLEAN NOT NULL DEFAULT TRUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_assistant_router_events_trainer_created
  ON public.trainer_assistant_router_events (trainer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trainer_assistant_router_events_client_created
  ON public.trainer_assistant_router_events (client_id, created_at DESC);

ALTER TABLE public.trainer_assistant_router_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_assistant_router_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.trainer_assistant_router_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_assistant_router_events'
      AND policyname = 'trainer_assistant_router_events_select_own'
  ) THEN
    CREATE POLICY trainer_assistant_router_events_select_own ON public.trainer_assistant_router_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_assistant_router_events.trainer_id
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
      AND tablename = 'trainer_assistant_router_events'
      AND policyname = 'trainer_assistant_router_events_insert_own'
  ) THEN
    CREATE POLICY trainer_assistant_router_events_insert_own ON public.trainer_assistant_router_events
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_assistant_router_events.trainer_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
