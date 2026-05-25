# MODE Agent Rules

## Authority Model

- The human founder is the final approval authority.
- Codex is the primary implementation runner for MODE.
- Claude Code is the second-pass reviewer, architect, and precision editor.
- No agent approves or merges its own work.
- No agent may approve, merge, or declare production-ready its own high-risk
  work.
- No agent treats another agent's output as trusted without inspecting the diff,
  tests, and risk surface.

## Default Ownership

Codex owns:

- Scoped feature implementation.
- Multi-file edits and refactors.
- Test additions and test fixes.
- Boilerplate, scaffolding, and CI/script fixes.
- Documentation updates after implementation.

Claude Code owns:

- Diff review before merge.
- Architecture critique and risk flagging.
- Precision edits in high-risk files when explicitly scoped.
- RLS, auth, tenant, migration, streaming, memory, and AI orchestration review.
- Handoff quality checks between agent passes.

## Mandatory Second-Agent Review

Require second-agent review before merge for anything touching:

- Auth, JWT handling, Supabase session handling, or login modes.
- RLS policies, SQL migrations, tenant IDs, trainer/client relationship checks,
  or service-role client usage.
- Production/staging environment separation.
- AI orchestration, provider routing, prompt files, safety handling, or model
  fallback behavior.
- Memory writes, trainer knowledge ingestion, assistant draft persistence, or
  Atlas/trainer intelligence learning.
- SSE streaming, chat session history, chat cache, or prompt-injection handling.
- Trainer/client assignment, onboarding role state, or root app navigation.
- Account deletion, personal data inventory, private storage, or storage cleanup.
- Release gates, CI security workflows, Render configuration, or security scan
  scripts.

## Task Scoping Rules

- Never give or accept vague work in high-risk areas. Convert it into a scoped
  task with files, intended behavior, tests, and rollback notes.
- Prefer additive changes over destructive changes.
- Preserve existing client behavior while extending trainer features.
- Do not modify existing SQL migrations. Add a new date-prefixed file.
- Do not disable security gates, weaken RLS, bypass rate limits, or widen CORS
  without explicit human approval.
- Do not introduce a new state management framework, API client pattern, or
  backend layering pattern unless the task explicitly requires it.

## Handoff Requirements

Every agent handoff should include:

- Goal and user-facing behavior.
- Files changed or files under review.
- Tests and commands run, with pass/fail status.
- Risk triggers from the mandatory review list.
- Known gaps, assumptions, or questions.
- Recommended next owner: Codex, Claude Code, or human.

## Review Standard

Review findings come first, ordered by severity. A useful review checks:

- Tenant isolation: every read/write is scoped by tenant, trainer, client, and
  actor as appropriate.
- Auth: route dependencies and JWT/session handling cannot be bypassed.
- RLS: no policy weakening and no service-role path without explicit filtering.
- Env separation: local/staging/prod secrets and switches are not mixed.
- AI safety: prompt injection, safety escalation, provider failure, and fallback
  behavior remain controlled.
- Streaming: SSE emits compatible status, delta, done, and error events.
- Data lifecycle: memory, storage, and account deletion stay consistent.
- Tests: targeted tests exist for changed behavior and high-risk regressions.

## Verification Before Closeout

- Run the most specific tests for the change.
- Run `npm run codex:check` after repo changes.
- If no backend is reachable, start `npm run backend:dev`, rerun
  `npm run codex:check`, and have the user tap `Retry` in the app.
- Report any check that could not be run and why.
