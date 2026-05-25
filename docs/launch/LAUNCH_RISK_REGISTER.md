# MODE Launch Risk Register

Planning date: 2026-05-25

Status values: `Open`, `Mitigating`, `Accepted`, `Closed`. Critical or high `Open` risks block launch.

| ID | Risk | Severity | Signal | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| LSR-001 | Secret exposure risk | Critical | Provider key, Supabase service-role key, token file, or real env value appears in tracked files, logs, or client bundle | Redacted secret scan, path-only token/temp-file reporting, placeholder-only env examples, rotate anything ever shared | Security owner | Mitigating |
| LSR-002 | Unsigned/unshippable IPA risk | Critical | IPA is unsigned, stale, or lacks a verified export path | Do not submit current artifacts; document Apple signing/export work as human-owned next slice | Mobile release owner | Open |
| LSR-003 | Embedded LAN API base URL risk | High | Artifact scan finds `localhost`, `127.0.0.1`, LAN IP, staging, or dev API base | Stream-scan IPA/bundles and block release until production API origin is clean | Mobile release owner | Mitigating |
| LSR-004 | Streaming reliability risk | High | Timeout, partial stream, missing done event, or schema/RLS mismatch breaks chat UX | Backend kill switches, provider timeout, safe SSE errors, chat event/RLS migration plan | Backend owner | Mitigating |
| LSR-005 | AI spend/cost risk | High | Provider calls spike, token budgets are uncapped, or no emergency shutoff exists | Configurable provider enablement, max output tokens, global/per-user chat limits | Backend owner | Mitigating |
| LSR-006 | Tenant isolation risk | Critical | Client/trainer reads or writes across tenant/trainer-client boundaries | Keep tenant context in app paths; draft RLS/tenant-pair guardrail migration and tenant A/B tests before approval | DB owner | Open |
| LSR-007 | Account deletion/privacy risk | High | UI promises deletion complete while backend only queues, or privacy policy omits deletion handling | Async deletion wording, in-app initiation, deletion documentation and human privacy review | Privacy owner | Mitigating |
| LSR-008 | App Review risk | High | Missing privacy/terms/support links, medical claims, age rating mismatch, or incomplete reviewer notes | Visible links, lightweight AI disclaimer, Apple task checklist, reviewer notes | App Store owner | Mitigating |
| LSR-009 | Observability risk | Medium | Chat failures, timeouts, rate limits, provider errors, or stream completions are not diagnosable without prompt content | Structured request/provider/rate-limit/stream timing logs without raw chat content | Backend/DevOps owner | Mitigating |
| LSR-010 | Mobile network resilience risk | Medium | Weak network causes unclear chat failure or duplicate sends | Manual weak-network TestFlight tests and safe user-facing retry copy | QA owner | Open |

## Launch Hold Rules
- Any exposed real secret or service-role key in tracked files, client bundle, or scanner output is a no-go.
- Any successful cross-tenant runtime read/write is a no-go.
- Any current IPA containing LAN/local/staging URLs is a no-go.
- Any DB/RLS migration from `docs/launch` must be reviewed and approved before use.
