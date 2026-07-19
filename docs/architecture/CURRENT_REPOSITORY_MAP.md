# MODE Current Repository Map

**Status:** Phase 1 documentation-only audit deliverable. Describes what exists and how it
executes today. Authorizes no changes.

**Baseline:** branch `docs/phase1-architecture-audit` from `origin/main` at commit
`7ed7afa93322dedbf3bc2b2f15b5804e09ade949`.

**Related docs:** `docs/architecture/REPOSITORY_AUDIT.md` (findings),
`docs/architecture/DEAD_CODE_CANDIDATES.md`, `docs/architecture/TARGET_REPOSITORY_STRUCTURE.md`.
A deep UI/UX-scoped audit (`docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md`) exists on local
`main` at commit `02402ebd` (one commit ahead of the `origin/main` baseline of this branch);
frontend navigation/theme detail below summarizes rather than repeats it.

---

## 1. Executable Entrypoints

| Entrypoint | Path | How it runs |
|---|---|---|
| Mobile app | `App.js` → re-exports `src/app/App.js` default | `npm run dev` / `npm start` (Expo) |
| Backend API | `backend/main.py` → imports `app` from `backend/app/main.py` | `npm run backend:dev` → `cd backend && ./venv/bin/python main.py` (uvicorn, port 8000) |
| Intelligence worker | `backend/app/workers/intelligence_worker.py` | `python -m app.workers.intelligence_worker` (Render worker service) |
| Storage cleanup cron | `backend/scripts/storage_orphan_cleanup.py` | Render cron, `*/15 * * * *` (`render.yaml`) |
| CI | `.github/workflows/*.yml` | GitHub Actions (see §9) |

## 2. Frontend Startup Path

All root routing is a hand-rolled state machine in `src/app/App.js` (2,122 lines, component
`AppShell`); there is no navigation library anywhere in the app (no `react-navigation` in
`package.json`, no `NavigationContainer` in `src/`).

Boot sequence (each stage is a sequential early-return gate inside `AppShell`):

1. **Startup config guard** — `src/app/startupConfig.js` `validateStartupConfig()` checks the
   `EXPO_PUBLIC_*` config surface (API base URL, Supabase URL/anon key, redirect URL,
   password-auth flag). HTTPS is enforced for release builds. Failure renders a hard error
   screen instead of the app.
2. **Session restore** — `src/services/supabaseClient.js` (persisted session via
   `src/services/secureSessionStorage.js`, an `expo-secure-store` adapter);
   `supabase.auth.getSession()` on cold start with proactive refresh near expiry;
   `onAuthStateChange` subscription keeps state in sync.
3. **Auth callbacks** — manual `Linking` handling for magic-link fragment tokens and
   PKCE/OAuth `code` exchange against scheme `ai.modefit.app` (`app.json`). Social and
   password auth UI are flag-gated off by default (`src/config/featureFlags.js`).
4. **Onboarding bootstrap** — `src/features/onboarding/services/onboardingApi.js` →
   `GET /api/v1/onboarding/bootstrap`; drives the `APP_STATE` enum (`SIGNED_OUT`,
   `AUTHENTICATED_ROLE_UNKNOWN`, `CLIENT_ONBOARDING`, `ONBOARDING_PARTIAL`, `CLIENT_ACTIVE`,
   `TRAINER_STUB`).
5. **Trainer-assignment status** — `src/features/trainerAssignment/services/trainerAssignmentApi.js`
   → `GET /api/v1/trainer-assignment/status`; `viewer_role` from this response is the primary
   client-vs-trainer gate, and `assigned_trainer_id` selects trainer-specific coach chat vs.
   the Atlas fallback chat.
6. **Role-gated navigation** — clients get `CLIENT_TABS` (coach/home/progress/profile);
   trainers get either the Coach OS nav via `src/features/trainerPlatform/routes/TrainerRouteHost.js`
   (`TRAINER_ROUTE_FOUNDATION_ENABLED`, default **on**) or the legacy inline per-tab block.
   Tab bar: `src/features/navigation/components/LiquidBottomNav.js` (presentational; all tab
   state lives in `AppShell`).
7. **Daily check-in gate** — non-trainer clients on the Coach tab are blocked by
   `GET /api/v1/checkin/today` until today's check-in is complete
   (`src/features/dailyCheckin/services/checkinApi.js`).

## 3. Chat / Streaming Path

Frontend:
- UI: `src/features/chat/components/ChatShell.js` (session shell, local sub-routes
  today/history/detail) and `src/features/chat/screens/CoachChatScreen.js` (2,834 lines).
- Services: `src/features/chat/services/chatApi.js` (`/api/v1/chat`, `/api/v1/chat/stream`,
  `/api/v1/chat/history`), `chatSessionService.js` (`/api/v1/chat/sessions`),
  `chatMessageService.js` (`/api/v1/chat/sessions/:id/messages` incl. `/stream`).
- SSE consumption: `src/features/messaging/` (`consumeSseStream`), shared by chat and the
  trainer assistant. All HTTP goes through `src/services/apiRequest.js`
  (`fetchWithApiFallback`: timeout + multi-base-URL fallback).

