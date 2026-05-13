BEGIN;

CREATE OR REPLACE FUNCTION public.mode_health_ping()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'checked_at', transaction_timestamp()
  );
$$;

REVOKE ALL ON FUNCTION public.mode_health_ping() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.mode_health_ping() TO anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.mode_health_ping() TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.mode_health_ping() TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.mode_health_ping();
