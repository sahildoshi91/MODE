BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  structured_summary TEXT,
  knowledge_type TEXT NOT NULL DEFAULT 'other'
    CHECK (knowledge_type IN (
      'coaching_rule',
      'programming_preference',
      'nutrition_principle',
      'client_pattern',
      'communication_style',
      'business_policy',
      'other'
    )),
  scope TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'client_specific')),
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  source TEXT NOT NULL DEFAULT 'manual_note'
    CHECK (source IN ('manual_note', 'chat_capture', 'ai_suggestion', 'imported_doc')),
  confidence_score DOUBLE PRECISION,
  version_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER NOT NULL DEFAULT 0,
  conflict_group_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_entries_trainer_status
  ON public.trainer_knowledge_entries (trainer_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_entries_retrieval
  ON public.trainer_knowledge_entries (trainer_id, ai_enabled, scope, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_entries_client
  ON public.trainer_knowledge_entries (trainer_id, client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_entries_tags_gin
  ON public.trainer_knowledge_entries USING GIN (tags);

ALTER TABLE public.trainer_knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_entries FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_knowledge_entries TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_knowledge_entries'
      AND policyname = 'trainer_knowledge_entries_select_own'
  ) THEN
    CREATE POLICY trainer_knowledge_entries_select_own ON public.trainer_knowledge_entries
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_entries.trainer_id
            AND t.tenant_id = trainer_knowledge_entries.tenant_id
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
      AND tablename = 'trainer_knowledge_entries'
      AND policyname = 'trainer_knowledge_entries_insert_own'
  ) THEN
    CREATE POLICY trainer_knowledge_entries_insert_own ON public.trainer_knowledge_entries
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_entries.trainer_id
            AND t.tenant_id = trainer_knowledge_entries.tenant_id
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
      AND tablename = 'trainer_knowledge_entries'
      AND policyname = 'trainer_knowledge_entries_update_own'
  ) THEN
    CREATE POLICY trainer_knowledge_entries_update_own ON public.trainer_knowledge_entries
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_entries.trainer_id
            AND t.tenant_id = trainer_knowledge_entries.tenant_id
            AND t.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_entries.trainer_id
            AND t.tenant_id = trainer_knowledge_entries.tenant_id
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
      AND tablename = 'trainer_knowledge_entries'
      AND policyname = 'trainer_knowledge_entries_delete_own'
  ) THEN
    CREATE POLICY trainer_knowledge_entries_delete_own ON public.trainer_knowledge_entries
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_entries.trainer_id
            AND t.tenant_id = trainer_knowledge_entries.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trainer_knowledge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  knowledge_entry_id UUID NOT NULL REFERENCES public.trainer_knowledge_entries(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  structured_summary TEXT,
  edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_reason TEXT,
  UNIQUE (knowledge_entry_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_versions_entry
  ON public.trainer_knowledge_versions (knowledge_entry_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_versions_trainer
  ON public.trainer_knowledge_versions (trainer_id, created_at DESC);

ALTER TABLE public.trainer_knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_versions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.trainer_knowledge_versions TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_knowledge_versions'
      AND policyname = 'trainer_knowledge_versions_select_own'
  ) THEN
    CREATE POLICY trainer_knowledge_versions_select_own ON public.trainer_knowledge_versions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_versions.trainer_id
            AND t.tenant_id = trainer_knowledge_versions.tenant_id
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
      AND tablename = 'trainer_knowledge_versions'
      AND policyname = 'trainer_knowledge_versions_insert_own'
  ) THEN
    CREATE POLICY trainer_knowledge_versions_insert_own ON public.trainer_knowledge_versions
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_versions.trainer_id
            AND t.tenant_id = trainer_knowledge_versions.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trainer_knowledge_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  knowledge_entry_id UUID NOT NULL REFERENCES public.trainer_knowledge_entries(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  retrieval_score DOUBLE PRECISION,
  used_in_response BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_usage_logs_trainer
  ON public.trainer_knowledge_usage_logs (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_usage_logs_entry
  ON public.trainer_knowledge_usage_logs (knowledge_entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_usage_logs_conversation
  ON public.trainer_knowledge_usage_logs (conversation_id, created_at DESC);

ALTER TABLE public.trainer_knowledge_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_usage_logs FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.trainer_knowledge_usage_logs TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_knowledge_usage_logs'
      AND policyname = 'trainer_knowledge_usage_logs_select_own'
  ) THEN
    CREATE POLICY trainer_knowledge_usage_logs_select_own ON public.trainer_knowledge_usage_logs
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_usage_logs.trainer_id
            AND t.tenant_id = trainer_knowledge_usage_logs.tenant_id
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
      AND tablename = 'trainer_knowledge_usage_logs'
      AND policyname = 'trainer_knowledge_usage_logs_insert_own'
  ) THEN
    CREATE POLICY trainer_knowledge_usage_logs_insert_own ON public.trainer_knowledge_usage_logs
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_knowledge_usage_logs.trainer_id
            AND t.tenant_id = trainer_knowledge_usage_logs.tenant_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

INSERT INTO public.trainer_knowledge_entries (
  tenant_id,
  trainer_id,
  client_id,
  title,
  raw_content,
  structured_summary,
  knowledge_type,
  scope,
  tags,
  ai_enabled,
  status,
  source,
  confidence_score,
  version_count,
  usage_count,
  metadata,
  created_at,
  updated_at,
  archived_at
)
SELECT
  t.tenant_id,
  d.trainer_id,
  NULL,
  COALESCE(NULLIF(BTRIM(d.title), ''), 'Knowledge note'),
  COALESCE(NULLIF(BTRIM(d.raw_text), ''), COALESCE(NULLIF(BTRIM(d.title), ''), 'Knowledge note')),
  LEFT(COALESCE(NULLIF(BTRIM(d.raw_text), ''), ''), 240),
  'other',
  'global',
  '{}'::text[],
  TRUE,
  'active',
  'imported_doc',
  NULL,
  1,
  0,
  COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_document_id', d.id::text,
    'legacy_document_type', COALESCE(d.document_type, 'text')
  ),
  COALESCE(d.created_at, NOW()),
  COALESCE(d.created_at, NOW()),
  NULL
FROM public.trainer_knowledge_documents d
JOIN public.trainers t ON t.id = d.trainer_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trainer_knowledge_entries e
  WHERE e.trainer_id = d.trainer_id
    AND (e.metadata ->> 'legacy_document_id') = d.id::text
);