Backend:
- Routes: `backend/app/api/v1/chat.py` (966 lines) and `backend/app/api/v1/chat_sessions.py`.
- Pipeline: `backend/app/modules/conversation/` — the core chat orchestration module
  (cache, context, intent, memory, orchestration, routing, security, state machine,
  streaming, trace; `service.py` is the largest backend file at 4,578 lines).
- Session persistence: `backend/app/modules/chat_sessions/`.
- Request middleware in `backend/app/main.py` timestamps `/api/v1/chat/stream` and
  `/api/v1/chat/sessions` requests for preflight timing (`backend/app/core/preflight_timing.py`).

## 4. Check-in and Plan Generation Path

- Frontend: `src/features/dailyCheckin/screens/DailyCheckinScreen.js` (5,200 lines — the
  largest frontend file; also exports `CheckinPlanBuilder` used from chat) with
  `src/features/dailyCheckin/services/checkinApi.js` covering `/api/v1/checkin`,
  `/checkin/today`, `/checkin/previous`, `/checkin/progress`, `/checkin/generate-plan`,
  `/checkin/log-workout`, `/checkin/last-nutrition-setup`, `/checkin/last-training-setup`.
- Backend: `backend/app/api/v1/checkin.py` → `backend/app/modules/daily_checkins/`
  (2,385-line service; sub-modules `checkin_response`, `meal_library`), signal derivation in
  `backend/app/modules/checkin_signals.py`, plan/workout generation via
  `backend/app/api/v1/plans.py`/`workouts.py`, `backend/app/modules/plan/`,
  `backend/app/modules/workout/`, and `backend/app/ai/workout_generator.py`.

## 5. Backend HTTP Surface

Assembly (`backend/app/main.py`):
- `run_startup_guards()` executes at import time (`backend/app/core/startup_guards.py`,
  fail-closed startup validation).
- Docs/redoc/openapi disabled when `settings.is_production`.
- CORS middleware configured from `Settings`.
- Bare routes `GET /` and `GET /healthz` (health payload warmed in `lifespan`,
  implementation in `backend/app/modules/observability/health.py`).

Router registry: `backend/app/api/v1/__init__.py` mounts 24 routers under `/api/v1`:

| Prefix (under `/api/v1`) | Router file | Backing module(s) |
|---|---|---|
| `/account` | `account.py` | `account_deletion`, profile/account services |
| `/auth/password` | `auth_password.py` | password-auth proxy |
| `/storage` | `storage_private.py` | `storage_lifecycle` |
| `/chat` | `chat.py` | `conversation` |
| `/chat/sessions` | `chat_sessions.py` | `chat_sessions` |
| `/checkin` | `checkin.py` | `daily_checkins`, `checkin_signals` |
| `/profiles` | `profiles.py` | `profile` |
| `/plans` | `plans.py` | `plan` |
| `/progress` | `progress.py` | `progress` |
| `/workouts` | `workouts.py` | `workout` |
| `/onboarding` | `onboarding.py` | `onboarding` |
| `/analytics` | `analytics.py` | `mobile_analytics` (name mismatch, see audit) |
| `/atlas` | `atlas.py` | `atlas` |
| `/trainer-assignment` … `/trainer-settings` | `trainer_assignment.py`, `trainer_home.py`, `trainer_clients.py`, `trainer_personas.py`, `trainer_programs.py`, `trainer_knowledge.py`, `trainer_review.py`, `trainer_coach.py`, `trainer_assistant.py`, `trainer_settings.py` | matching `trainer_*` modules |
| `/feedback` | `feedback.py` | `feedback` |

Notes:
- `backend/app/api/v1/trainer_auth.py` is **not** a router — it exports shared auth
  dependencies (`require_trainer_actor`, `require_client_actor`,
  `require_client_or_trainer_actor`) consumed by ~15 routers.
- **Double mount:** `backend/app/main.py:50` also mounts the workouts router at root
  `/workouts`, in addition to `/api/v1/workouts` (`backend/app/api/v1/__init__.py:39`). No
  frontend reference to the root `/workouts` prefix was found (`rg "'/workouts" src/ lib/`
  → no hits). See `REPOSITORY_AUDIT.md` and `DEAD_CODE_CANDIDATES.md`.

Cross-cutting backend infrastructure (`backend/app/core/`): `auth.py` (JWT verification),
`authorization.py`, `tenancy.py` (tenant context), `rate_limit.py` (memory/redis backends),
`dependencies.py`, `preflight_timing.py`, `startup_guards.py`, `config.py` (Settings).
Database access: `backend/app/db/client.py` (Supabase client construction, user-scoped and
service-role) and `backend/app/db/postgrest.py`.

Domain layering convention: route handlers call services; services call repositories;
repositories own database access (per `CLAUDE.md`; conformance findings in
`REPOSITORY_AUDIT.md`). Modules live under `backend/app/modules/` (~28 modules; two are
loose single files: `checkin_signals.py`, `motivation.py` — both actively imported).

