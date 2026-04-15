BEGIN;

-- Seed template for client-first onboarding invite-code attach.
-- Replace the values in the CTE below before running in Supabase SQL editor.
WITH seed AS (
  SELECT
    'MODEDEMO2026'::TEXT AS invite_code,
    -- Default seeded trainer (Test Trainer); swap if you want a different trainer target.
    '5b72bf4e-ecd6-400f-8d29-fed82ce6795f'::UUID AS trainer_id,
    NULL::TIMESTAMPTZ AS expires_at,
    '{"seeded_by":"manual","purpose":"client-first-onboarding"}'::JSONB AS metadata
),
trainer_context AS (
  SELECT
    t.id AS trainer_id,
    t.tenant_id AS tenant_id,
    s.invite_code,
    s.expires_at,
    s.metadata
  FROM seed s
  JOIN public.trainers t ON t.id = s.trainer_id
)
INSERT INTO public.trainer_invite_codes (
  code,
  trainer_id,
  tenant_id,
  is_active,
  expires_at,
  metadata
)
SELECT
  tc.invite_code,
  tc.trainer_id,
  tc.tenant_id,
  TRUE,
  tc.expires_at,
  tc.metadata
FROM trainer_context tc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trainer_invite_codes tic
  WHERE LOWER(tic.code) = LOWER(tc.invite_code)
);

-- Verification query.
-- SELECT id, code, trainer_id, tenant_id, is_active, expires_at
-- FROM public.trainer_invite_codes
-- WHERE LOWER(code) = LOWER('MODEDEMO2026');

COMMIT;
