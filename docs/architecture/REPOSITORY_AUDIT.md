# MODE Repository Audit

**Status:** Phase 1 documentation-only audit deliverable. Findings only — no remediation is
performed or authorized by this document. Every cleanup item requires a separate reviewed
Phase 2 PR.

**Baseline:** branch `docs/phase1-architecture-audit` from `origin/main` at
`7ed7afa93322dedbf3bc2b2f15b5804e09ade949`. Companion map:
`docs/architecture/CURRENT_REPOSITORY_MAP.md`.

---

## 1. Dependency-Boundary Findings

Convention (per `CLAUDE.md`): route handlers → services → repositories; repositories own
database access. Conformance observations:

1. **Broad conformance is real.** Of the ~28 modules under `backend/app/modules/`, all
   packaged modules except `observability` have a `repository.py`, and all except
   `observability` and `intelligence_jobs` have a `service.py`
   (verified by directory listing on this baseline).
2. **Four routers import the db layer directly**, bypassing the service/repository
   convention: `backend/app/api/v1/account.py`, `auth_password.py`, `feedback.py`,
   `storage_private.py` (evidence: `rg -l "from app.db|get_supabase|postgrest"
   backend/app/api/v1/`). Some of these may be deliberate (e.g. constructing the
   user-scoped client to pass down), but each is worth an explicit justification note when
   next touched — three of the four are high-risk surfaces (auth, deletion, storage).
3. **`intelligence_jobs` has no `service.py`** (`handlers.py`/`queue.py`/`repository.py`/
   `schemas.py`) — a deliberate-looking deviation (job handlers replace a service), but it is
   the only module shaped this way; undocumented until now.
4. **Two loose single-file modules** sit beside the packaged modules:
   `backend/app/modules/checkin_signals.py` and `backend/app/modules/motivation.py`. Both
   are actively imported (`motivation` by 6 services incl. `conversation/service.py`;
   `checkin_signals` by `trainer_clients` and `trainer_home` services + tests) — **not dead
   code**, but a structural inconsistency.
5. **Router/module name mismatch:** `/api/v1/analytics` (`analytics.py`) is backed by
   `backend/app/modules/mobile_analytics/`. Not a defect; a discoverability cost.
6. **`backend/app/api/v1/trainer_auth.py` is a dependency module living in the router
   directory.** It exports `require_trainer_actor` / `require_client_actor` /
   `require_client_or_trainer_actor`, consumed by ~15 routers. Its location invites
   mis-cataloging as a router; conceptually it belongs with `app/core/` auth code.
7. **Workouts router double mount:** `backend/app/main.py:50` mounts the workouts router at
   root `/workouts` *and* `backend/app/api/v1/__init__.py:39` mounts it at
   `/api/v1/workouts`. No frontend reference to the root prefix exists
   (`rg "'/workouts" src/ lib/` → none). The root mount looks like a legacy surface; see
   `DEAD_CODE_CANDIDATES.md` (Low confidence — behavioral, needs runtime confirmation).
8. **Frontend boundaries are consistently followed:** all feature service files route HTTP
   through `src/services/apiRequest.js` (`fetchWithApiFallback`); no feature imports another
   feature's screens; flags are centralized in `src/config/featureFlags.js`. The exceptions
   are architectural, not boundary violations: routing is hand-rolled at three levels (root
   `AppShell` state machine, per-feature view stacks, `TrainerRouteHost`) with no shared
   contract — see §3.

## 2. Largest / Highest-Risk Files

Line counts measured on this baseline (`wc -l`); risk classification cross-referenced with
the high-risk list in `CLAUDE.md`.

| File | Lines | Why it is high-risk |
|---|---|---|
| `src/features/dailyCheckin/screens/DailyCheckinScreen.js` | 5,200 | Largest file in the repo; check-in flow + exported `CheckinPlanBuilder` reused by chat; heavy local state |
| `src/features/trainerClients/screens/TrainerClientsScreen.js` | 4,766 | Trainer client management; own `viewMode` state machine |
| `backend/app/modules/conversation/service.py` | 4,578 | Core chat orchestration: safety, memory, SSE — top of the `CLAUDE.md` high-risk list |
| `src/features/trainerPlatform/screens/TrainerSystemScreen.js` | 4,310 | 10+ internal views in one file via `viewStack`; trainer system hub |
| `src/features/chat/screens/CoachChatScreen.js` | 2,834 | Client chat UI + streaming consumption |
| `backend/app/modules/daily_checkins/service.py` | 2,385 | Check-in domain logic |
| `backend/app/modules/chat_sessions/service.py` | 2,385 | Chat history/session persistence |
| `src/features/trainerCoach/components/CoachPanelHost.js` | 2,344 | Trainer coach workspace panels |
| `backend/app/modules/trainer_onboarding/service.py` | 2,246 | Trainer onboarding state |
| `src/app/App.js` | 2,122 | Root auth/role/onboarding/nav state machine — every user session traverses it |
| `backend/app/api/v1/chat.py` | 966 | Chat/SSE route layer |

