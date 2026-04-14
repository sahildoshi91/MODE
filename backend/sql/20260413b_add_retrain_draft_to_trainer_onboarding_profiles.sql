BEGIN;

ALTER TABLE public.trainer_onboarding_profiles
  ADD COLUMN IF NOT EXISTS retrain_draft JSONB,
  ADD COLUMN IF NOT EXISTS retrain_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trainer_onboarding_profiles_retrain_started_at
  ON public.trainer_onboarding_profiles (retrain_started_at DESC)
  WHERE retrain_started_at IS NOT NULL;

COMMIT;
