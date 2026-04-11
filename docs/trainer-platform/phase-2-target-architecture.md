# PHASE 2 - Target Architecture

Date: 2026-04-11  
Scope: Trainer-side expansion architecture with explicit client-side preservation and backward compatibility.

## 1) Architecture Goals

- Preserve existing client production experience unchanged.
- Create a clean trainer platform namespace and domain boundary.
- Enforce tenant isolation across DB, services, retrieval, and generation.
- Add structured trainer intelligence layers, not prompt-only glue.

## 2) Frontend Target Architecture

### Preserve (No Breaking Change)
- Existing client routes, tab keys, and flow semantics remain unchanged.
- Existing client screens and services remain primary for client role.

### Extend
- Introduce trainer feature namespace:
- `src/features/trainerPlatform/agentLab`
- `src/features/trainerPlatform/commandCenter`
- `src/features/trainerPlatform/clientMemory`
- `src/features/trainerPlatform/aiReview`
- `src/features/trainerPlatform/shared`

### Shell Strategy
- Keep current app shell runtime split by `viewer_role`.
- Add trainer-specific route state internal to trainer branch.
- Maintain existing trainer tab keys initially for compatibility:
- `home` mapped to Agent Lab overview.
- `clients` mapped to Command Center.
- `coach` remains shared chat endpoint but with trainer context-aware behavior.

## 3) Backend Target Architecture

### Preserve
- Existing `/api/v1/checkin/*`, `/api/v1/chat`, `/api/v1/trainer-assignment/*` contracts.
- Existing `daily_checkins`, `conversation`, and assignment pathways for client flow.

### Extend (New Trainer-Oriented Modules)
- `trainer_agent_lab`:
- raw trainer inputs
- extraction job triggers
- rule review/edit lifecycle
- `trainer_command_center`:
- client prioritization
- risk/adherence signals
- talking points persistence
- `trainer_client_memory`:
- notes
- preferences
- constraints
- visibility controls
- `trainer_feedback`:
- output review queue
- edit capture
- feedback event persistence
- `trainer_ai_orchestration`:
- layered context assembly
- deterministic retrieval and guarded generation calls

### Service Boundary Pattern
- API -> service -> repository remains mandatory.
- Shared orchestration components:
- `KnowledgeIngestionService`
- `RuleExtractionService`
- `ContextAssemblyService`
- `OutputGenerationService`
- `FeedbackLearningService`

## 4) AI Orchestration Boundary (Required 5 Layers)

### Layer 1 - Trainer Global Knowledge
- Philosophy, rules, style, tone, contraindications.
- Stored as raw docs + extracted structured rules + version history.

### Layer 2 - Client Memory
- Client-local goals, preferences, constraints, notes.
- Visibility-aware storage (`internal_only`, `ai_usable`).

### Layer 3 - Dynamic Analytics
- Daily check-ins, workout adherence, progress and recovery signals.

### Layer 4 - Generated Outputs
- Talking points, response drafts, plan recommendations, guidance artifacts.
- Stored with context references for auditability.

### Layer 5 - Feedback/Corrections
- Trainer edits and overrides captured as feedback events.
- Structured preference deltas extracted where possible.

## 5) Auth + Permissions Target

- Keep `require_user` and tenancy resolution.
- Add explicit role dependencies for trainer platform endpoints:
- `require_trainer_actor`
- `require_client_actor`
- Trainer platform write APIs must validate trainer actor identity (`trainer_user_id == auth user`).
- Client memory reads for trainers must also verify trainer-client relationship in tenant.

## 6) Multi-Tenant Isolation Strategy

- All new trainer platform tables must include `tenant_id`.
- Queries must include tenant + actor constraints.
- RLS policies for all new tables must use helper auth functions.
- Admin-client paths are allowed only where unavoidable and must include explicit trainer/tenant filters in service layer.

## 7) Backward Compatibility Strategy

- Existing client endpoint paths remain unchanged.
- Existing request/response keys remain unchanged.
- Shared layer changes are additive first.
- Deprecations require compatibility window and adapter logic.
- Existing check-in and chat contracts are treated as compatibility-critical APIs.

## 8) What Stays / Extends / Refactors / Isolates

### What Stays the Same
- Client flow and client endpoints.
- Existing assignment status + role-gating behavior.
- Existing daily check-in lifecycle and payload expectations.

### What Gets Extended
- Trainer route/state namespace.
- Trainer APIs for agent lab, command center, client memory, and AI review.
- DB schema for rules, notes, feedback, outputs, ingestion jobs.

### What Gets Refactored
- Internal service composition for AI context assembly.
- Conversation service decomposition into smaller orchestration units.
- Trainer-home heuristics promoted into command-center domain services.

### What Must Be Isolated
- Trainer-global intelligence from client-local memory.
- Trainer-only tooling from client surfaces.
- Tenant data at DB query + RLS + service boundary.

## Phase 2 Closeout

### Summary
- Target architecture supports trainer platform growth while preserving current client production behavior.
- Integration points and boundaries are explicit and enforceable.

### Risks
- Shared-shell complexity during incremental route separation.
- Permission inconsistencies if new trainer APIs skip strict actor checks.
- Partial refactors creating dual logic paths without clear ownership.

### Assumptions
- Incremental migration and feature-flag rollout are available.
- Existing client contracts are treated as immutable in early phases.

### What Will Be Changed Next
- Define schema/domain entities, relationships, indexes, and RLS notes.
- Define migration sequencing and compatibility adapters.

### Possible Client-Side Impact
- None in phase 2 (design only).