Always-high-risk regardless of size (from `CLAUDE.md` / `MODE_AGENT_RULES.md`):
`backend/app/core/auth.py`, `backend/app/core/tenancy.py`, `backend/sql/` (RLS/migrations),
`backend/app/ai/client.py`, `backend/app/modules/intelligence_jobs/` + `backend/app/workers/`,
`backend/app/modules/account_deletion/` + `backend/security/personal_data_inventory.json`,
`backend/prompts/system/v1.txt` + `backend/prompts/safety/v1.txt`,
`backend/app/core/rate_limit.py`, `src/features/chat/` + `src/features/messaging/`.

## 3. Stale / Parallel Architecture Categories

Summarized from the UI/UX audit (local `main` commit `02402ebd`,
`docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md`) plus backend findings from this pass:

1. **Three routing idioms, no shared contract** — root `AppShell` enum state machine;
   per-feature `viewStack`/`viewMode` arrays (`ProfileScreen`, `TrainerSystemScreen`,
   `TrainerClientsScreen`); stateless prop-driven `TrainerRouteHost`. No screen registry,
   back-history API, or deep-link addressability below the top level.
2. **Dual trainer navigation, both live** — `TRAINER_ROUTE_FOUNDATION_ENABLED` (default
   **on**) selects Coach OS (`TrainerRouteHost`) vs. the legacy inline per-tab block in
   `src/app/App.js`. "Legacy" here is the flag-off branch of an on-by-default flag, not dead
   code.
3. **Two theming worlds by design** — legacy `lib/theme.js` (80 importing files, including
   four internal legacy-alias blocks) vs. the Theme V2 pilot (`lib/theme/*`,
   `THEME_V2_ENABLED` default off, exactly one consuming screen). The pilot is deliberately
   scoped and documented (`MODE_PRODUCT_PRINCIPLES.md` matches the code, including the
   "never add `lib/theme/index.js`" rule), but readers have three ways to reach a color with
   no signposted canonical entry point.
4. **Superseded-but-retained frontend files** — nine fully-built orphaned screens plus a
   dead second tab bar (`PremiumTabBar`); itemized with evidence in
   `DEAD_CODE_CANDIDATES.md`. The recurring pattern: build a replacement, wire it in, leave
   the old file in place.
5. **Backend structural stragglers** — root `/workouts` double mount, loose single-file
   modules, router-directory dependency module (§1).
6. **README drift risk** — `README.md` hand-maintains an "Active Structure" tree and a
   "Current API Surface" endpoint list. The authoritative sources are the filesystem and
   `backend/app/api/v1/__init__.py`; the README copies will drift silently as routers are
   added.

## 4. Documentation Trust Hierarchy

Ordered from most to least authoritative for current behavior. Rule of thumb (from
`CLAUDE.md`): **code beats docs when stale**.

| Tier | Docs | Trust status | Evidence |
|---|---|---|---|
| 1 — Binding contracts | `CLAUDE.md`, `AGENTS.md`, `MODE_AGENT_RULES.md`, `MODE_FOUNDER_DECISIONS.md` | Current; operating rules, not descriptions — they bind agent behavior | Actively enforced in workflow; referenced by tooling |
| 2 — Durable shared context | `MODE_MASTER_CONTEXT.md`, `MODE_PRODUCT_PRINCIPLES.md` | Current; `MODE_PRODUCT_PRINCIPLES.md` verified in sync with `lib/theme/*` code | Theme-v2 rules match code exactly (no `lib/theme/index.js`; single flag-gated consumer) |
| 3 — Recent audits | `docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md` (local `main`, `02402ebd`), this `docs/architecture/` set | Current as of their stated baselines; read-only diagnostics | Commit-pinned baselines recorded in each doc |
| 4 — Subsystem architecture | `docs/trainer-platform/` (phases 1–4, 11–12, hardening runbook), `docs/chat_pipeline_*.md`, `docs/distributed_intelligence_*.md`, `docs/worker_queue_decision.md` | Mixed: design intent is reliable, implementation details may lag code | Phase docs predate later implementation commits; verify against code before relying |
| 5 — Ops runbooks / checklists | `docs/chat_slow_response_runbook.md`, `docs/security/*`, `docs/launch/*`, `docs/onboarding/client-first-go-live.md`, `docs/ui/hume-glass-qa-checklist.md` | Point-in-time procedures; re-validate commands before executing | Launch/TestFlight docs are checklist snapshots |
| 6 — Historical snapshots | `docs/handoffs/2026-06-11-security-remediation-handoff.md`, `docs/load_test_results/*`, `security/endpoint_matrix_2026-04-25.md`, `security/rls_matrix_2026-04-25.md`, `docs/database_hardening_phase_b.md`, `docs/security_hardening_phase_e.md` | Historical record; date-stamped; do not treat as current state | Dates in filenames/content precede many later migrations (latest migration `20260703a`) |
| 7 — Drift-prone duplications | `README.md` "Active Structure" + "Current API Surface" sections, `DESIGN.md`, `PRODUCT.md` | Useful orientation; verify against code | See §3.6; `DESIGN.md` self-describes as extracted from `lib/theme.js` |

