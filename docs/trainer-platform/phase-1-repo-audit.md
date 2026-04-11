# PHASE 1 - Repo Audit

Date: 2026-04-11  
Scope: Full-stack audit with explicit client-side protection boundaries before trainer-side expansion.

## 1) Current Architecture Summary

### Frontend
- Runtime app shell lives in `src/app/App.js` and handles auth, role split, and tab routing with local state.
- Client and trainer experiences share one shell and a shared bottom navigation component.
- Role source of truth is `/api/v1/trainer-assignment/status` (`viewer_role` values: `trainer|client|unassigned`).
- Client main features:
- `DailyCheckinScreen`
- `CoachChatScreen`
- `ProgressScreen`
- `CoachInsightsScreen`
- `ProfileScreen`
- Trainer current features:
- `TrainerHomeScreen` (knowledge input + saved docs)
- `TrainerClientsScreen` (today schedule + weekly summaries + talking points)
- `CoachChatScreen` launch from trainer context

### Backend
- FastAPI entrypoint: `backend/app/main.py`.
- API routing: `backend/app/api/v1/*` with clear endpoint grouping.
- Core auth: Supabase bearer token verified in `backend/app/core/auth.py`.
- Core tenancy context: `resolve_trainer_context()` in `backend/app/core/tenancy.py`.
- Dependency wiring in `backend/app/core/dependencies.py` binds repositories/services per request.
- Domain modules are mostly clean service/repository pairs:
- `conversation`
- `daily_checkins`
- `trainer_home`
- `trainer_knowledge`
- `trainer_review`
- `trainer_persona`
- `profile`
- `plan`
- `workout`

### Data + Security
- Multi-tenant tables and RLS foundation exist.
- Helper SQL auth functions exist (`auth_can_view_client`, `auth_can_access_conversation`, etc.).
- Most trainer/client shared data access is mediated by RLS and tenancy context, but some trainer services use admin client and rely on service-level filtering.

### AI Integration
- Conversation orchestration: `conversation/service.py` + router heuristics in `conversation/routing.py`.
- Daily check-in plan generation: `daily_checkins/service.py`.
- Multi-provider support exists (Gemini, OpenAI, Anthropic) with provider fallback logic.

## 2) PROTECTED CLIENT SURFACE AREA

This is the non-negotiable client production surface to preserve.

### Client Routes to Preserve
- Auth flow states in `src/app/App.js`:
- onboarding intro
- login
- authenticated client shell
- Client tab states:
- `home` (daily check-in)
- `coach`
- `progress`
- `profile`
- Progress secondary route behavior:
- `progress` main view
- `insights` drill-in view
- Assignment gate behavior for unassigned client users.

### Client Pages/Components to Preserve
- `src/features/dailyCheckin/screens/DailyCheckinScreen.js`
- `src/features/chat/screens/CoachChatScreen.js`
- `src/features/progress/screens/ProgressScreen.js`
- `src/features/insights/screens/CoachInsightsScreen.js`
- `src/features/profile/screens/ProfileScreen.js`
- `src/features/navigation/components/LiquidBottomNav.js`
- `src/features/trainerAssignment/screens/TrainerAssignmentScreen.js` (for assignment gating continuity in client sign-in path)

### Client Services/Contracts to Preserve
- `src/features/dailyCheckin/services/checkinApi.js` endpoint contracts:
- `GET /api/v1/checkin/today`
- `GET /api/v1/checkin/previous`
- `GET /api/v1/checkin/progress`
- `POST /api/v1/checkin`
- `POST /api/v1/checkin/generate-plan`
- `POST /api/v1/checkin/log-workout`
- `src/features/chat/services/chatApi.js`:
- `POST /api/v1/chat`
- `src/features/trainerAssignment/services/trainerAssignmentApi.js`:
- `GET /api/v1/trainer-assignment/status`
- `POST /api/v1/trainer-assignment/assign`

