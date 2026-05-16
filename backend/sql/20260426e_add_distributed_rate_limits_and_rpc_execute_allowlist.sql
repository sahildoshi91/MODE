BEGIN;

CREATE TABLE IF NOT EXISTS public.security_rate_limit_windows (
  rate_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rate_key, window_start, window_seconds)
);

ALTER TABLE public.security_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_rate_limit_windows FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.security_rate_limit_windows FROM PUBLIC;
REVOKE ALL ON public.security_rate_limit_windows FROM anon;
REVOKE ALL ON public.security_rate_limit_windows FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.security_rate_limit_windows TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.security_enforce_rate_limit(
  p_rate_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_window_seconds INTEGER := GREATEST(1, COALESCE(p_window_seconds, 60));
  v_limit INTEGER := GREATEST(1, COALESCE(p_limit, 1));
  v_key TEXT := NULLIF(BTRIM(COALESCE(p_rate_key, '')), '');
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_hit_count INTEGER;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'rate key is required';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_effective_now) / v_window_seconds) * v_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => v_window_seconds);

  INSERT INTO public.security_rate_limit_windows (
    rate_key,
    window_start,
    window_seconds,
    hit_count,
    created_at,
    updated_at
  )
  VALUES (
    v_key,
    v_window_start,
    v_window_seconds,
    1,
    v_effective_now,
    v_effective_now
  )
  ON CONFLICT (rate_key, window_start, window_seconds)
  DO UPDATE
  SET
    hit_count = public.security_rate_limit_windows.hit_count + 1,
    updated_at = EXCLUDED.updated_at
  RETURNING hit_count INTO v_hit_count;

  RETURN jsonb_build_object(
    'allowed', (v_hit_count <= v_limit),
    'count', v_hit_count,
    'limit', v_limit,
    'window_seconds', v_window_seconds,
    'retry_after_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_window_end - v_effective_now))))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_assert_rls_enabled(
  p_table_names TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_row RECORD;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOREACH v_name IN ARRAY COALESCE(p_table_names, ARRAY[]::TEXT[])
  LOOP
    SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO v_row
    FROM pg_class c
    JOIN pg_namespace n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = v_name;

    IF v_row IS NULL OR v_row.relrowsecurity IS DISTINCT FROM TRUE OR v_row.relforcerowsecurity IS DISTINCT FROM TRUE THEN
      v_missing := array_append(v_missing, v_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', COALESCE(array_length(v_missing, 1), 0) = 0,
    'missing_or_unforced', v_missing
  );
END;
$$;

DO $$
DECLARE
  fn_signature TEXT;
  fn_name TEXT;
  authenticated_allowlist TEXT[] := ARRAY[
    'auth_is_trainer_user',
    'auth_is_client_user',
    'auth_is_client_assigned_to_trainer',
    'auth_can_view_client',
    'auth_can_view_trainer',
    'auth_is_tenant_member',
    'auth_can_access_conversation',
    'chat_bootstrap_context',
    'trainer_coach_approve_output'
  ];
  service_role_only_allowlist TEXT[] := ARRAY[
    'bootstrap_trainer_tenant',
    'assign_client_to_trainer',
    'security_enforce_rate_limit',
    'security_assert_rls_enabled',
    'security_list_public_tables'
  ];
BEGIN
  FOR fn_signature, fn_name IN
    SELECT
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
      p.proname
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn_signature);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn_signature);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn_signature);
      IF fn_name = ANY(authenticated_allowlist) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn_signature);
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      IF fn_name = ANY(authenticated_allowlist) OR fn_name = ANY(service_role_only_allowlist) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_signature);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
