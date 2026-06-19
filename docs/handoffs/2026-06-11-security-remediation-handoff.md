# Handoff — Security Remediation (Phase 0 H4 complete, H5 unresolved → env verification + Phase 1)

Date: 2026-06-11 · Repo: MODE · Branch: `main` (changes uncommitted in working tree)

## Goal
Close the findings from the 2026-06-11 security audit without weakening any existing
control. Two launch-blocking threads drive priority:
1. **Auth revocation (H1/H3/M2)** — the local-JWT path has no live revocation, so
   banned/disabled/deleted users keep API access until their access token expires.
2. **Rate limiting (H4/H5)** — limiter is correct in Redis form but the shipped
   defaults/deploy can defeat it.
Full findings + phased plan: `~/.claude/plans/you-are-acting-as-cryptic-dusk.md`
(18 findings across 7 areas; severity inventory + Phase 0–5 sequencing inside).

## Current State
**Phase 0 (config/deploy) is partially implemented in the working tree — NOT committed, NOT merged, NOT reviewed.**
- Audit correction: **H4 was over-rated.** Production already refuses to boot on a
  non-redis backend (`startup_guards.py:71-72`), and staging sets `RATE_LIMIT_BACKEND=redis`
  (`render.yaml:17`). H4 is not a production launch blocker. Residual in-repo gap (staging
  not gated) is now closed.
- H5 (no proxy headers → client IP is the proxy IP) remains unresolved. A prior attempt used
  `--forwarded-allow-ips="*"`, but that trusts forwarded headers from any connecting peer and
  lets spoofed `X-Forwarded-For` values create fresh IP rate-limit buckets. The wildcard has
  been removed from staging config until Render confirms a scoped trusted-proxy value or a
  different trusted-client-IP strategy is designed.
- Deliberate deviation from the plan's Phase 0.2: do **not** add a hand-rolled
  `X-Forwarded-For` parser. Taking the leftmost XFF hop is itself an IP-spoofing
  rate-limit-bypass. Exact spoofing-resistant hop selection given Render's topology is a
  flagged follow-up.

## Files In Scope
Changed (working tree, uncommitted):
- `render.yaml:13` — web `startCommand` intentionally does **not** include proxy-header trust
  flags; the wildcard trust attempt was reverted because H5 stays open under spoofed XFF.
- `backend/app/core/startup_guards.py` — added `_assert_rate_limit_backend_for_shared_env()`,
  called from `run_startup_guards()` before the production-only early return; refuses boot on
  the in-memory rate-limit backend in **staging or prod** (was prod-only).
- `backend/tests/test_startup_guards.py` — +2 tests (staging+memory fails; staging+redis passes).

Inspect for next phases:
- H1: `backend/app/core/auth.py` (`require_user` ~`:341-485`, `_verify_jwt_locally` `:250-276`,
  cache `:349-368`, keys `:87-88`), `backend/app/core/dependencies.py:113-114`,
  `backend/app/modules/account_deletion/service.py:124` (publish revocation near `delete_auth_user`).
- H2: `backend/app/modules/conversation/service.py` streaming loops `:3754-3761,:4002,:4124,:4342`,
  full-text guard `:3793`; `backend/app/modules/conversation/security.py:44-60`.

## Verification
- `./venv/bin/pytest tests/test_startup_guards.py` → **9 passed** (7 existing + 2 new).
- `./venv/bin/python -c "import app.core.startup_guards"` → import OK.
- **`npm run codex:check` NOT run** — it needs a reachable backend; not started in this pass.
  Run it before final handoff/merge; if it fails for lack of a backend, start
  `npm run backend:dev`, rerun, and have the user tap `Retry` in the app.
- `backend/tests/test_storage_orphan_cleanup_script_static.py` now includes a static guard
  against `--forwarded-allow-ips="*"` in `render.yaml`.
- Rate-limit behavior change (proxy IP) is not fixed yet; H5 requires Render/platform
  verification before proxy headers can be safely enabled.

## Risk Triggers (mandatory second-agent review per MODE_AGENT_RULES.md)
- `render.yaml` = **Render configuration** → review required before merge.
- `startup_guards.py` = **release/startup security gate** → review required before merge.
  (Change is additive/strengthening — adds a gate, disables none.)
- **Phase 1 (auth.py) is high-risk** — JWT/auth/tenant isolation. Must be **design-first**:
  produce a written design artifact + second-agent review BEFORE editing `auth.py`. Do not
  implement auth changes directly from this handoff.

## Known Gaps / Follow-ups
1. **Resolve trusted proxy strategy for Render (human/infra + second-agent review).** Public
   docs did not provide a stable inbound edge/proxy CIDR list to hardcode. Do not use Render
   outbound/static IP ranges for this. Either get a Render-confirmed scoped
   `--forwarded-allow-ips` value, document why Render's topology makes wildcard trust
   acceptable for this service, or design a different trusted-client-IP strategy before launch.
2. **Verify prod Render start command (human).** This `render.yaml` is staging-only
   (`APP_ENV=staging`, branch `pr6-ai-chat-memory-scaling`). Prod is configured in the Render
   dashboard. Confirm the prod web service does not use wildcard proxy trust, whether it has
   proxy flags at all, and whether `RATE_LIMIT_BACKEND=redis` plus `REDIS_URL` are present
   before deploying the H4 guard.
3. **Redis hardening (human/infra, Phase 0.3).** Confirm Redis requires AUTH, is not
   internet-exposed, and staging/prod use separate instances or logical DBs. Retires the
   M1/M6 blast-radius concerns. Redis is load-bearing in 3 subsystems (auth cache, tenant
   cache, job queue + rate limiting) and is env-namespaced in none.
4. **Phase 1 not started** — design-first artifact pending (see Next Owner).
5. Changes are uncommitted on `main`; branch before committing.

## Next Owner
- **Human:** env verifications #1–#3 above (settle H4/H5 fully; cannot be done from code).
- **Claude Code (design, then review):** Phase 1 (H1/H3/M2) revocation **design only** —
  Redis denylist `mode:{env}:auth_revoked:{sub}`, `denylist_ttl_seconds ≈ 3700`, consulted on
  the local-JWT path before `require_user` returns; **fail-open read / fail-loud write**;
  cache invalidation per subject; env-namespaced keys. Deliver as a written design for review
  before any `auth.py` edit. Pressure-test points: `iat`-vs-revocation comparison under clock
  skew, and whether ALL ban/disable/delete write sites are covered (a missed one = silent hole).
- **Claude Code (review):** the Phase 0 diff above (render.yaml + startup_guards.py) before merge.
- **Codex (later):** Phases 3–5 (rate-limit edges L5/L7, jobs/data-integrity M5/M6/M7,
  durability M3/M4/L1/M8/L8) — cheaper, scoped implementation tasks.

## Do NOT
- Treat Phase 0 as approved/merge-ready — it has unreviewed review-required files.
- Implement `auth.py` (H1) directly — design-first + review is mandatory.
- Shorten the Supabase access-token TTL as part of H1 (separate optional hardening; the
  denylist is what closes H1).
- Edit existing SQL migrations — Phases 4.3/5.1 add new `2026-06-11_*` files only.
