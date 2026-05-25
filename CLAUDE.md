# MODE Claude Code Startup Contract

@AGENTS.md
@MODE_AGENT_RULES.md

## Project Identity

MODE is an Expo React Native + FastAPI project for trainer-aware AI coaching.
The product supports client onboarding, daily check-ins, streaming coach chat,
trainer assignment, trainer knowledge capture, trainer client management,
trainer AI assistant flows, and release/security gates around tenant isolation.

Claude Code's default role in this repo is second-pass reviewer, architect, and
precision editor. Codex is the primary implementation runner. The human founder
is the final approval authority.

## Required Reading

- For non-trivial work, read `MODE_MASTER_CONTEXT.md` before planning or editing.
- For agent collaboration rules, read `MODE_AGENT_RULES.md`.
- For current commands and local setup, prefer `package.json`, `README.md`, and
  the scripts themselves over memory.
- For trainer-platform architecture, read `docs/trainer-platform/`.
- Code beats docs when stale. If docs conflict with code, inspect the code,
  follow the code, and update the docs when the task includes documentation.

## Operating Rules

- Do not approve, merge, or declare safe your own work.
- No agent may approve, merge, or declare production-ready its own high-risk
  work.
- Ask for tight scope before touching auth, RLS, tenant logic, production
  migrations, AI orchestration, memory writes, streaming, trainer/client
  assignment, safety handling, or account deletion.
- Any change in those high-risk areas needs second-agent review before merge.
- Never mix local, staging, or production credentials.
- Never commit secrets, `.env`, `.env.staging`, `.env.release`, or
  `backend/.env`.
- Never modify existing SQL migrations. Add a new date-prefixed migration for
  new schema changes.
- Keep changes scoped. Do not refactor unrelated surfaces while fixing a task.
- Preserve client production flows unless the task explicitly says otherwise.

## High-Risk Surfaces

- `backend/app/core/auth.py`: JWT validation and auth context caching.
- `backend/app/core/tenancy.py`: trainer/client/tenant resolution.
- `backend/sql/`: schema, RLS, and migration history.
- `backend/app/modules/conversation/`: chat orchestration, safety, memory, SSE.
- `backend/app/ai/client.py`: provider clients, API key handling, timeouts.
- `backend/app/modules/intelligence_jobs/` and `backend/app/workers/`: async
  memory, trace, notification, and deletion jobs.
- `backend/app/modules/account_deletion/` and
  `backend/security/personal_data_inventory.json`: deletion compliance.
- `backend/prompts/system/v1.txt` and `backend/prompts/safety/v1.txt`: safety
  and behavior prompt contracts.
- `backend/app/core/rate_limit.py`: abuse controls and trainer flow capacity.
- `src/app/App.js`: auth, role, onboarding, and navigation state machine.
- `src/features/chat/` and `src/features/messaging/`: chat UI and streaming.
- `src/features/trainerPlatform/`, `trainerCoach`, `trainerClients`,
  `trainerAssistant`, and `trainerReview`: trainer-side surfaces.

## Implementation Conventions

- Backend route handlers call services; services call repositories; repositories
  own database access.
- Use Pydantic schemas for backend request/response data.
- Use `Settings` in `backend/app/core/config.py` for backend env vars.
- Use user-scoped Supabase clients for request paths unless a service-role path
  is explicitly justified and tenant-filtered.
- Rate-limit user-facing backend routes that accept user input.
- Frontend API calls go through `src/services/apiRequest.js` or established
  feature service wrappers.
- Frontend flags live in `src/config/featureFlags.js`.
- React Native state is hooks-first. No Redux/Zustand introduction.
- Keep secrets out of frontend code; only `EXPO_PUBLIC_*` values can be bundled.

## Common Commands

```bash
npm run dev
npm run backend:dev
npm run backend:check
npm run codex:check
npm run lint
npm test
npm run security:secrets
npm run release:security
```

Backend-focused checks usually run from `backend/` with the virtualenv:

```bash
./venv/bin/pytest -q
./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url http://127.0.0.1:8000
./venv/bin/python scripts/preflight_trainer_assistant_storage.py
```

## Verification Contract

- After repo changes, run `npm run codex:check` before final handoff.
- If `npm run codex:check` fails because no backend is reachable, start the
  backend with `npm run backend:dev`, rerun the check, and tell the user to tap
  `Retry` in the app.
- For frontend changes, run the nearest Jest test or `npm test` when practical.
- For backend changes, run targeted `backend/tests/` pytest files.
- For security-sensitive changes, include reviewer notes for tenant isolation,
  RLS/auth behavior, secrets exposure, and staging/prod separation.

## Claude Project Skills

- Use `/mode-review` for second-pass review of diffs, especially high-risk
  changes.
- Use `/mode-handoff` to prepare a clean Codex-to-Claude or Claude-to-Codex
  handoff.
- These skills are documented guardrails only. This repo intentionally does not
  use Claude hooks, automated deny rules, or `.claude/settings.json` in v1.
