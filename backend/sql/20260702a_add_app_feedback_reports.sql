BEGIN;

CREATE TYPE feedback_report_type AS ENUM ('bug', 'feature_request', 'feedback');
CREATE TYPE feedback_report_status AS ENUM ('open', 'in_review', 'resolved', 'dismissed');

CREATE TABLE public.app_feedback_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type feedback_report_type NOT NULL,
  summary TEXT NOT NULL,
  steps_to_reproduce TEXT,
  screen_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  debug_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  screenshot_bucket TEXT,
  screenshot_object_path TEXT,
  status feedback_report_status NOT NULL DEFAULT 'open',
  admin_notes TEXT,
  last_reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_feedback_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feedback_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_insert_own_feedback"
ON public.app_feedback_reports FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_select_own_feedback"
ON public.app_feedback_reports FOR SELECT
USING (user_id = auth.uid());

COMMIT;
