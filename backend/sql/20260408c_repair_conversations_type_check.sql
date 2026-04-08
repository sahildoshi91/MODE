BEGIN;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_type_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_type_check
  CHECK (type IN ('onboarding', 'coach', 'chat', 'workout_feedback'));

COMMIT;