INSERT INTO public.trainer_knowledge_entries (
  tenant_id,
  trainer_id,
  client_id,
  title,
  raw_content,
  structured_summary,
  knowledge_type,
  scope,
  tags,
  ai_enabled,
  status,
  source,
  confidence_score,
  version_count,
  usage_count,
  metadata,
  created_at,
  updated_at,
  archived_at
)
SELECT
  r.tenant_id,
  r.trainer_id,
  NULL,
  LEFT(COALESCE(NULLIF(BTRIM(r.rule_text), ''), 'Trainer rule'), 88),
  COALESCE(NULLIF(BTRIM(r.rule_text), ''), 'Trainer rule'),
  LEFT(COALESCE(NULLIF(BTRIM(r.rule_text), ''), ''), 240),
  CASE
    WHEN r.category IN ('tone', 'communication', 'communication_style') THEN 'communication_style'
    WHEN r.category IN ('nutrition', 'nutrition_guidance', 'macro_guidance') THEN 'nutrition_principle'
    WHEN r.category IN ('programming', 'progression_logic', 'recovery_logic', 'exercise_selection') THEN 'programming_preference'
    WHEN r.category IN ('policy', 'business', 'billing') THEN 'business_policy'
    ELSE 'coaching_rule'
  END,
  'global',
  '{}'::text[],
  NOT COALESCE(r.is_archived, FALSE),
  CASE WHEN COALESCE(r.is_archived, FALSE) THEN 'archived' ELSE 'active' END,
  'ai_suggestion',
  r.confidence,
  GREATEST(1, COALESCE(r.current_version, 1)),
  0,
  COALESCE(r.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'legacy_rule_id', r.id::text,
      'legacy_document_id', r.document_id::text,
      'legacy_rule_category', COALESCE(r.category, 'general_coaching'),
      'legacy_source_excerpt', COALESCE(r.source_excerpt, '')
    ),
  COALESCE(r.created_at, NOW()),
  COALESCE(r.updated_at, r.created_at, NOW()),
  CASE WHEN COALESCE(r.is_archived, FALSE)
    THEN COALESCE(r.updated_at, r.created_at, NOW())
    ELSE NULL END
FROM public.trainer_rules r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trainer_knowledge_entries e
  WHERE e.trainer_id = r.trainer_id
    AND (e.metadata ->> 'legacy_rule_id') = r.id::text
);

INSERT INTO public.trainer_knowledge_versions (
  tenant_id,
  trainer_id,
  knowledge_entry_id,
  version_number,
  content,
  structured_summary,
  edited_by,
  created_at,
  change_reason
)
SELECT
  e.tenant_id,
  e.trainer_id,
  e.id,
  1,
  e.raw_content,
  e.structured_summary,
  NULL,
  COALESCE(e.created_at, NOW()),
  'Backfilled initial version'
FROM public.trainer_knowledge_entries e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trainer_knowledge_versions v
  WHERE v.knowledge_entry_id = e.id
);

COMMIT;
