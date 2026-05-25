# MODE Master Context

## Purpose

This file is the shared project source of truth for Codex, Claude Code, and
human handoffs. It collects the context that should survive beyond any one chat
session.

## Staleness Rule

- Code, config, scripts, tests, and current repo state win over stale docs.
- Contradictions between docs and implementation must be flagged in handoffs or
  reviews.
- When stale docs would mislead future work, update the affected docs in the
  same workstream whenever the task scope allows it.

## Product Summary

MODE is a trainer-aware AI coaching platform. Clients use a React Native mobile
app for onboarding, daily check-ins, progress, and streaming coach chat.
Trainers use trainer-side surfaces to manage clients, capture coaching
knowledge, review AI outputs, and configure assistant behavior. The backend is a
FastAPI service with Supabase auth/database/storage, RLS-based tenant isolation,
multi-provider AI routing, and release/security preflights.

## Architecture Snapshot

- Frontend: Expo 55, React Native 0.83, React 19, hooks-first state, Jest.
- Backend: FastAPI, Uvicorn, Pydantic, Supabase client, Redis/RQ primitives.
- Auth/database/storage: Supabase, with tenant isolation and RLS as core design
  constraints.
- Streaming: server-sent events through backend chat endpoints and frontend
  messaging utilities.
- AI providers: OpenAI, Anthropic, and Gemini clients are centralized under
  `backend/app/ai/client.py`. Routing constants live in
  `backend/app/modules/conversation/routing.py` and orchestration helpers live
  in `backend/app/modules/conversation/orchestration.py`.
- Deployment and release gates: Render, GitHub Actions, security scan scripts,
  launch verification scripts, and staging preflights.

## Repository Map

```text
src/
  app/App.js                         Root auth, role, onboarding, navigation shell
  config/featureFlags.js             Frontend feature flags
  features/auth/                     Login and password proxy client
  features/onboarding/               Client/trainer onboarding surfaces
  features/chat/                     Coach chat screens, hooks, services, rendering
  features/messaging/                SSE, lifecycle, progress stages
  features/dailyCheckin/             Daily readiness and training mode flow
  features/home/                     Algorithm home surface
  features/progress/                 Progress surface
  features/profile/                  Profile and account actions
  features/trainerAssignment/        Trainer assignment state
  features/trainerHome/              Trainer dashboard and knowledge capture
  features/trainerClients/           Trainer client list/detail helpers
  features/trainerCoach/             Trainer coach workspace
  features/trainerAssistant/         Trainer assistant screen and API client
  features/trainerReview/            Review queue surface
  features/trainerPlatform/          Trainer route host and system/workspace screens
  services/                          Shared API, Supabase, session, connectivity helpers

lib/
  theme.js                           Shared theme tokens
  components/                        Shared UI primitives and glass/premium variants

backend/
  main.py                            Local uvicorn entrypoint
  app/main.py                        FastAPI app, middleware, router mounting, health
  app/api/v1/                        Route handlers
  app/core/                          Auth, tenancy, config, dependencies, rate limits
  app/db/                            Supabase and PostgREST clients
  app/ai/                            Provider clients, prompts, routing helpers
  app/modules/                       Feature modules with service/repository/schemas
  app/workers/                       Intelligence worker entrypoint
  prompts/                           System, trainer persona, and safety prompts
  sql/                               Date-prefixed migrations and setup SQL
  scripts/                           Runtime preflights, security checks, launch scripts
  tests/                             Pytest suite

scripts/
  dev_launcher.js                    `npm run dev`
  backend_health_check.js            Backend probe helpers
  codex_prompt_check.js              `npm run codex:check`
  security_scan_secrets.sh           Secrets scan wrapper
  release_security.sh                Release security runner wrapper

docs/
  trainer-platform/                  Trainer platform architecture and runbooks
  launch/                            Launch, TestFlight, RLS, risk docs
  security/                          Release hardening and security setup docs
  chat_pipeline_*.md                 Chat architecture, monitoring, handoff docs
  distributed_intelligence_*.md      Worker queue and launch docs
```

## Active API Surface

The README lists the current route surface. Important groups include:

- Client coaching: `/api/v1/chat`, `/api/v1/chat/stream`,
  `/api/v1/chat/sessions/*`.
- Daily check-in: `/api/v1/checkin/*`.
- Onboarding and role state: `/api/v1/onboarding/*`.
- Profile and account: `/api/v1/profiles/me`, account deletion endpoints.
- Plans and workouts: `/api/v1/plans/*`, `/workouts/generate`.
- Trainer assignment: `/api/v1/trainer-assignment/*`.
- Trainer home and clients: `/api/v1/trainer-home/*`,
  `/api/v1/trainer-clients/*`.
- Trainer knowledge/personas/review/assistant/programs/settings under their
  respective `/api/v1/trainer-*` namespaces.

Before changing route behavior, inspect `backend/app/api/v1/`, route tests in
`backend/tests/`, and `scripts/codex_prompt_check.js`.

## Environment Model

