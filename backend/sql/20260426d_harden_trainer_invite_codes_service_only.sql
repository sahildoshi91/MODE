BEGIN;

-- Harden invite codes as service-managed secrets.
ALTER TABLE public.trainer_invite_codes
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE public.trainer_invite_codes
SET code_hash = encode(digest(lower(btrim(code)), 'sha256'), 'hex')
WHERE code_hash IS NULL
  AND code IS NOT NULL
  AND btrim(code) <> '';

ALTER TABLE public.trainer_invite_codes
  ALTER COLUMN code_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_invite_codes_code_hash_unique
  ON public.trainer_invite_codes (code_hash);

CREATE INDEX IF NOT EXISTS idx_trainer_invite_codes_active_hash_lookup
  ON public.trainer_invite_codes (code_hash, is_active, expires_at, revoked_at, used_at);

-- Service-only table access. RLS remains enabled+forced; no client policies are created.
REVOKE ALL ON public.trainer_invite_codes FROM PUBLIC;
REVOKE ALL ON public.trainer_invite_codes FROM anon;
REVOKE ALL ON public.trainer_invite_codes FROM authenticated;

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_invite_codes'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.trainer_invite_codes',
      policy_row.policyname
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.trainer_invite_codes IS
  'Service-only invite codes. Client/trainer roles are denied direct table access; redemption must flow through secured backend endpoints.';

COMMIT;
