BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generated_outputs_source_type_check'
      AND conrelid = 'public.ai_generated_outputs'::regclass
  ) THEN
    ALTER TABLE public.ai_generated_outputs
      DROP CONSTRAINT ai_generated_outputs_source_type_check;
  END IF;

  ALTER TABLE public.ai_generated_outputs
    ADD CONSTRAINT ai_generated_outputs_source_type_check
    CHECK (
      source_type IN (
        'chat',
        'talking_points',
        'generated_checkin_plan',
        'trainer_assistant_draft'
      )
    );
END $$;

COMMIT;
