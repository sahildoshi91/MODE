# Redis Drift Post-Merge Validation Attempt - 2026-05-26

Environment: local workspace plus public Render staging endpoint.

Original caveat: this workspace did not satisfy the post-merge precondition during the first validation attempt. `docs/launch/LAUNCH_COMMAND_CENTER.md` was not tracked by `git ls-files` at that point, and the Redis remediation files were still local modifications. Current repo tracking now includes the command center file and this queue lag remediation record.

Queue lag remediation status update: repo tracking now includes the hardened `backend/sql/20260516a_worker_queue_lag_view.sql`, but public Render staging is still serving old build `efa167c2c05139c3a1da43b5ae0793f848ede1b5` from branch `pr6-ai-chat-memory-scaling` instead of `origin/main` `0dc04119b39a0f597adec8127ad82cd2f9514071`. Current staging `/healthz` is degraded with `checks.queue_lag.error_category="APIError"`. Do not reapply SQL or run full launch verification until `mode-backend-staging` is deployed from current `main`.

## Commands And Results

1. `git ls-files docs/launch/LAUNCH_COMMAND_CENTER.md`
   - Result: no output. The command center file was not tracked in this workspace.
   - Remediation result: current repo tracking includes `docs/launch/LAUNCH_COMMAND_CENTER.md`.

2. `rg -n "RATE_LIMIT_BACKEND:\s*postgres|RATE_LIMIT_BACKEND=postgres" .github/workflows`
   - Result: no matches in the current working tree.

3. `npm run release:security -- --only environment --env-file .env.release`
   - Result: `NO-GO -- BLOCKED`.
   - Evidence artifact: `security_artifacts/release/2026-05-26-042649/summary.json`.
   - Key finding: `REDIS_URL` was missing, and local `.env.release` also contained non-release placeholder values.

4. `/usr/bin/env -i ... RATE_LIMIT_BACKEND=redis ... python3 scripts/release_security_runner.py --only environment`
   - Result: `NO-GO -- BLOCKED`.
   - Evidence artifact: `security_artifacts/release/2026-05-26-042704/summary.json`.
   - Key finding: controlled release-mode env failed clearly on missing `REDIS_URL`.

5. `curl -sS https://mode-backend-staging.onrender.com/healthz`
   - Initial result: staging `/healthz` returned degraded.
   - First probe showed dependency timeouts for DB, Redis, and queue Redis.
   - Current result after repo hardening reached `origin/main`: staging `/healthz` remains degraded because Render is serving build `efa167c2c05139c3a1da43b5ae0793f848ede1b5` from `pr6-ai-chat-memory-scaling`, not `origin/main` `0dc04119b39a0f597adec8127ad82cd2f9514071`.
   - Current health fields: `db="ok"`, `redis="ok"`, `queue_redis="ok"`, `checks.queue_lag.status="degraded"`, `checks.queue_lag.error_category="APIError"`.
   - SQL was not reapplied during this check; deploy current `main` first, then recheck health, and only then reapply SQL if `queue_lag` is still degraded.
   - Supabase Advisor was not rechecked during this pass because the active staging build is stale.

6. `npm run launch:verify -- --base-url https://mode-backend-staging.onrender.com --timeout-seconds 30 --skip-db-security --skip-chat-smoke`
   - Initial result: `NO-GO`.
   - Redis and queue Redis reported `ok` during verifier probes, but `/healthz` was degraded because queue lag visibility returned `APIError`.
   - Current policy: do not rerun full launch verification until staging is deployed from current `main`, `/healthz` is green, and Supabase Advisor has been checked.
   - Runtime route surface passed.
   - Static security tests passed.
   - DB security, authenticated chat smoke, storage smoke, account deletion smoke, and chat load were skipped.

## Evidence Summary

- Current workflow config has no `RATE_LIMIT_BACKEND: postgres` matches.
- Release-mode validation now fails closed when `REDIS_URL` is missing.
- Staging repo config expects `RATE_LIMIT_BACKEND=redis`, but public Render staging is still on old build `efa167c2c05139c3a1da43b5ae0793f848ede1b5`.
- Queue lag visibility is fixed repo-side by `backend/sql/20260516a_worker_queue_lag_view.sql`; live staging still needs current-main deploy validation.
- Lightweight launch verification from earlier skipped-gate runs is stale until staging deploys current `main` and `/healthz` is green.
- No launch GO evidence was produced.

## Remaining Blockers

- Deploy `origin/main` `0dc04119b39a0f597adec8127ad82cd2f9514071` to Render `mode-backend-staging`; current active build is `efa167c2c05139c3a1da43b5ae0793f848ede1b5`.
- After deploy, rerun staging `/healthz`; if `checks.queue_lag` is still degraded, apply `backend/sql/20260516a_worker_queue_lag_view.sql` to Supabase `mode-staging`.
- Check Supabase Advisor after deploy/SQL validation; the `SECURITY DEFINER` warning for `public.worker_queue_lag` must clear or be recorded as still present.
- GitHub release secret `REDIS_URL` still needs confirmation without printing the value.
- Release-mode security gates must pass with a real release environment.
- Render staging must be rerun with full launch verification, including DB security, authenticated chat, storage, account deletion, rate-limit, and load gates.
- Full launch remains `NO-GO` until the skipped launch gates are run and pass.

## Recommendation

NO-GO. Repo-side Redis/security hardening is on `origin/main`, but Render staging is still serving stale build `efa167c2c05139c3a1da43b5ae0793f848ede1b5` and `/healthz` remains degraded through `checks.queue_lag.error_category="APIError"`. Deploy current `main` before reapplying SQL or running full launch verification.
