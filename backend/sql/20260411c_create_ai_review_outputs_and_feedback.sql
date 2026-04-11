BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_generated_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('chat', 'talking_points', 'generated_checkin_plan')),
  source_ref_id TEXT,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  output_text TEXT,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'open' CHECK (review_status IN ('open', 'approved', 'rejected')),
  reviewed_output_text TEXT,
  reviewed_output_json JSONB,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, source_type, source_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_generated_outputs_trainer_status
  ON public.ai_generated_outputs (trainer_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generated_outputs_client_created
  ON public.ai_generated_outputs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generated_outputs_source
  ON public.ai_generated_outputs (source_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_ai_generated_outputs_tenant_trainer
  ON public.ai_generated_outputs (tenant_id, trainer_id);

ALTER TABLE public.ai_generated_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generated_outputs FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.ai_generated_outputs TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_generated_outputs'
      AND policyname = 'ai_generated_outputs_select_own'
  ) THEN
    CREATE POLICY ai_generated_outputs_select_own ON public.ai_generated_outputs
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_generated_outputs.trainer_id
            AND t.tenant_id = ai_generated_outputs.tenant_id
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
      AND tablename = 'ai_generated_outputs'
      AND policyname = 'ai_generated_outputs_insert_own'
  ) THEN
    CREATE POLICY ai_generated_outputs_insert_own ON public.ai_generated_outputs
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_generated_outputs.trainer_id
            AND t.tenant_id = ai_generated_outputs.tenant_id
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
      AND tablename = 'ai_generated_outputs'
      AND policyname = 'ai_generated_outputs_update_own'
  ) THEN
    CREATE POLICY ai_generated_outputs_update_own ON public.ai_generated_outputs
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_generated_outputs.trainer_id
            AND t.tenant_id = ai_generated_outputs.tenant_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_generated_outputs.trainer_id
            AND t.tenant_id = ai_generated_outputs.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  output_id UUID NOT NULL REFERENCES public.ai_generated_outputs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('edited', 'approved', 'rejected', 'auto_applied')),
  original_output_text TEXT,
  edited_output_text TEXT,
  original_output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  edited_output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_deltas JSONB NOT NULL DEFAULT '[]'::jsonb,
  apply_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (apply_status IN ('not_applicable', 'pending', 'applied', 'failed')),
  apply_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_output_created
  ON public.ai_feedback_events (output_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_trainer_created
  ON public.ai_feedback_events (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_tenant_trainer
  ON public.ai_feedback_events (tenant_id, trainer_id);

ALTER TABLE public.ai_feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_feedback_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.ai_feedback_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_feedback_events'
      AND policyname = 'ai_feedback_events_select_own'
  ) THEN
    CREATE POLICY ai_feedback_events_select_own ON public.ai_feedback_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_feedback_events.trainer_id
            AND t.tenant_id = ai_feedback_events.tenant_id
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
      AND tablename = 'ai_feedback_events'
      AND policyname = 'ai_feedback_events_insert_own'
  ) THEN
    CREATE POLICY ai_feedback_events_insert_own ON public.ai_feedback_events
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = ai_feedback_events.trainer_id
            AND t.tenant_id = ai_feedback_events.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
