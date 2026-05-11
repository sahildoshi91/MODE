BEGIN;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

    REVOKE ALL ON storage.objects FROM PUBLIC;
    REVOKE ALL ON storage.objects FROM anon;
    REVOKE ALL ON storage.objects FROM authenticated;

    DROP POLICY IF EXISTS mode_storage_objects_deny_authenticated ON storage.objects;
    CREATE POLICY mode_storage_objects_deny_authenticated
      ON storage.objects
      FOR ALL TO authenticated
      USING (FALSE)
      WITH CHECK (FALSE);

    DROP POLICY IF EXISTS mode_storage_objects_deny_anon ON storage.objects;
    CREATE POLICY mode_storage_objects_deny_anon
      ON storage.objects
      FOR ALL TO anon
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.buckets FORCE ROW LEVEL SECURITY;

    UPDATE storage.buckets
    SET public = FALSE
    WHERE public = TRUE;

    REVOKE ALL ON storage.buckets FROM PUBLIC;
    REVOKE ALL ON storage.buckets FROM anon;
    REVOKE ALL ON storage.buckets FROM authenticated;

    DROP POLICY IF EXISTS mode_storage_buckets_deny_authenticated ON storage.buckets;
    CREATE POLICY mode_storage_buckets_deny_authenticated
      ON storage.buckets
      FOR ALL TO authenticated
      USING (FALSE)
      WITH CHECK (FALSE);

    DROP POLICY IF EXISTS mode_storage_buckets_deny_anon ON storage.buckets;
    CREATE POLICY mode_storage_buckets_deny_anon
      ON storage.buckets
      FOR ALL TO anon
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
END $$;

COMMIT;
