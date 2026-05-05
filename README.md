# MODE
MODE is an Expo + FastAPI project for trainer-aware AI coaching.

The current repo is centered on a working client login + chat flow on the frontend and a multi-tenant coaching foundation on the backend. Legacy duplicate screens and unused setup files have been removed so the codebase now reflects the active product direction more closely.

## Trainer Platform Planning (Phases 1-4)

Pre-implementation architecture artifacts for the trainer-side expansion live in:

```text
docs/trainer-platform/
```

This includes:
- repo audit
- protected client surface area
- target architecture
- schema/domain model
- phased implementation plan

## Active Structure

### Frontend
```text
src/
├── app/
│   └── App.js
├── features/
│   ├── auth/
│   │   └── screens/
│   │       └── Login.js
│   └── chat/
│       ├── components/
│       ├── hooks/
│       ├── screens/
│       └── services/
└── services/
    └── supabaseClient.js
```

### Backend
```text
backend/
├── app/
│   ├── ai/
│   ├── api/v1/
│   ├── core/
│   ├── db/
│   └── modules/
│       ├── conversation/
│       ├── plan/
│       ├── profile/
│       ├── trainer_knowledge/
│       ├── trainer_persona/
│       ├── trainer_review/
│       └── workout/
├── sql/
└── tests/
```

## Current API Surface

- `POST /workouts/generate`
- `POST /api/v1/chat`
- `POST /api/v1/chat/stream`
- `GET /api/v1/checkin/today`
- `GET /api/v1/checkin/previous`
- `GET /api/v1/checkin/progress`
- `POST /api/v1/checkin`
- `POST /api/v1/checkin/generate-plan`
- `POST /api/v1/checkin/log-workout`
- `GET /api/v1/onboarding/bootstrap`
- `POST /api/v1/onboarding/role`
- `PATCH /api/v1/onboarding/state`
- `POST /api/v1/onboarding/complete`
- `POST /api/v1/analytics/mobile-events`
- `GET /api/v1/profiles/me`
- `PATCH /api/v1/profiles/me`
- `GET /api/v1/plans/active`
- `POST /api/v1/plans/generate`
- `GET /api/v1/trainer-assignment/status`
- `POST /api/v1/trainer-assignment/assign`
- `POST /api/v1/trainer-assignment/assign-by-invite`
- `GET /api/v1/trainer-home/today`
- `GET /api/v1/trainer-home/command-center`
- `GET /api/v1/trainer-clients/{client_id}/detail`
- `GET /api/v1/trainer-clients/{client_id}/memory`
- `POST /api/v1/trainer-clients/{client_id}/memory`
- `PATCH /api/v1/trainer-clients/{client_id}/memory/{memory_id}`
- `DELETE /api/v1/trainer-clients/{client_id}/memory/{memory_id}`
- `GET /api/v1/trainer-clients/{client_id}/ai-context`
- `GET /api/v1/trainer-personas`
- `POST /api/v1/trainer-personas`
- `GET /api/v1/trainer-knowledge`
- `POST /api/v1/trainer-knowledge`
- `POST /api/v1/trainer-knowledge/ingest`
- `GET /api/v1/trainer-knowledge/rules`
- `PATCH /api/v1/trainer-knowledge/rules/{rule_id}`
- `DELETE /api/v1/trainer-knowledge/rules/{rule_id}`
- `GET /api/v1/trainer-review/outputs`
- `GET /api/v1/trainer-review/outputs/{output_id}`
- `POST /api/v1/trainer-review/outputs/{output_id}/edit`
- `POST /api/v1/trainer-review/outputs/{output_id}/approve`
- `POST /api/v1/trainer-review/outputs/{output_id}/reject`
- Legacy: `GET /api/v1/trainer-review/queue`
- Legacy: `POST /api/v1/trainer-review/queue/{queue_id}/approve`

## Supabase Setup

For a fresh project, run:

```sql
backend/sql/20260321_supabase_full_setup.sql
```

If you already ran the earlier multi-tenant policies and hit recursion, also run:

```sql
backend/sql/20260322_fix_multi_tenant_rls_recursion.sql
```

