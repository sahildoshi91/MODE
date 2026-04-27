# Release Hardening Gates

## Scope
This runbook documents enforceable release blockers for:
- GDPR deletion contract coverage
- live DB permission posture
- storage upload expiry/orphan cleanup
- production runtime preflight
- iOS hardening and artifact scans
- storage deny-by-default enforcement

## Required Environment Variables

### Production runtime + preflight
- `APP_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RATE_LIMIT_BACKEND=postgres`
- `PERSONAL_DATA_INVENTORY_PATH` (optional override, defaults to `security/personal_data_inventory.json`)
- `ACCOUNT_DELETION_CONTRACT_ENFORCED=true`
- `ACCOUNT_DELETION_ACTIVE_SINK_CATEGORIES=file_storage,retrieval_caches,analytics_events`
- `ACCOUNT_DELETION_DISABLED_SINK_CATEGORIES=vector_indexes,embedding_stores,logs,notification_providers,email_providers,ai_memory_retrieval_systems`
- `STORAGE_UPLOAD_WINDOW_SECONDS` in `[30,300]`

### Staging/prod live DB checks
- `MODE_SECURITY_DATABASE_URL` (direct Postgres URL)
- `MODE_RUN_STAGING_SUPABASE_TESTS=1`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### iOS artifact checks
- `MODE_IOS_IPA_PATH`
- `MODE_IOS_INFO_PLIST_PATH` (required when running lint in prebuild-required mode)
- `EXPO_PUBLIC_SUPABASE_REDIRECT_URL=mode://auth/callback`

## Commands

### Schema deletion coverage
```bash
cd backend
./venv/bin/python scripts/check_personal_data_inventory.py
```

### Live schema + deletion inventory parity
```bash
cd backend
MODE_SECURITY_DATABASE_URL='postgres://...' ./venv/bin/python scripts/check_personal_data_inventory.py --check-live
```

### Staging DB permission posture check
```bash
cd backend
MODE_SECURITY_DATABASE_URL='postgres://...' ./venv/bin/python scripts/staging_db_security_check.py
```

### Storage deny-by-default codepath audit
```bash
python scripts/storage_access_audit.py
```

### Upload expiry/orphan cleanup tests
```bash
cd backend
./venv/bin/pytest -q \
  tests/test_storage_private_api.py \
  tests/test_storage_orphan_cleanup_service.py
```

### Run orphan cleanup job manually
```bash
cd backend
./venv/bin/python scripts/storage_orphan_cleanup.py --dry-run
./venv/bin/python scripts/storage_orphan_cleanup.py
```

### Production preflight
```bash
cd backend
APP_ENV=production RATE_LIMIT_BACKEND=postgres ./venv/bin/python scripts/security_release_preflight.py --env production
```

### iOS hardening lint + artifact scan
```bash
python scripts/ios_hardening_lint.py --require-prebuild
python scripts/ios_artifact_scan.py --require-ipa
```

### Full security regression suite
```bash
cd backend
MODE_SECURITY_TARGET_ENV=production ./scripts/security_regression_suite.sh
```

## Scheduled Jobs

### Storage orphan cleanup schedule
- Frequency: every 15 minutes in staging + production.
- Command:
  - `cd backend && ./venv/bin/python scripts/storage_orphan_cleanup.py`
- Hard-fail behavior:
  - non-zero exit must page deployment/runtime owners
  - release promotion is blocked if last successful run is stale

## Failure Examples

### Personal data inventory drift
```text
Personal data inventory check: FAILED
- Migration tables missing from inventory: trainer_new_table
```

### Staging DB privileged RPC exposure
```text
Staging DB security check: FAILED
- Privileged RPC security_enforce_rate_limit is executable by forbidden role authenticated
```

### Dangerous policy regression
```text
Staging DB security check: FAILED
- Dangerous policy detected (public.clients:clients_select_all): USING (true)
```

### Storage policy regression
```text
Staging DB security check: FAILED
- storage.objects grants SELECT to authenticated; expected deny-by-default
```

### Production preflight config failure
```text
Security release preflight: FAILED
- APP_ENV is required and must be set to production for release preflight.
- account_deletion_contract_enforced must be true in production.
```

### iOS artifact leak
```text
iOS artifact scan: FAILED
- service_role_or_secret_keys:Payload/main.jsbundle:SUPABASE_SERVICE_ROLE_KEY
```

## Local vs Production Behavior

### Local/dev
- `APP_ENV` may be non-production.
- Preflight can run with `--env development` for non-blocking checks.
- iOS IPA scan can be skipped when no artifact exists.

### Production/release
- `security_release_preflight.py --env production` is mandatory.
- `staging_db_security_check.py` is mandatory.
- iOS lint + IPA scan are mandatory.
- any failing security gate blocks deploy.