## 6. Workers, Jobs, and Cron

- Queue/jobs: `backend/app/modules/intelligence_jobs/` (`handlers.py`, `queue.py`,
  `repository.py`, `schemas.py` — no `service.py`, a deliberate deviation from the module
  pattern) feeding `backend/app/workers/intelligence_worker.py` (async memory, trace,
  notification, and deletion jobs).
- Storage cleanup: `backend/scripts/storage_orphan_cleanup.py`, deployed as a Render cron
  every 15 minutes; deletes unverified uploads, orphan objects, and deleted-user files.
- Account deletion compliance: `backend/app/modules/account_deletion/` driven by the
  contract in `backend/security/personal_data_inventory.json` (loader:
  `backend/app/security/personal_data_inventory.py`).

## 7. Supabase and Auth

- Frontend: `src/services/supabaseClient.js` builds the client from
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`; sessions persist via
  `secureSessionStorage.js`; deep-link auth callbacks handled manually in `src/app/App.js`.
- Backend: `backend/app/db/client.py` constructs Supabase clients; user-scoped clients are
  the default for request paths, service-role usage requires explicit tenant filtering
  (policy in `CLAUDE.md`/`MODE_AGENT_RULES.md`). JWT validation in
  `backend/app/core/auth.py`; tenant resolution in `backend/app/core/tenancy.py`.
- Schema/RLS: `backend/sql/` — 89 migration files, `YYYYMMDD[letter]_description.sql`,
  spanning `20260321_bootstrap_multi_tenant_setup.sql` through
  `20260703a_grant_app_feedback_reports_authenticated.sql`. Migration history is append-only:
  existing files are never modified; new schema changes get a new date-prefixed file.

## 8. AI Routing

- Provider clients: `backend/app/ai/client.py` (OpenAI / Gemini / Anthropic; key env names
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — names only, values never in repo).
- Routing/models: `backend/app/ai/router.py`, `backend/app/ai/models.py`; response cache
  `backend/app/ai/cache.py`; prompt assembly `backend/app/ai/prompt_builder.py`; output
  parsing `backend/app/ai/response_parser.py`; workout generation
  `backend/app/ai/workout_generator.py` (+ `parsers/workout.py`, `prompts/workout.py`).
- Prompt contracts (versioned text files): `backend/prompts/system/v1.txt`,
  `backend/prompts/safety/v1.txt`, `backend/prompts/trainer_persona/v1.txt`.
- Model pricing table: `backend/app/config/model_pricing.py`.

## 9. Deployment and CI

- `render.yaml` defines three **staging** services (all `branch: main`, `rootDir: backend`):
  web `mode-backend-staging` (`uvicorn main:app --workers 4`, health `/healthz`), worker
  `mode-intelligence-worker-staging`, cron `mode-storage-cleanup-staging` (every 15 min).
  No production service is defined in this file. Secrets are declared `sync: false`
  (names only in the file).
- Mobile builds: `eas.json` profiles `development` (internal, dev client), `preview`
  (internal), `production`; `appVersionSource: remote`. App identity in `app.json`
  (scheme/bundle `ai.modefit.app`).
- CI (`.github/workflows/`): `release-security.yml` (release security runner),
  `security-release-gates.yml` (static gates + staging DB security gate + iOS gate),
  `security-secrets-scan.yml` (secret scan via `scripts/security_scan_secrets.sh`).

## 10. Configuration Surface (names only)

- Backend: `backend/app/core/config.py` `Settings` (pydantic) — ~100 env vars covering app
  env, auth, AI providers/timeouts, chat/streaming toggles, Atlas/trainer-intelligence
  toggles, rate limits, CORS, Supabase, storage lifecycle, and production guards. Reads
  `.env`, `../.env`, and `backend/.env` (all gitignored; none tracked).
- Frontend: `src/config/featureFlags.js` — 13 flags, all `EXPO_PUBLIC_*`-driven except
  `SHOW_DEV_CONNECTION_DEBUG` (hardcoded `false`). Legal URLs in `src/config/legalLinks.js`.
- Env templates (tracked, names only): `.env.example`, `.env.staging.example`,
  `.env.release.example`. There is no `backend/.env.example`; backend local env setup is
  documented in `README.md`.

## 11. Tests

- Backend: `backend/tests/` (~100 files) — run from `backend/` with `./venv/bin/pytest -q`.
  Clusters: auth/credentials, account deletion, chat/conversation/LLM, Atlas,
  check-ins/progress/onboarding/workouts, trainer platform (largest cluster),
  security/RLS/hardening (static + live-marked), release/script static wrappers.
- Frontend: ~88 Jest test files in co-located `__tests__/` dirs under `src/`; config in root
  `jest.config.js` (preset `jest-expo`, roots `src/`), run with `npm test`
  (`jest --runInBand`).
- Repo-level checks: `npm run codex:check` (`scripts/codex_prompt_check.js` — backend
  route-contract pytest + backend reachability probe + runtime route-surface preflight),
  `npm run security:secrets`, `npm run release:security`.