For client-first onboarding and role-aware bootstrap, also run:

```sql
backend/sql/20260414_client_first_onboarding_foundation.sql
```

Optional helper to seed invite codes for trainer attach:

```sql
backend/sql/20260414b_seed_trainer_invite_codes_template.sql
```

## Local Development

### Frontend
```bash
npm install
npx expo start --port 8081
```

### Backend
```bash
cd backend
pip install -r requirements.txt
./venv/bin/python main.py
```

### Runtime Route Preflight (Required Before Trainer QA)
After backend startup, verify the running process matches current repo route surface:

```bash
cd backend
./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url http://127.0.0.1:8000
```

Expected result: `Runtime route surface preflight: PASSED`.

### Codex Prompt-Close Check
After any Codex change that touches app/backend behavior, run the guard before calling the work done:

```bash
npm run codex:check
```

This runs focused backend route tests, finds the first reachable backend from `.env`, LAN, localhost, and `127.0.0.1`, then runs the runtime route preflight against that backend. If it reports no reachable backend, start one with `npm run backend:dev`, rerun the check, and tap `Retry` in the app.

### Trainer Connectivity Triage (Physical Device)
If trainer assistant/coach surfaces show `Unable to reach backend...`, run this quick triage:

1. Start backend with:
   ```bash
   cd backend
   ./venv/bin/python main.py
   ```
2. Verify root `.env` has the current laptop LAN IP:
   `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8000`
3. From your phone browser (same Wi-Fi), open:
   `http://<LAN-IP>:8000/healthz`
4. Confirm:
   - phone and laptop are on the same Wi-Fi network
   - VPN/proxy is disabled on phone and laptop
   - local firewall allows inbound connections to Python on port `8000`
5. After any `.env` change, restart Expo with cache clear (`npx expo start -c`).

### Trainer Assistant Storage Preflight (Required Before Coach Composer QA)
Verify trainer assistant storage primitives are present before testing trainer coach/trainer assistant draft generation:

```bash
cd backend
./venv/bin/python scripts/preflight_trainer_assistant_storage.py
```

Expected result: `Trainer assistant storage preflight: PASSED`.
If missing primitives are reported, apply:
`backend/sql/20260418b_add_trainer_assistant_last_client_and_router_events.sql`.

### Trainer Assistant Execute Smoke (Required Before Coach Composer QA)
Storage preflight validates `20260418b` primitives only. Also run execute-path smoke to confirm draft persistence support (`20260418c`) is present:

```bash
cd backend
MODE_RUN_STAGING_SUPABASE_TESTS=1 ./venv/bin/pytest -q \
  tests/test_trainer_platform_staging_smoke.py \
  -k test_trainer_assistant_execute_route_is_non_500_for_owner \
  -rs
```

Expected result: `1 passed` with `POST /api/v1/trainer-assistant/execute` returning `200` plus `draft_id`.
If execute fails with `23514` and `ai_generated_outputs_source_type_check`, apply:
`backend/sql/20260418c_allow_trainer_assistant_draft_source_type.sql`.

## Required Environment Variables

### Root `.env`
```env
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:8000
EXPO_PUBLIC_SUPABASE_REDIRECT_URL=mode://auth/callback
EXPO_PUBLIC_AUTH_SOCIAL_ENABLED=false
EXPO_PUBLIC_AUTH_PASSWORD_ENABLED=false
EXPO_PUBLIC_SHOW_ACCOUNT_DIAGNOSTICS=false
EXPO_PUBLIC_ALLOW_PLAINTEXT_COACH_CACHE=false
```

When testing in Expo Go on a physical device, `localhost` points to the phone, not your computer. If auto-detection does not work in your setup, set `EXPO_PUBLIC_API_BASE_URL` to your computer's LAN IP so the phone can reach the FastAPI server.

For email callback support, add `mode://auth/callback` to Supabase allowed Redirect URLs and keep Email OTP enabled. While social providers are intentionally paused, keep `EXPO_PUBLIC_AUTH_SOCIAL_ENABLED=false`.

Set `EXPO_PUBLIC_AUTH_PASSWORD_ENABLED=true` to enable temporary QA password auth in the mobile login screen (password + OTP fallback).
TODO before production release: set `EXPO_PUBLIC_AUTH_PASSWORD_ENABLED=false`.

