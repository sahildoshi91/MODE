BEGIN;

ALTER TABLE public.generated_checkin_plans
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

ALTER TABLE public.generated_checkin_plans
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

UPDATE public.generated_checkin_plans
SET request_fingerprint = md5(
  concat_ws(
    '|',
    checkin_id::text,
    plan_type,
    coalesce(environment, ''),
    coalesce(time_available::text, ''),
    coalesce(nutrition_day_note, ''),
    used_yesterday_context::text
  )
)
WHERE request_fingerprint IS NULL;

ALTER TABLE public.generated_checkin_plans
  ALTER COLUMN request_fingerprint SET NOT NULL;

ALTER TABLE public.generated_checkin_plans
  DROP CONSTRAINT IF EXISTS generated_checkin_plans_client_id_checkin_id_plan_type_key;

ALTER TABLE public.generated_checkin_plans
  ADD CONSTRAINT generated_checkin_plans_variant_key
  UNIQUE (client_id, checkin_id, plan_type, request_fingerprint, revision_number);

CREATE INDEX IF NOT EXISTS idx_generated_checkin_plans_fingerprint_revision
  ON public.generated_checkin_plans (client_id, checkin_id, plan_type, request_fingerprint, revision_number DESC);

COMMIT;
