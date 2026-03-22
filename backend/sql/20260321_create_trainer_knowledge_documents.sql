BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_url TEXT,
  document_type TEXT,
  raw_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexing_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_knowledge_documents FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trainer_knowledge_documents_trainer_id ON public.trainer_knowledge_documents (trainer_id);

COMMIT;
