# PHASE 4 - Implementation Plan

Date: 2026-04-11  
Scope: Practical execution sequence for trainer-side rollout with client-side safety guarantees.

## 1) Delivery Strategy

- Ship trainer platform incrementally, not as a monolith.
- Preserve client production flow at every step.
- Use additive schema/API strategy and feature flags.
- Gate each phase with regression checks before proceeding.

## 2) Sequenced Implementation Plan

### Step 1: Shared Schema/Domain Additions
- Deliver:
- New additive trainer-platform tables (`client_notes`, `trainer_rules`, `trainer_rule_versions`, `ai_generated_outputs`, `ai_feedback_events`, `talking_points`, `analytics_snapshots`, `ingestion_jobs`).
- RLS and helper-function extensions for new tables.
- Rollback:
- Drop or disable new tables/features only; leave existing schema untouched.
- Risks:
- RLS policy mistakes.
- Client impact:
- None expected.

### Step 2: Trainer Route Shell Foundation
- Deliver:
- Trainer namespace in app shell.
- Stable trainer layout scaffolding for Agent Lab, Command Center, Client Detail, AI Review.
- Preserve existing client tabs and tab logic.
- Rollback:
- Feature-flag trainer shell rendering.
- Risks:
- App-shell branching complexity.
- Client impact:
- None expected if role gating is preserved.

### Step 3: Agent Lab (Trainer Knowledge Capture)
- Deliver:
- Chat-style/paste knowledge input.
- Raw input persistence.
- Ingestion job creation.
- Initial rule extraction result viewer.
- Rollback:
- Keep raw-save path active, disable extraction if unstable.
- Risks:
- Extraction quality variability.
- Client impact:
- None.

### Step 4: Trainer Knowledge Ingestion + Rule Extraction Pipeline
- Deliver:
- Deterministic extraction service.
- Rule normalization + versioning persistence.
- Extraction status tracking.
- Rollback:
- Disable extraction worker and keep manual trainer input flow.
- Risks:
- Bad extraction causing noisy rule set.
- Client impact:
- None.

### Step 5: Command Center
- Deliver:
- Prioritized client list.
- Weekly adherence/completion signals.
- Risk flags.
- Persisted talking points.
- Rollback:
- Fallback to current `trainer_home` computed heuristics.
- Risks:
- Signal correctness and ranking trust.
- Client impact:
- None.

### Step 6: Client Detail + Memory
- Deliver:
- Trainer-side client profile panel.
- Notes with visibility toggle (`internal_only`, `ai_usable`).
- Structured constraints/preferences management.
- Explainability surface.
- Rollback:
- Read-only mode if write-path regression appears.
- Risks:
- Visibility and permissions errors.
- Client impact:
- None, unless explicitly exposing memory to client surfaces later.

### Step 7: AI Review / Improvement
- Deliver:
- Review queue of generated outputs.
- Original vs edited output audit.
- Feedback event capture.
- Preference delta extraction.
- Rollback:
- Disable delta extraction, keep edit audit only.
- Risks:
- Linking outputs/edits reliably.
- Client impact:
- None.

### Step 8: AI Pipeline Integration
- Deliver:
- Layered context assembly:
- trainer-global
- client-local
- dynamic analytics
- output generation
- feedback application
- Integrate trainer intelligence into targeted generation paths first.
- Rollback:
- Endpoint-level fallback to legacy generation path.
- Risks:
- Shared-layer regression risk.
- Client impact:
- Moderate risk area; protect with contract tests and adapter reads.

### Step 9: Cleanup / Refactor Pass
- Deliver:
- Remove safe dead paths.
- Reduce duplication.
- Harden service boundaries.
- Improve naming and module ownership.
- Rollback:
- Avoid destructive removals until full parity validation.
- Risks:
- Accidental removal of latent dependencies.
- Client impact:
- Low if gated by full regression.

### Step 10: Regression + Validation
- Deliver:
- Full regression matrix on protected client flows and new trainer flows.
- Contract verification and tenant isolation checks.
- Rollback:
- Revert feature flags by module.
- Risks:
- Hidden side effects across shared modules.
- Client impact:
- Controlled via release gates.

## 3) Testing Strategy by Layer

### Contract Tests (Critical)
- `checkin` endpoint request/response compatibility.
- `chat` endpoint request/response compatibility.
- assignment status field compatibility.

### Permission + Tenancy Tests
- Trainer-only endpoint actor checks.
- Cross-tenant read/write denial tests on new tables.
- Visibility tests for `internal_only` vs `ai_usable` notes.

### Data Integrity Tests
- Rule version sequencing.
- ingestion job state transitions.
- output -> feedback link integrity.

### UI Regression Tests
- Client role route snapshots and flow checks.
- Trainer role route flow and action checks.

### E2E Smoke Tests
- Client:
- sign in -> assignment status -> daily check-in -> chat -> progress.
- Trainer:
- sign in -> agent lab save -> command center list -> client detail note -> AI review edit.

## 4) Rollout and Feature Flags

- `TRAINER_PLATFORM_ROUTES_ENABLED`
- `TRAINER_AGENT_LAB_ENABLED`
- `TRAINER_RULE_EXTRACTION_ENABLED`
- `TRAINER_COMMAND_CENTER_ENABLED`
- `TRAINER_CLIENT_MEMORY_ENABLED`
- `TRAINER_AI_REVIEW_ENABLED`
- `TRAINER_CONTEXT_INJECTION_ENABLED`

Release pattern:
- Enable in staging first.
- Enable per tenant cohort in production.
- Monitor logs/metrics/errors before expanding rollout.

## 5) Open Risk Areas to Watch Closely

- Shared app shell route/state branching in `src/app/App.js`.
- Conversation service breadth and fallback complexity.
- Admin client usage in trainer services that aggregate across tables.
- Migration drift between full setup SQL and incremental SQL paths.

## 6) Done Criteria for Pre-Feature Planning (Phases 1-4)

- Repo audit documented.
- Protected client surface explicitly documented.
- Target architecture documented with boundaries and compatibility strategy.
- Schema/domain model documented with relationships, indexes, RLS notes, migration plan.
- Sequenced implementation plan documented with rollback/test strategy.

## Phase 4 Closeout

### Summary
- Implementation order is practical, dependency-aware, and rollback-ready.
- Plan prioritizes trainer value delivery while preserving client production behavior.

### Risks
- Shared-layer regressions in AI integration and route handling.
- Permission leaks if trainer actor checks are inconsistently applied.

### Assumptions
- Feature flags and staged rollout are available.
- Existing test suite is extended with trainer-platform contracts before cutover.

### What Will Be Changed Next
- Begin PHASE 5 implementation (trainer route foundation) under feature flag with no client behavior changes.

### Possible Client-Side Impact
- None expected through steps 1-7.
- Steps 8-10 require strict contract and regression gates.
