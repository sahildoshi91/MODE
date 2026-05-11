BEGIN;

CREATE TABLE IF NOT EXISTS public.atlas_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_type TEXT NOT NULL CHECK (
    knowledge_type IN (
      'adherence_strategy',
      'motivation_strategy',
      'programming_rule',
      'injury_modification_rule',
      'nutrition_coaching_pattern',
      'tone_pattern',
      'escalation_rule',
      'expectation_setting',
      'behavior_change_pattern',
      'accountability_pattern'
    )
  ),
  situation_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  client_context_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  generalized_learning TEXT NOT NULL,
  response_pattern TEXT,
  contraindications TEXT[],
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  privacy_risk_score NUMERIC NOT NULL DEFAULT 1 CHECK (privacy_risk_score >= 0 AND privacy_risk_score <= 1),
  evidence_count INTEGER NOT NULL DEFAULT 1 CHECK (evidence_count >= 0),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_status_type
  ON public.atlas_knowledge (status, knowledge_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_situation_tags
  ON public.atlas_knowledge USING GIN (situation_tags);
CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_client_context_tags
  ON public.atlas_knowledge USING GIN (client_context_tags);

CREATE TABLE IF NOT EXISTS public.atlas_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_learning TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  situation_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  client_context_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  privacy_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  privacy_risk_score NUMERIC NOT NULL DEFAULT 1 CHECK (privacy_risk_score >= 0 AND privacy_risk_score <= 1),
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  response_pattern TEXT,
  contraindications TEXT[],
  reviewer_status TEXT NOT NULL DEFAULT 'pending' CHECK (reviewer_status IN ('pending', 'approved', 'rejected', 'edited')),
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_atlas_review_queue_status_created
  ON public.atlas_review_queue (reviewer_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.atlas_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'trainer_correction',
      'trainer_approval',
      'trainer_rejection',
      'resolved_review_item',
      'programming_rule_observed',
      'trainer_deleted_extraction',
      'admin_import'
    )
  ),
  raw_source_type TEXT NOT NULL,
  sanitized_summary TEXT NOT NULL,
  proposed_learning_id UUID REFERENCES public.atlas_review_queue(id) ON DELETE SET NULL,
  privacy_risk_score NUMERIC NOT NULL DEFAULT 1 CHECK (privacy_risk_score >= 0 AND privacy_risk_score <= 1),
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('accepted', 'rejected', 'needs_review')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atlas_learning_events_type_created
  ON public.atlas_learning_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_learning_events_status_created
  ON public.atlas_learning_events (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.atlas_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Atlas',
  persona_summary TEXT NOT NULL,
  tone_rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  programming_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.atlas_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  privacy_risk_score NUMERIC CHECK (privacy_risk_score IS NULL OR (privacy_risk_score >= 0 AND privacy_risk_score <= 1)),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atlas_audit_logs_event_created
  ON public.atlas_audit_logs (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trainer_ai_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  knowledge_type TEXT NOT NULL,
  learned_rule TEXT NOT NULL,
  example_pattern_sanitized TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_ai_knowledge_trainer_status
  ON public.trainer_ai_knowledge (trainer_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.trainer_ai_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  sanitized_summary TEXT NOT NULL,
  proposed_rule TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('accepted', 'rejected', 'needs_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_ai_learning_events_trainer_created
  ON public.trainer_ai_learning_events (trainer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trainer_ai_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  proposed_rule TEXT NOT NULL,
  reason_detected TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  knowledge_type TEXT NOT NULL DEFAULT 'trainer_preference',
  example_pattern_sanitized TEXT,
  reviewer_status TEXT NOT NULL DEFAULT 'pending' CHECK (reviewer_status IN ('pending', 'approved', 'rejected', 'edited')),
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trainer_ai_review_queue_trainer_status
  ON public.trainer_ai_review_queue (trainer_id, reviewer_status, created_at DESC);

ALTER TABLE public.atlas_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_knowledge FORCE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_learning_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_review_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_knowledge FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_learning_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_ai_review_queue FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.atlas_knowledge TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.atlas_learning_events TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.atlas_review_queue TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.atlas_profile TO service_role;
    GRANT SELECT, INSERT ON public.atlas_audit_logs TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_ai_knowledge TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_ai_learning_events TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_ai_review_queue TO service_role;
  END IF;
END $$;

INSERT INTO public.atlas_profile (
  name,
  persona_summary,
  tone_rules,
  programming_defaults
)
SELECT
  'Atlas',
  'Atlas is MODE''s silent coaching intelligence layer. Atlas studies anonymized coaching patterns across the platform and helps each trainer''s AI improve inside its own tenant, while building a disciplined, privacy-safe coaching doctrine.',
  ARRAY[
    'calm authority',
    'direct language',
    'no shame',
    'no fake hype',
    'action over explanation',
    'consistency over intensity',
    'support first, pressure second',
    'clear next step in every coaching moment'
  ]::TEXT[],
  '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.atlas_profile WHERE name = 'Atlas'
);

COMMIT;
