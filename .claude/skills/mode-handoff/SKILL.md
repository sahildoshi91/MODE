---
name: mode-handoff
description: MODE agent handoff workflow for Claude Code and Codex collaboration. Use when preparing or reviewing a handoff between agents, summarizing implementation status, packaging a review request, transferring a task after interruption, or documenting what another agent should inspect next.
---

# MODE Handoff

Use this skill to make handoffs specific enough that another agent can continue
without rediscovering the project state.

## Handoff Template

```text
Goal
- What user-visible or system behavior should change.

Current State
- What has been changed, reviewed, or discovered.

Files In Scope
- Files changed or files the next agent should inspect.

Verification
- Commands run and results.
- Commands not run and why.

Risk Triggers
- Any mandatory second-review areas from MODE_AGENT_RULES.md.

Known Gaps
- Bugs, ambiguity, assumptions, or follow-up work.

Next Owner
- Codex, Claude Code, or human, with the reason.
```

## Handoff Rules

- Include exact file paths.
- Include test status, not just test names.
- Call out backend reachability issues and whether `npm run codex:check` passed.
- Call out if the app needs the user to tap `Retry`.
- Do not imply approval if the handoff includes unresolved high-risk items.
- Keep high-risk work scoped to concrete files and intended behavior.

## Direction Guidance

- Codex should receive implementation tasks with files, behavior, tests, and
  constraints.
- Claude Code should receive review tasks with the diff, risk triggers, and test
  evidence.
- Human decisions should be requested for production data, migration execution,
  security gate changes, release approvals, and ambiguous product tradeoffs.
