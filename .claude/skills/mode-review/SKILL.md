---
name: mode-review
description: MODE second-pass code review workflow for Claude Code. Use when reviewing diffs or proposed changes in the MODE repo, especially changes touching auth, RLS, tenant isolation, SQL migrations, staging/prod environment separation, AI orchestration, memory writes, SSE streaming, trainer/client assignment, safety handling, account deletion, storage, release gates, or root app navigation.
---

# MODE Review

Use this skill to review changes before merge. Start with findings, ordered by
severity. If there are no findings, say that clearly and name any remaining test
or verification gaps.

## Review Inputs

Collect or ask for:

- Goal and expected user-facing behavior.
- Diff or list of changed files.
- Tests and commands already run.
- Environment involved: local, staging, or production.
- Whether the change touches a mandatory second-review area from
  `MODE_AGENT_RULES.md`.

## Diff Inspection

Inspect repo state before reviewing:

```bash
git status --short
git diff --stat
git diff
git diff --cached --stat
git diff --cached
git ls-files --others --exclude-standard
```

If reviewing a PR or branch, also compare against the intended base branch with
`git diff --stat <base>...HEAD` and `git diff <base>...HEAD`. Inspect untracked
files explicitly because plain `git diff` does not show their contents.

## Mandatory Checks

- Auth: route dependencies, JWT/session handling, and role checks cannot be
  bypassed.
- Tenancy: reads/writes are scoped by tenant, trainer, client, and actor as
  appropriate.
- RLS: no policy weakening, no existing migration rewrites, no service-role path
  without explicit tenant filtering.
- Environments: no local/staging/prod credential mixing and no secrets in code or
  tracked env files.
- AI safety: prompt injection, safety escalation, provider timeout, fallback, and
  model-routing behavior remain controlled.
- Memory and trainer intelligence: writes are actor-scoped, reviewable where
  required, and deletion-compatible.
- Streaming: SSE event names and done/error behavior remain compatible with the
  frontend.
- Navigation: root role/onboarding/client/trainer branches still preserve
  existing client behavior.
- Compliance: account deletion, personal data inventory, private storage, and
  storage cleanup stay consistent.
- Tests: targeted tests exist for changed behavior and high-risk regressions.

## Output Format

Use this structure:

```text
Findings
- [Severity] file:line - Issue, impact, and suggested fix.

Open Questions
- Any question that blocks approval or changes risk.

Tests Reviewed
- Commands/results provided or inspected.

Decision
- Approve, request changes, or needs human decision.
```

Keep summaries brief. Do not bury a blocking issue below general praise.
