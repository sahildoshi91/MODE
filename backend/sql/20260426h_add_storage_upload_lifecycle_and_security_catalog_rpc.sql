BEGIN;

CREATE TABLE IF NOT EXISTS public.storage_upload_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_token TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('client_self', 'trainer_workspace', 'trainer_client')),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  owner_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'verified', 'expired', 'rejected', 'cleaned')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_grants_owner_user
  ON public.storage_upload_grants (owner_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_upload_grants_owner_trainer
  ON public.storage_upload_grants (owner_trainer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_upload_grants_owner_client
  ON public.storage_upload_grants (owner_client_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_upload_grants_status_expiry
  ON public.storage_upload_grants (status, expires_at ASC);

ALTER TABLE public.storage_upload_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_upload_grants FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.storage_upload_grants FROM PUBLIC;
REVOKE ALL ON public.storage_upload_grants FROM anon;
REVOKE ALL ON public.storage_upload_grants FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_upload_grants TO service_role;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.storage_object_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  owner_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  source_upload_grant_id UUID REFERENCES public.storage_upload_grants(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deletion_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_storage_object_ownership_owner_user
  ON public.storage_object_ownership (owner_user_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_object_ownership_owner_trainer
  ON public.storage_object_ownership (owner_trainer_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_object_ownership_owner_client
  ON public.storage_object_ownership (owner_client_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_object_ownership_bucket_path
  ON public.storage_object_ownership (bucket, object_path);

ALTER TABLE public.storage_object_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_object_ownership FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.storage_object_ownership FROM PUBLIC;
REVOKE ALL ON public.storage_object_ownership FROM anon;
REVOKE ALL ON public.storage_object_ownership FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_object_ownership TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.security_list_public_tables()
RETURNS TABLE(table_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.relname::TEXT
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.security_list_public_tables() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.security_list_public_tables() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.security_list_public_tables() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.security_list_public_tables() TO service_role;
  END IF;
END $$;

COMMIT;
