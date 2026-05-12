# Release Security Runner

The canonical release security command is:

```bash
npm run release:security
```

Default behavior is release mode (fail-closed). Use local mode explicitly:

```bash
npm run release:security -- --local
```

Run a single gate by id:

```bash
npm run release:security -- --only storage
```

Load a local env file (process env still has precedence):

```bash
npm run release:security -- --env-file .env.release
```

## Runner Modes

### Release mode (default)
- never skips required gates
- exits `0` only when all gates pass
- exits `1` on any release-blocking failure
- requires a real IPA for iOS artifact scanning (`MODE_IOS_IPA_PATH` or `--ipa`)

### Local mode (`--local`)
- may skip unavailable live gates with warning notes
- still runs static/unit hardening checks

## Artifacts

Each run writes artifacts to:

- `security_artifacts/release/YYYY-MM-DD-HHMMSS/`

Generated files include:
- `gate_<gate_id>.log`
- `matrix.md`
- `summary.json`
- `console_output.txt`

## Required Secrets / Environment

Release mode expects these values to be configured:
- `APP_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MODE_SECURITY_DATABASE_URL`
- `OPENAI_API_KEY`
- `REDIS_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SUPABASE_REDIRECT_URL`
- `MODE_IOS_IPA_PATH` (or `--ipa`)
- `RATE_LIMIT_BACKEND=redis`
- `STARTUP_GUARD_ENABLED=true`
- `AUTH_PASSWORD_PROXY_ENABLED=true`
- `ACCOUNT_DELETION_ENABLED=true`
- `ACCOUNT_DELETION_CONTRACT_ENFORCED=true`
- `PERSONAL_DATA_INVENTORY_PATH=security/personal_data_inventory.json`
- `ACCOUNT_DELETION_ACTIVE_SINK_CATEGORIES`
- `ACCOUNT_DELETION_DISABLED_SINK_CATEGORIES`

Storage heartbeat/orphan thresholds:
- `MODE_STORAGE_ORPHAN_THRESHOLD` (default `0`)
- `MODE_STORAGE_CLEANUP_MAX_HEARTBEAT_AGE_MINUTES` (default `30`)
- `MODE_STORAGE_CLEANUP_EXPECTED_INTERVAL_MINUTES` (default `15`)

Environment setup guide:
- `docs/security/release_env_setup.md`

## CI Command

CI release path (manual workflow dispatch) executes:

```bash
npm run release:security
```

PR/push local validation executes:

```bash
npm run release:security -- --local
```

## Command Examples

```bash
npm run release:security -- --env-file .env.release
npm run release:security -- --env-file .env.staging --local
npm run release:security -- --only environment --env-file .env.release
npm run release:security -- --only environment --env-file .env.staging --local
```

Workflow file:
- `.github/workflows/release-security.yml`

Release CI invocation:

```bash
npm run release:security
```

Local CI invocation:

```bash
npm run release:security -- --local
```

## Example GO Output

```text
MODE Release Security Gate Results

| Gate | Status | Notes |
|---|---|---|
| Environment validation | PASS | - |
| Live DB posture | PASS | - |
| Cross-tenant integration | PASS | - |
| GDPR deletion coverage | PASS | - |
| Storage security | PASS | - |
| iOS artifact scan | PASS | - |
| AI adversarial tests | PASS | - |
| Mobile hardening | PASS | - |

GO — READY FOR APP STORE SUBMISSION
```

## Example NO-GO Output

```text
MODE Release Security Gate Results

| Gate | Status | Notes |
|---|---|---|
| Environment validation | FAIL | Missing required environment variables: MODE_SECURITY_DATABASE_URL |
| Live DB posture | FAIL | MODE_SECURITY_DATABASE_URL is required for live DB posture checks |
| Cross-tenant integration | PASS | - |
| GDPR deletion coverage | PASS | - |
| Storage security | FAIL | No scheduled storage cleanup heartbeat found |
| iOS artifact scan | FAIL | Release mode requires a real IPA path (MODE_IOS_IPA_PATH or --ipa) |
| AI adversarial tests | PASS | - |
| Mobile hardening | PASS | - |

NO-GO — BLOCKED
Failing gates: Environment validation (environment), Live DB posture (live-db), Storage security (storage), iOS artifact scan (ios-artifact)
Rerun commands:
- npm run release:security -- --only environment
- npm run release:security -- --only live-db
- npm run release:security -- --only storage
- npm run release:security -- --only ios-artifact
Missing env vars/secrets by category:
- App runtime: APP_ENV
- Supabase server/security config: MODE_SECURITY_DATABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- Supabase public client config: EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_SUPABASE_URL
- iOS artifact config: MODE_IOS_IPA_PATH
Exact fix:
- Copy template with placeholders: cp .env.release.example .env.release
- Fill placeholders using approved secret-manager values (never commit real secrets).
- Re-run env preflight: npm run release:security -- --only environment --env-file .env.release
- Re-run release gates: npm run release:security -- --env-file .env.release
Generated artifacts/logs:
- security_artifacts/release/2026-04-26-121500
```

## Expected Result Patterns

- Missing required envs in release mode:
  - `NO-GO — BLOCKED`
  - grouped missing-env diagnostics with exact fix steps
  - exit code `1`
- Complete env + passing gates:
  - `GO — READY FOR APP STORE SUBMISSION`
  - exit code `0`
