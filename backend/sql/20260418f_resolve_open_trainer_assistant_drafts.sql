BEGIN;

UPDATE public.ai_generated_outputs
SET
  review_status = 'rejected',
  queue_state = 'resolved',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW(),
  last_event_at = NOW()
WHERE source_type = 'trainer_assistant_draft'
  AND review_status = 'open';

COMMIT;
