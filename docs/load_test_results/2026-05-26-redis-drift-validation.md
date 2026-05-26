# Redis Drift Post-Merge Validation Attempt - 2026-05-26

Environment: local workspace plus public Render staging endpoint.

Original caveat: this workspace did not satisfy the post-merge precondition during the first validation attempt. `docs/launch/LAUNCH_COMMAND_CENTER.md` was not tracked by `git ls-files` at that point, and the Redis remediation files were still local modifications. Current repo tracking now includes the command center file and this queue lag remediation record.

Queue lag remediation update: staging `/healthz` is now green after manually applying `backend/sql/20260516a_worker_queue_lag_view.sql` in Supabase staging. The queue lag visibility failure is fixed in staging, and repo tracking now needs to carry that SQL forward so the fix is not tribal/manual-only.

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
   - Remediation result: after the manual Supabase staging apply of `backend/sql/20260516a_worker_queue_lag_view.sql`, staging `/healthz` is green.

6. `npm run launch:verify -- --base-url https://mode-backend-staging.onrender.com --timeout-seconds 30 --skip-db-security --skip-chat-smoke`
   - Initial result: `NO-GO`.
   - Redis and queue Redis reported `ok` during verifier probes, but `/healthz` was degraded because queue lag visibility returned `APIError`.
   - Remediation result: lightweight launch verification now returns `PASS` for the run shape with skipped launch gates.
   - Runtime route surface passed.
   - Static security tests passed.
   - DB security, authenticated chat smoke, storage smoke, account deletion smoke, and chat load were skipped.

## Evidence Summary

- Current workflow config has no `RATE_LIMIT_BACKEND: postgres` matches.
- Release-mode validation now fails closed when `REDIS_URL` is missing.
- Staging repo config expects `RATE_LIMIT_BACKEND=redis`; public staging health is now green after the queue lag view remediation.
- Queue lag visibility is fixed in staging by `backend/sql/20260516a_worker_queue_lag_view.sql`.
- Lightweight launch verification is `PASS` only for the skipped-gate run shape.
- No launch GO evidence was produced.

## Remaining Blockers

- Queue lag remediation tracking must be merged so future staging applies include the SQL and PostgREST schema reload.
- GitHub release secret `REDIS_URL` still needs confirmation without printing the value.
- Release-mode security gates must pass with a real release environment.
- Render staging must be rerun with full launch verification, including DB security, authenticated chat, storage, account deletion, rate-limit, and load gates.
- Full launch remains `NO-GO` until the skipped launch gates are run and pass.

## Recommendation

NO-GO. The Redis-only remediation behavior is moving in the right direction, staging `/healthz` is green, and queue lag visibility is fixed, but launch remains blocked pending release-mode rerun and full staging launch evidence with no skipped gates.