- Local dev uses root `.env` and `backend/.env`.
- Staging uses staging credentials and may use staging-specific provider flags.
- Production uses release credentials and stricter startup/security gates.
- Never copy values between environments.
- Never commit environment files or secrets.
- Backend env vars are represented in `backend/app/core/config.py`.
- Frontend bundle-safe values must use `EXPO_PUBLIC_*`.
- Physical device testing needs `EXPO_PUBLIC_API_BASE_URL` set to a LAN-reachable
  backend URL, not phone-local `localhost`.

## Common Commands

```bash
npm install
npm run dev
npm run start:clean
npm run backend:dev
npm run backend:check
npm run codex:check
npm run lint
npm test
npm run security:secrets
npm run release:security
```

Backend commands usually run from `backend/`:

```bash
./venv/bin/pytest -q
./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url http://127.0.0.1:8000
./venv/bin/python scripts/preflight_trainer_assistant_storage.py
./venv/bin/python scripts/launch_gate_staging_verification.py
```

Use live/staging DB scripts only when the environment and intent are explicit.

## Backend Patterns

- Route handlers live in `backend/app/api/v1/`.
- Feature modules live in `backend/app/modules/<feature>/`.
- Follow API -> service -> repository -> database layering.
- Use Pydantic schemas for request/response and domain payloads.
- Keep route handlers thin and rate-limited for user-input endpoints.
- Use `require_user`, tenant context dependencies, and role-specific actor checks
  where routes need authenticated or trainer/client-scoped access.
- Repositories own Supabase/PostgREST queries.
- Service-role client usage must be explicit, tenant-filtered, and avoided in
  user-facing route handlers unless there is a clear internal-service reason.
- Settings go through `backend/app/core/config.py`; do not read arbitrary env
  vars in feature code.
- Startup and production gates live in `backend/app/core/startup_guards.py`,
  security docs, and release scripts.

## Frontend Patterns

- Root shell behavior lives in `src/app/App.js`.
- Shared primitives live in `lib/components/` and theme tokens in `lib/theme.js`.
- Feature code lives under `src/features/<feature>/`.
- API wrappers live in feature `services/` modules or shared `src/services/`.
- Use `src/services/apiRequest.js` for backend calls and fallback URL discovery.
- Use `src/services/supabaseClient.js` for auth session behavior.
- Use `src/config/featureFlags.js` for frontend flags.
- Keep state hooks-first and local to feature hooks where possible.
- Jest tests live near screens/services/hooks in `__tests__/`.
- Do not place backend secrets or service-role keys in frontend code.

## Trainer Platform Context

The trainer-side expansion is documented under `docs/trainer-platform/`.
Important principles from those docs:

- Preserve existing client routes, tab keys, and flow semantics.
- Keep trainer-specific behavior in trainer namespaces and route branches.
- Enforce tenant isolation across DB queries, services, retrieval, and generation.
- Add structured trainer intelligence layers instead of prompt-only glue.
- Treat check-in, chat, and assignment contracts as compatibility-critical.
- Use feature flags and additive APIs/migrations for staged rollout.

Core trainer surfaces in the current repo include trainer home, trainer clients,
trainer coach, trainer assistant, trainer review, trainer platform route host,
trainer knowledge, trainer personas, trainer programs, and trainer settings.

## Chat, AI, Memory, and Streaming

- Main chat routes are in `backend/app/api/v1/chat.py`.
- Conversation logic is in `backend/app/modules/conversation/`.
- Provider clients are in `backend/app/ai/client.py`.
- Routing decisions are in `backend/app/modules/conversation/routing.py`.
- Prompt assembly and token-budget helpers are in
  `backend/app/modules/conversation/orchestration.py`.
- Safety and intent logic are in `backend/app/modules/conversation/intent.py`
  and prompt files under `backend/prompts/`.
- Memory evaluation and write candidates are in conversation and trainer
  knowledge modules.
- SSE frontend helpers live under `src/features/messaging/` and chat UI under
  `src/features/chat/`.

When changing this area, verify provider fallback behavior, timeout handling,
prompt-injection handling, safety escalation, SSE event compatibility, memory
write scope, and trace metadata.

## Security and Compliance Notes

- RLS and tenant isolation are product requirements, not optional hardening.
- Account deletion scope is tied to
  `backend/security/personal_data_inventory.json`.
- Private storage paths and signed URL behavior must preserve actor/tenant
  authorization.
- Secrets scanning runs through repo scripts and GitHub workflows.
- Release hardening docs live in `docs/security/` and `docs/launch/`.
- Do not weaken startup guards, CI security workflows, RLS policies, or release
  preflights without explicit human approval.

## Verification Expectations

- Always run the smallest meaningful test set for the changed behavior.
- Run `npm run codex:check` after repo changes.
- If `npm run codex:check` cannot find a backend, start `npm run backend:dev`,
  rerun the check, and tell the user to tap `Retry` in the app.
- For backend API changes, run targeted pytest files in `backend/tests/`.
- For frontend changes, run targeted Jest tests or `npm test`.
- For launch/security work, use the relevant scripts in `scripts/`,
  `backend/scripts/`, `docs/security/`, and `docs/launch/`.

## Documentation Maintenance

- Keep `CLAUDE.md` short and operational.
- Keep this file as the detailed cross-agent context.
- Keep `MODE_AGENT_RULES.md` focused on collaboration and review authority.
- If code or scripts change in a way that invalidates these docs, update the
  docs in the same workstream.