### Shared Contracts That Must Stay Backward-Compatible
- `ChatResponse` shape consumed by client chat hook/screen.
- `DailyCheckinStatusResponse`, `DailyCheckinResult`, and mode semantics.
- Generated plan response keys:
- `plan_id`
- `plan_type`
- `content`
- `structured`
- `request_fingerprint`
- `revision_number`
- `workout_context`
- Assignment status fields consumed in app shell:
- `viewer_role`
- `needs_assignment`
- `assigned_trainer_display_name`
- `trainer_onboarding_completed`
- `available_trainers`

### Safe Extension Points for Trainer Work
- Add new trainer-side frontend feature folders without changing client feature module signatures.
- Add trainer-only backend endpoints under new prefixes.
- Additive DB schema expansion with new tables and additive columns only.
- Internal service refactors behind stable endpoint contracts.

## 3) Strong Areas to Preserve

- Existing API/service/repository layering is strong and scalable.
- Existing test coverage for critical check-in/chat/tenancy/trainer-assignment paths is solid.
- Multi-tenant table model and RLS helper-function base is good.
- Existing trainer-side primitives (knowledge docs, review queue, trainer home metrics) reduce greenfield risk.
- Daily check-in + generated-plan flow is mature and must stay stable.

## 4) Weak Areas to Refactor

- `src/app/App.js` is doing too much runtime routing/state orchestration in one file.
- `conversation/service.py` is overloaded (onboarding, routing, prompting, provider orchestration, persistence).
- Trainer global knowledge capture exists, but structured rule extraction/versioning is missing.
- Client memory controls (internal vs AI-usable) are missing.
- Some trainer APIs check for trainer context but not always strict trainer actor semantics.
- Legacy and active workout/profile pathways coexist and create ambiguity.

## 5) Dead Code / Duplication / Fragility

- Legacy workout generation endpoint (`/workouts/generate`) uses `profiles` table and is disconnected from the active client app path.
- `plans` and `profiles` APIs exist but are not currently consumed by frontend screens.
- Multiple setup/migration entry paths (`supabase_full_setup.sql` vs incremental migrations) increase drift risk.
- README architecture snapshot is stale relative to current feature set.
- Conversation/check-in AI logic has duplicated prompt-context and fallback concerns across modules.

## 6) Missing Domain Concepts Needed for Trainer Build

- Trainer-global rule catalog and rule versioning model.
- Client memory model with visibility classes:
- internal-only
- AI-usable
- Structured constraints/preferences store separated from freeform notes.
- AI output audit model that captures original output + context snapshot.
- Feedback events linked to generated outputs and future behavior.
- Ingestion job model for extraction pipelines and traceability.
- Explainability snapshot model for trainer trust/debug surfaces.

## 7) Initial Risk List

- High: Client regression risk due to shared app shell and role-driven branch logic.
- High: Tenant leakage risk if admin-client trainer services are expanded without strict guardrails.
- High: API contract break risk in check-in/chat payloads if shared layer refactors are not additive.
- Medium: Migration drift risk from full setup script plus incremental script coexistence.
- Medium: Domain coupling risk if trainer memory/rules are bolted onto existing mixed services.
- Medium: Permission model drift if trainer actor checks are inconsistent across trainer endpoints.

## Phase 1 Closeout

### Summary
- Current architecture is viable for expansion, but trainer/client boundaries are not yet clean enough for safe scale.
- Protected client surface is now explicitly enumerated and locked.

### Risks
- Shared-shell routing coupling.
- Shared endpoint contract fragility.
- Tenant isolation mistakes in admin-backed trainer services.

### Assumptions
- Current client flow in `App.js` and existing client API contracts are production and must remain intact.
- Backward compatibility is default for shared-layer changes.

### What Will Be Changed Next
- Define target architecture with explicit trainer namespace and service boundaries.
- Define schema/domain model that separates trainer-global and client-local intelligence.
- Sequence implementation with feature flags and rollback points.

### Possible Client-Side Impact
- None in phase 1 (audit only).