`EXPO_PUBLIC_SHOW_ACCOUNT_DIAGNOSTICS` keeps API-base diagnostics hidden in production by default.
`EXPO_PUBLIC_ALLOW_PLAINTEXT_COACH_CACHE` keeps trainer-coach cache persistence disabled in production by default.

### `backend/.env`
```env
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Test Accounts

Use local-only placeholder accounts for QA. Do not commit real usernames, passwords, or production credentials.

```text
Client login (QA): <local-placeholder-email> / <local-placeholder-password>
```

Example client email format:

```text
<local-client>@mode.local
```

Password sign-up may still require email verification depending on your Supabase Auth settings.
Temporary QA path: disable password auth before production rollout.

## Inbox-Free Email Auth QA

To test "Continue with Email" without a real inbox, generate a Supabase admin link and OTP:

```bash
cd backend
./venv/bin/python scripts/generate_test_auth_link.py \
  --email cyhfanzbckdqbtwgkv@jbsze.ne \
  --redirect-to mode://auth/callback \
  --check-auth-settings \
  --output pretty
```

The script prints:
- `action_link` (open in browser/device)
- `email_otp` (for manual verify workflows)
- requested vs actual redirect URL
- auth provider state when `--check-auth-settings` is set

Exit codes:
- `0`: success
- `1`: execution error
- `2`: redirect mismatch (`requested_redirect_to` != `actual_redirect_to`) when `--fail-on-redirect-mismatch=true`

If `actual_redirect_to` falls back to `http://localhost:3000`:
1. Add `mode://auth/callback` to Supabase Auth allowed Redirect URLs.
2. Verify your Auth Site URL / redirect config is not forcing `http://localhost:3000`.
3. Re-run the script and confirm `actual_redirect_to` matches `mode://auth/callback`.

Email auth smoke:
1. Trigger normal in-app "Continue with Email" and confirm rate-limit/error state is visible when applicable.
2. Generate test link via script (command above).
3. Open `action_link` on the test device.
4. Confirm app session is established and user leaves signed-out auth screens.
5. Confirm onboarding bootstrap loads (role selection/onboarding or home flow appears).

## Security Secret Scanning

Run the repository secret scanner before commits and before release tags:

```bash
bash scripts/security_scan_secrets.sh
```

By default, local `.env` files are skipped. To include them in local-only scans:

```bash
MODE_SECURITY_SCAN_INCLUDE_ENV=1 bash scripts/security_scan_secrets.sh
```

CI runs the same scan script in `.github/workflows/security-secrets-scan.yml`.

## Release Security Gates

Release hardening gates and required environment variables are documented in:

- `docs/security/release-hardening-gates.md`
- `docs/security/ios-hardening-checklist.md`

Core gate commands:

```bash
cd backend
./venv/bin/python scripts/check_personal_data_inventory.py
MODE_SECURITY_DATABASE_URL='postgres://...' ./venv/bin/python scripts/staging_db_security_check.py
APP_ENV=production RATE_LIMIT_BACKEND=postgres ./venv/bin/python scripts/security_release_preflight.py --env production
MODE_SECURITY_TARGET_ENV=production ./scripts/security_regression_suite.sh
```

Root-level audits:

```bash
python scripts/storage_access_audit.py
python scripts/ios_hardening_lint.py --require-prebuild
python scripts/ios_artifact_scan.py --require-ipa
```

Local/dev behavior:
- `security_release_preflight.py --env development` is allowed for local checks.
- iOS artifact scan can be skipped when no IPA is available.

Production behavior:
- preflight, staging DB posture check, and iOS checks are release blockers.
- storage orphan cleanup job (`backend/scripts/storage_orphan_cleanup.py`) must be scheduled and healthy.

## Before Publishing To GitHub

1. Confirm `.env` and `backend/.env` are still ignored.
2. Make sure no real secrets are hardcoded into tracked files.
3. Review `git status`.
4. Commit the cleanup + architecture changes together.
5. Push to a new branch first if you want a safe review pass before merging to `main`.
