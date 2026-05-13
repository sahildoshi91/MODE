# Launch Gate / Staging Verification

## Phase
Launch Gate/Staging Verification follows Phase E service-role retirement, with one documented launch exception for private Supabase Storage signed URL issuance.

## SQL Migration
Use the checked-in migration file or the helper script. Do not hand-edit JSONB casts in the SQL editor.

`20260511f_retire_service_role_request_paths.sql` depends on the older storage lifecycle migration,
`20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql`, which creates
`public.storage_upload_grants` and `public.storage_object_ownership`. Run the prerequisite chain before
`20260511f`; otherwise Postgres will fail with `relation "public.storage_upload_grants" does not exist`.

Correct JSONB cast:

```sql
DEFAULT '{}'::jsonb
```

The invalid typo that caused the console failure was:

```sql
DEFAULT '{}':a:jsonb
```

Preferred apply path:

```bash
MODE_SECURITY_DATABASE_URL='postgres://...' npm run launch:apply-migrations
```

The helper applies the storage/security prerequisites first. It intentionally skips
`20260426f_lockdown_storage_objects_service_signed_urls_only.sql` on hosted Supabase because that
migration changes owner-managed `storage.objects`/`storage.buckets` tables and fails unless run by
the storage table owner.

```text
20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql
20260426g_add_account_deletion_audit_log.sql
20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql
20260426i_add_storage_cleanup_job_heartbeats.sql
20260511b_create_intelligence_jobs.sql
20260511c_database_hardening_indexes.sql
20260511e_drop_redundant_conversation_message_index.sql
20260511f_retire_service_role_request_paths.sql
20260512a_add_health_ping_rpc.sql
```

Dry-run validation only:

```bash
cd backend
./venv/bin/python scripts/apply_launch_gate_migrations.py --dry-run
```

If using the Supabase SQL editor manually, run `20260426e`, `20260426g`, `20260426h`, and
`20260426i` first, then rerun `20260511f`, then `20260512a`. Do not run `20260511f` alone on a
database where `20260426h` has not already been applied. Do not run `20260426f` on hosted Supabase
unless Supabase provides an owner-supported workflow for managing `storage.*` table policies.

## Verification Runner
Local non-prod smoke:

```bash
npm run launch:verify -- --local --allow-degraded-health
```

Staging smoke with DB security and authenticated chat:

```bash
MODE_SECURITY_DATABASE_URL='postgres://...' \
MODE_STAGING_AUTH_TOKEN='<sacrificial_or_test_user_token>' \
npm run launch:verify -- --base-url https://mode-backend-staging.onrender.com
```

Generate a disposable client token for chat/storage smoke:

```bash
APP_ENV=staging \
MODE_RUN_STAGING_SUPABASE_TESTS=1 \
./backend/venv/bin/python backend/scripts/staging_auth_smoke_token.py create-token
```

Validate the token before rerunning the authenticated gate:

```bash
APP_ENV=staging \
./backend/venv/bin/python backend/scripts/staging_auth_smoke_token.py validate-token
```

Optional storage signed URL smoke:

```bash
MODE_STAGING_AUTH_TOKEN='<test_user_token>' \
npm run launch:verify -- \
  --base-url https://mode-backend-staging.onrender.com \
  --run-storage-smoke \
  --storage-scope client_self
```

Optional account deletion enqueue smoke must use a sacrificial account:

```bash
MODE_ALLOW_ACCOUNT_DELETION_SMOKE=1 \
MODE_STAGING_AUTH_TOKEN='<sacrificial_user_token>' \
npm run launch:verify -- \
  --base-url https://mode-backend-staging.onrender.com \
  --run-account-deletion-enqueue-smoke
```

Optional TTFT load probe:

```bash
MODE_STAGING_AUTH_TOKEN_FILE=./staging_tokens.txt \
npm run launch:verify -- \
  --base-url https://mode-backend-staging.onrender.com \
  --chat-load-requests 50 \
  --chat-load-concurrency 50
```

## Gate Interpretation
- `GO`: all requested checks passed.
- `PASS with skipped gates`: local/smoke checks passed, but one or more launch gates were not requested.
- `NO-GO`: at least one requested check failed.

Skipping live DB, authenticated chat, storage, account deletion, or load checks means staging is not production-launch complete yet.

## Next Required Evidence
- Service-role retirement migration applied in staging with the storage signed URL exception documented.
- `/healthz` returns `ok=true`, includes `cache_age_ms`, and reports server `duration_ms` p95 < 100ms.
- Runtime route surface preflight passes against staging.
- Static service-role audit passes with `backend/app/api/v1/storage_private.py` as the only API-handler exception.
- Staging DB security check passes with mixed-tenant RLS posture.
- Chat stream emits token/done with valid `chat_trace`.
- Storage signed URL flow succeeds for allowed own paths and rejects cross-tenant paths.
- Account deletion enqueue returns `202 queued` for a sacrificial test account.
- TTFT p95 < 2.5s with 50 concurrent chat streams.
- Queue lag p95 < 30s under burst load.