## 5. Configuration / Environment Findings (names only — no values)

1. Three tracked env templates exist: `.env.example`, `.env.staging.example`,
   `.env.release.example`. The staging and release templates define an **identical variable
   set** — duplication that must be kept in sync by hand (a static test,
   `backend/tests/test_release_env_templates_static.py`, covers template shape).
2. **`backend/.env` is not tracked** (verified `git ls-files backend/.env` → empty), and no
   `backend/.env.example` template exists; backend local env setup relies on `README.md`
   prose and `backend/app/core/config.py` defaults. (An earlier exploration note claiming
   `backend/.env` was tracked was checked and is **false**.)
3. Backend settings are centralized in `backend/app/core/config.py` (~100 fields) — a single
   source of truth, with production guards (`PRODUCTION_REQUIRED_RLS_TABLES`,
   `PRODUCTION_BLOCK_STAGING_SUPABASE_HOSTS`) enforced by
   `backend/app/core/startup_guards.py`.
4. Frontend flags are centralized in `src/config/featureFlags.js`; only `EXPO_PUBLIC_*`
   values can reach the bundle. One flag (`SHOW_DEV_CONNECTION_DEBUG`) is hardcoded `false`
   rather than env-driven — see `DEAD_CODE_CANDIDATES.md`.
5. `render.yaml` contains staging-only services with secrets declared `sync: false` (names
   only in-file) — correct hygiene; production deployment is not described in-repo.

## 6. Files Requiring Extra Tests Before Change

High-risk *and* under-covered or structurally hostile to safe change:

1. `src/app/App.js` — every gate (session, bootstrap, role, check-in) is sequential
   early-return logic in one component; behavior coverage exists in `src/app/__tests__/` but
   any nav change needs targeted tests for the specific gate ordering being touched.
2. `src/features/dailyCheckin/screens/DailyCheckinScreen.js` (5,200 lines) — check-in flow,
   plan builder, and inline debug UI in one file; existing tests cover loading states and
   training flow, not the full state surface.
3. `src/features/trainerPlatform/screens/TrainerSystemScreen.js` — 10+ views behind one
   `viewStack`; view-transition regressions are cheap to introduce and hard to spot.
4. `backend/app/modules/conversation/service.py` — largest backend file; safety, memory,
   and streaming interleaved. Existing pytest coverage is substantial
   (`test_chat_*`, `test_conversation_*`, `test_llm_orchestration`), but any change here
   should add a test for the specific orchestration branch touched (per
   `MODE_AGENT_RULES.md` review standard).
5. The four routers that bypass the service layer (§1.2) — behavior lives in the route
   function, so route-level tests are the only net: `test_account_api`,
   `test_account_deletion_api`, `test_auth_password_proxy_api`, `test_feedback_api`,
   `test_storage_*` exist and should be extended alongside any change.
6. The root `/workouts` mount — no test asserts its existence or absence; before removing
   it (Phase 2), add a route-surface assertion so removal is deliberate and observable
   (`backend/tests/test_trainer_route_surface_contract.py` is the pattern to follow).

## 7. Ownership

Commit authorship (`git log --format='%an' -- <path> | sort | uniq -c`, full history on this
baseline): a single author ("Doshi") across every area — `backend/` 145, `src/` 98, `lib/`
26, `docs/` 36, `scripts/` 14, `.github/` 11. No `CODEOWNERS` file exists
(`git ls-files | grep -i codeowners` → none). Practical ownership: single-maintainer
(founder) with agent assistance under the authority model in `MODE_AGENT_RULES.md`; there is
no per-area ownership signal to distinguish.
