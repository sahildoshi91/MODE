BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.trainer_knowledge_documents(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  source_excerpt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_rules_trainer_active
  ON public.trainer_rules (trainer_id, is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_rules_tenant_trainer
  ON public.trainer_rules (tenant_id, trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_rules_category
  ON public.trainer_rules (category);

ALTER TABLE public.trainer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_rules FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.trainer_rules TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_rules'
      AND policyname = 'trainer_rules_select_own'
  ) THEN
    CREATE POLICY trainer_rules_select_own ON public.trainer_rules
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rules.trainer_id
            AND t.tenant_id = trainer_rules.tenant_id
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
      AND tablename = 'trainer_rules'
      AND policyname = 'trainer_rules_insert_own'
  ) THEN
    CREATE POLICY trainer_rules_insert_own ON public.trainer_rules
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rules.trainer_id
            AND t.tenant_id = trainer_rules.tenant_id
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
      AND tablename = 'trainer_rules'
      AND policyname = 'trainer_rules_update_own'
  ) THEN
    CREATE POLICY trainer_rules_update_own ON public.trainer_rules
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rules.trainer_id
            AND t.tenant_id = trainer_rules.tenant_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rules.trainer_id
            AND t.tenant_id = trainer_rules.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trainer_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.trainer_rules(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'archived')),
  rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_trainer_rule_versions_rule_id
  ON public.trainer_rule_versions (rule_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_rule_versions_trainer
  ON public.trainer_rule_versions (trainer_id, created_at DESC);

ALTER TABLE public.trainer_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_rule_versions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.trainer_rule_versions TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_rule_versions'
      AND policyname = 'trainer_rule_versions_select_own'
  ) THEN
    CREATE POLICY trainer_rule_versions_select_own ON public.trainer_rule_versions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rule_versions.trainer_id
            AND t.tenant_id = trainer_rule_versions.tenant_id
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
      AND tablename = 'trainer_rule_versions'
      AND policyname = 'trainer_rule_versions_insert_own'
  ) THEN
    CREATE POLICY trainer_rule_versions_insert_own ON public.trainer_rule_versions
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_rule_versions.trainer_id
            AND t.tenant_id = trainer_rule_versions.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
