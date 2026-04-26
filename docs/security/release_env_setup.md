# Release Env Setup

Use this guide to prepare safe local env files for release security checks without weakening fail-closed behavior.

## Quick Start

1. Create local env files from placeholders only:
   - `cp .env.release.example .env.release`
   - `cp .env.staging.example .env.staging`
2. Replace placeholders using approved secret managers.
3. Never commit `.env.release` or `.env.staging` (they are gitignored).
4. Run preflight-only env validation first:
   - `npm run release:security -- --only environment --env-file .env.release`
5. Run full release gate:
   - `npm run release:security -- --env-file .env.release`

## Variable Reference

| Variable | Purpose | Where to get it | Usage (local/staging/prod) | Secret | Allowed in mobile client | Placeholder example |
|---|---|---|---|---|---|---|
| `APP_ENV` | Selects runtime mode used by security preflight and startup guards. | Deployment config. | local optional; staging required; prod required (`production`/`prod`). | No | No | `<production_or_prod>` |
| `OPENAI_API_KEY` | Enables AI-related security tests/services. | OpenAI secrets manager. | local optional/test; staging required for real checks; prod required. | Yes | No | `<openai_api_key_secret>` |
| `SUPABASE_URL` | Server-side Supabase project URL used by backend checks/tests. | Supabase project settings (API URL). | local optional unless live checks; staging required; prod required. | No | No | `<https://your-project-ref.supabase.co>` |
| `SUPABASE_ANON_KEY` | Public anon key used by integration auth flows/tests. | Supabase project settings (anon key). | local optional unless integration checks; staging required; prod required. | Treat as sensitive | Yes (as `EXPO_PUBLIC_SUPABASE_ANON_KEY`) | `<supabase_anon_key_secret>` |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server key for security-sensitive DB/storage operations. | Supabase project settings (service role key). | local optional unless live checks; staging required; prod required. | Yes | No | `<supabase_service_role_key_secret>` |
| `MODE_SECURITY_DATABASE_URL` | Direct Postgres URL for live DB posture and heartbeat checks. | Supabase connection settings / DB secrets manager. | local optional with `--local`; staging required for live posture; prod required. | Yes | No | `<postgresql://postgres:<password>@<db-host>:5432/postgres>` |
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile client Supabase URL used for public-client config validation. | Same source as `SUPABASE_URL`. | local optional; staging recommended; prod required. | No | Yes | `<https://your-project-ref.supabase.co>` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile client anon key for Expo/Supabase auth. | Same source as `SUPABASE_ANON_KEY`. | local optional; staging recommended; prod recommended. | Treat as sensitive | Yes | `<supabase_anon_key_public>` |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile API origin checked for staging/local leakage. | API gateway/deployment config. | local optional; staging recommended; prod required (HTTPS). | No | Yes | `<https://api.your-domain.com>` |
| `EXPO_PUBLIC_SUPABASE_REDIRECT_URL` | Redirect URI used by auth/deep-link security checks. | App auth config. | local recommended; staging recommended; prod recommended. | No | Yes | `<mode://auth/callback>` |
| `MODE_IOS_IPA_PATH` | Path to release IPA for artifact scan gate. | CI artifact output or local build path. | local optional in `--local`; staging optional; prod required in release mode. | No | No | `<build/ios/release.ipa>` |
| `MODE_IOS_INFO_PLIST_PATH` | Optional Info.plist override for iOS hardening lint. | iOS project tree. | local optional; staging optional; prod optional (used when override needed). | No | No | `<ios/YourApp/Info.plist>` |
| `RATE_LIMIT_BACKEND` | Enforces backend limiter backend policy. | Backend runtime config. | local often `memory`; staging/prod expected `postgres` for release checks. | No | No | `<postgres>` |
| `STARTUP_GUARD_ENABLED` | Ensures startup guard protections are enabled. | Backend runtime config. | local optional; staging/prod expected `true`. | No | No | `<true>` |
| `AUTH_PASSWORD_PROXY_ENABLED` | Ensures password auth proxy hardening is enabled. | Backend runtime config. | local optional; staging/prod expected `true`. | No | No | `<true>` |
| `ACCOUNT_DELETION_ENABLED` | Enables account deletion pipeline checks. | Backend runtime config. | local optional; staging/prod expected `true`. | No | No | `<true>` |
| `ACCOUNT_DELETION_CONTRACT_ENFORCED` | Requires strict deletion contract enforcement. | Backend runtime config. | local optional; staging/prod expected `true`. | No | No | `<true>` |
| `PERSONAL_DATA_INVENTORY_PATH` | Path to personal data inventory contract file. | Backend config (repo path). | local/staging/prod expected set. | No | No | `<security/personal_data_inventory.json>` |
| `ACCOUNT_DELETION_ACTIVE_SINK_CATEGORIES` | Declares active external sink handlers for deletion. | Backend config policy. | local/staging/prod expected set. | No | No | `<file_storage,retrieval_caches,analytics_events>` |
| `ACCOUNT_DELETION_DISABLED_SINK_CATEGORIES` | Declares sink categories intentionally disabled. | Backend config policy. | local/staging/prod expected set. | No | No | `<vector_indexes,embedding_stores,logs,notification_providers,email_providers,ai_memory_retrieval_systems>` |
| `MODE_STORAGE_ORPHAN_THRESHOLD` | Max allowed orphan count before storage gate fails. | Security policy/ops config. | local optional; staging/prod recommended explicit. | No | No | `<0>` |
| `MODE_STORAGE_CLEANUP_MAX_HEARTBEAT_AGE_MINUTES` | Max age for scheduled cleanup heartbeat freshness. | Security policy/ops config. | local optional; staging/prod recommended explicit. | No | No | `<30>` |
| `MODE_STORAGE_CLEANUP_EXPECTED_INTERVAL_MINUTES` | Expected cleanup cadence recorded by heartbeat checks. | Scheduler/ops config. | local optional; staging/prod recommended explicit. | No | No | `<15>` |

## Safe Usage Notes

- `EXPO_PUBLIC_*` values are visible in mobile client builds and must never contain service-role keys.
- `SUPABASE_SERVICE_ROLE_KEY` and `MODE_SECURITY_DATABASE_URL` must remain server-side only.
- Release mode is fail-closed even with `--env-file`; missing required values still produce `NO-GO`.
- Local mode (`--local`) can skip unavailable live gates, but release readiness still requires full release mode success.
