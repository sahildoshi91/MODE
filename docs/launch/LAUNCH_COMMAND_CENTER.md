# MODE Launch Command Center

## Last Updated

2026-05-26 queue lag remediation tracking

Source posture: repo docs/configs/artifacts only. Local secret/env values were not inspected.

Status markers: `BLOCKED`, `REMEDIATION PR PENDING`, `AT RISK`, `UNKNOWN`, `READY`, `DONE`, `DEFERRED`.

## Executive Snapshot

| Area | Status | Owner | Founder read |
| --- | --- | --- | --- |
| Overall launch | `BLOCKED` | Founder | Launch remains blocked; queue lag visibility and staging `/healthz` are fixed, but full release/staging gates have not passed. |
| Config drift | `REMEDIATION PR PENDING` | Backend/DevOps + Security | Current working tree has no workflow `RATE_LIMIT_BACKEND=postgres` pins, but this workspace is not a clean post-merge state and release/staging reruns remain required. |
| Staging validation | `BLOCKED` | Backend/QA/DevOps | Staging `/healthz` is now green after manually applying the queue lag view SQL; lightweight verification passes with skipped gates, but full live gates still need to run. |
| Production deployment | `UNKNOWN` | Backend/DevOps | No production API host, production worker, or production release-gate pass is evidenced in repo docs. |
| iOS/TestFlight | `BLOCKED` | Mobile release + App Store owner | Bundle ID is still `com.anonymous.mode`; no signed/exported release path is evidenced. |
| Apple/legal ops | `BLOCKED` | Founder + Legal/App Store owners | Apple human tasks and production legal/support URLs remain open in launch docs. |

Next operational action: merge the queue lag SQL tracking and Redis remediation, configure/confirm required GitHub and Render env values without printing secrets, then rerun release and full staging gates with no skipped launch gates.

## Immediate Founder Priorities (Next 72 Hours)

1. Merge the Redis-only `RATE_LIMIT_BACKEND` remediation and rerun release/staging gates.
2. Finalize Apple org, bundle ID, and signing authority.
3. Produce first signed TestFlight-capable IPA.
4. Execute and archive staging launch verification evidence.
5. Finalize legal, support, and public URLs.
6. Assign launch monitoring and rollback ownership.

## P0 Launch Blockers

| Blocker | Status | Owner | Evidence |
| --- | --- | --- | --- |
| `RATE_LIMIT_BACKEND` conflict between release workflows and production assumptions | `REMEDIATION PR PENDING` | Backend/DevOps + Security | Current working tree has no workflow `postgres` pin and fails closed when `REDIS_URL` is missing; post-merge tracking and release/staging reruns remain required |
| Final bundle ID, Apple Team, signing/export path, and signed IPA | `BLOCKED` | Founder/App Store owner + Mobile release owner | `app.json`, `ios/MODE.xcodeproj/project.pbxproj`, `docs/launch/APPLE_HUMAN_TASKS.md`, `docs/launch/TESTFLIGHT_CHECKLIST.md` |
| Tenant isolation/RLS runtime evidence | `BLOCKED` | DB owner | `docs/launch/LAUNCH_RISK_REGISTER.md` LSR-006; launch checklist still requires mixed-tenant RLS and staging DB security proof |
| Staging launch gate evidence | `BLOCKED` | Backend/QA/DevOps | Staging health and queue lag visibility are remediated, but DB security, auth chat, storage, account deletion, rate-limit/load, and rollback evidence still need full no-skip verification |
| Production release security evidence | `UNKNOWN` | Security/DevOps | Latest recorded release-mode artifacts show environment gate failures; local-mode passes are not production release evidence |
| App Store/legal readiness | `BLOCKED` | Founder + Legal/App Store owners | Privacy Policy, Terms, Support, App Privacy labels, age rating, reviewer notes, screenshots, demo path, and tester plans are open |

## Deployment Status

| Target | Status | Owner | Notes |
| --- | --- | --- | --- |
| Staging backend web | `AT RISK` | Backend/DevOps | `render.yaml` defines `mode-backend-staging`; staging `/healthz` is now green after the manual queue lag view apply, but full no-skip verification remains open. |
| Staging intelligence worker | `UNKNOWN` | Backend/DevOps | `render.yaml` defines `mode-intelligence-worker-staging`; restart durability and queue lag evidence are open. |
| Staging routing config in repo | `READY` | Backend | Repo config uses `CHAT_STAGING_OPENAI_ONLY=false`, `USE_FAKE_PROVIDER=false`; deployed runtime still needs verification. |
| Production backend API | `UNKNOWN` | Backend/DevOps | No production API origin found in launch docs. |
| Production worker | `UNKNOWN` | Backend/DevOps | No production worker deployment evidence found. |
| Mobile release artifact | `BLOCKED` | Mobile release owner | Current documented state: unsigned/unshippable IPA risk and incomplete signing/export path. |
| App Store Connect/TestFlight | `BLOCKED` | App Store owner | App record, team, tester plan, reviewer metadata, and credentials remain open. |

## Infra Status

| Capability | Status | Owner | Notes |
| --- | --- | --- | --- |
| Redis/RQ worker architecture | `DONE` | Backend | Worker queue, job tables, worker entrypoint, and Render worker definition exist. |
| Production Redis/rate-limit posture | `REMEDIATION PR PENDING` | Backend/DevOps + Security | Controlled release-mode env fails clearly when `REDIS_URL` is missing; real GitHub secret and release-mode pass evidence remain unknown. |
| Launch migrations helper | `READY` | DB/Backend | Helper tracks the queue lag view SQL after chat bootstrap context; do not apply migrations without explicit human DB approval. |
| Service-role retirement staging apply | `UNKNOWN` | DB owner | Listed as required evidence; not recorded complete. |
| Storage signed URL exception | `AT RISK` | Backend/Security | Exception is documented; staging storage smoke still required. |
| `/healthz` launch SLO | `AT RISK` | Backend/DevOps | Staging `/healthz` is green after queue lag remediation; p95/SLO evidence from full verification remains open. |
| Worker restart durability | `UNKNOWN` | Backend/QA | Required by launch checklist; no pass evidence found. |
| Queue lag under burst | `UNKNOWN` | Backend/QA | Queue lag visibility is fixed in staging; required p95 < 30s under burst still lacks dated full-gate evidence. |
| Observability metrics | `DONE` | Backend | Structured metrics/log contracts exist. Dashboards/alerts owner remains `UNKNOWN`. |

## GO / NO-GO Criteria

Launch is `NO-GO` if any are true:

- Redis-only rate-limit remediation is unmerged, or release/staging reruns have not passed after it.
- IPA is unsigned, unexported, or lacks a passing artifact scan.
- Production release security gates fail or are not run in release mode.
- Cross-tenant RLS evidence is missing or failing.
- Staging concurrency/load evidence is missing.
- Production API/runtime verification is missing.
- Rollback owner and launch monitoring owner are unassigned.
- Apple/legal/App Store submission tasks remain open.

Launch becomes `GO` only when all are true:

- Signed TestFlight-capable IPA is validated.
- Release security gates pass in release mode.
- Staging verification evidence is archived with dated artifacts.
- App Store assets, legal URLs, reviewer notes, and demo path are complete.
- Production runtime, production API origin, and production Supabase project are verified.
- Rollback path is tested and launch watch ownership is assigned.

## Launch Checklist

| Gate | Status | Last verified evidence | Expected artifact | Owner |
| --- | --- | --- | --- | --- |
| Reconcile launch-critical config drift: `RATE_LIMIT_BACKEND=postgres` vs `redis` | `REMEDIATION PR PENDING` | Redis-only remediation prepared in repo config | Merged PR plus release-mode and staging verification reruns | Backend/DevOps + Security |
| Record final bundle ID and Apple Team ID | `BLOCKED` | Current repo still uses `com.anonymous.mode` | Founder-approved bundle ID + Apple Team ID record | Founder/App Store owner |
| Produce signed/exported IPA through approved release path | `BLOCKED` | NONE | Signed IPA path and export method record | Mobile release owner |
| Pass IPA artifact scan against release candidate | `UNKNOWN` | NONE for release candidate | Passing `security_artifacts/release/<timestamp>/summary.json` | Mobile release owner |
| Confirm production HTTPS API base and Supabase production project | `UNKNOWN` | NONE | Production API URL, Supabase project ref, `/healthz`, and route preflight evidence | Backend/DevOps |
| Run production release security gates in release mode | `BLOCKED` | 2026-05-26 release-mode environment gates failed, including missing `REDIS_URL` | Release-mode `GO` summary artifact | Security/DevOps |
| Apply approved staging launch migrations | `UNKNOWN` | NONE | DB owner approval plus migration apply log | DB owner |
| Pass staging launch verification without skipped launch gates | `BLOCKED` | 2026-05-26 lightweight verifier PASS with skipped gates after queue lag remediation; full DB/chat/storage/account/load gates were not run | Dated staging verification result with no skipped launch gates | Backend/QA |
| Record 50-concurrent TTFT p95 < 2.5s | `UNKNOWN` | NONE after current launch gate requirements | `docs/load_test_results/YYYY-MM-DD.md` | Backend/QA |
| Record full-stream 10/25/26 concurrency matrix | `UNKNOWN` | NONE | `docs/load_test_results/YYYY-MM-DD.md` | Backend/QA |
| Record queue lag p95 < 30s under burst | `UNKNOWN` | NONE | `docs/load_test_results/YYYY-MM-DD.md` with worker queue lag | Backend/QA |
| Record zero cross-tenant RLS observations | `UNKNOWN` | NONE for current launch gate | Staging DB security/RLS evidence artifact | DB/QA |
| Confirm account deletion enqueue smoke with sacrificial account | `UNKNOWN` | NONE | Staging launch verification log with `202 queued` outcome | Privacy/QA |
| Publish production Privacy Policy, Terms, and Support URLs | `BLOCKED` | Apple human tasks open | Live URL list approved by Legal/Support | Legal/Support |
| Prepare reviewer notes, demo account path, screenshots, age rating, export compliance | `BLOCKED` | Apple human tasks open | App Store Connect submission checklist evidence | App Store owner |
| Assign crash/log monitoring owner and TestFlight watch schedule | `UNKNOWN` | NONE | Launch watch roster with owner, window, and escalation path | Founder/DevOps |
| Complete staging rollback exercise | `UNKNOWN` | NONE | Dated rollback exercise record | Backend/DevOps |

## Open Risks

| Risk | Status | Owner | Source |
| --- | --- | --- | --- |
| Secret exposure risk | `AT RISK` | Security owner | LSR-001 mitigating; release secret scans must pass on final artifact/env. |
| Unsigned/unshippable IPA | `BLOCKED` | Mobile release owner | LSR-002 open. |
| Embedded local/LAN/staging API URL in mobile artifact | `AT RISK` | Mobile release owner | LSR-003 mitigating; final artifact scan not evidenced. |
| Streaming reliability and event/RLS drift | `AT RISK` | Backend/DB owners | LSR-004 mitigating; staging launch evidence incomplete. |
| AI spend/cost controls | `AT RISK` | Backend owner | LSR-005 mitigating; live load/fallback validation open. |
| Tenant isolation | `BLOCKED` | DB owner | LSR-006 open; cross-tenant runtime proof required. |
| Account deletion/privacy | `AT RISK` | Privacy owner | LSR-007 mitigating; policy/legal review and sacrificial smoke open. |
| App Review | `BLOCKED` | App Store owner | LSR-008 mitigating but Apple human tasks are open. |
| Observability ownership | `UNKNOWN` | Backend/DevOps owner | LSR-009 mitigating; dashboard/alert owner not evidenced. |
| Weak network/TestFlight resilience | `UNKNOWN` | QA owner | LSR-010 open. |

## Delegated Tasks

| Task | Status | Owner |
| --- | --- | --- |
| Create `Launch-Critical Config Drift Audit` issue and resolve runtime/gate mismatch | `REMEDIATION PR PENDING` | Backend/DevOps + Security |
| Track `docs/launch/LAUNCH_COMMAND_CENTER.md` in git | `DONE` | Backend/DevOps |
| Approve final Bundle ID, Apple org account, D-U-N-S, Team ID | `BLOCKED` | Founder/App Store owner |
| Create App Store Connect record and TestFlight groups | `BLOCKED` | App Store owner |
| Publish Privacy Policy, Terms, Support URL | `BLOCKED` | Legal/Support |
| Prepare App Privacy labels, age rating, export compliance, reviewer notes | `BLOCKED` | Legal/App Store owner |
| Prepare reviewer demo account or deterministic invite/onboarding path | `UNKNOWN` | QA/App Store owner |
| Approve exact DB/RLS migration diff before any apply | `BLOCKED` | DB owner |
| Run staging launch verification and save dated evidence | `BLOCKED` | Backend/QA |
| Run iOS signing/export and artifact scan | `BLOCKED` | Mobile release owner |
| Assign launch log/crash monitoring watch | `UNKNOWN` | Founder/DevOps |

## Decisions Needed

| Decision | Status | Owner |
| --- | --- | --- |
| Is production rate limiting Redis-only, and should workflows be changed from `postgres` to `redis`? | `REMEDIATION PR PENDING` | Backend/DevOps + Security |
| What is the approved iOS bundle identifier and Apple Team ID? | `BLOCKED` | Founder/App Store owner |
| What production API origin and Supabase project are approved for the release build? | `UNKNOWN` | Backend/DevOps |
| Who can approve and schedule DB/RLS launch migrations? | `UNKNOWN` | DB owner/Founder |
| What exact privacy/terms/support URLs are approved for App Store submission? | `BLOCKED` | Legal/Support |
| What reviewer demo path will Apple receive? | `UNKNOWN` | QA/App Store owner |
| Who owns internal/external TestFlight monitoring and rollback authority? | `UNKNOWN` | Founder |
| Will launch proceed only after dated staging load/RLS evidence is recorded? | `UNKNOWN` | Founder |

## Evidence / Links

This file is repo-evidence based. The next version should be operationally hydrated from Render, Supabase, Apple Connect, TestFlight, monitoring dashboards, and live release artifacts.

Primary launch docs:

- `docs/launch/APP_STORE_LAUNCH_PLAN.md`
- `docs/launch/TESTFLIGHT_CHECKLIST.md`
- `docs/launch/APPLE_HUMAN_TASKS.md`
- `docs/launch/LAUNCH_RISK_REGISTER.md`
- `docs/launch/DB_RLS_MIGRATION_PLAN.md`
- `docs/distributed_intelligence_launch_checklist.md`
- `docs/distributed_intelligence_launch_gate_staging_verification.md`
- `docs/security/release-hardening-gates.md`
- `docs/security/release_env_setup.md`
- `docs/security/release_security_runner.md`
- `docs/load_test_results/README.md`

Repo evidence:

- `render.yaml`: staging web and worker services are defined.
- `app.json` and `ios/MODE.xcodeproj/project.pbxproj`: bundle identifier remains `com.anonymous.mode`.
- `backend/app/core/startup_guards.py` and `backend/security/production_env_schema.json`: production expects Redis-backed rate limiting.
- `.github/workflows/release-security.yml` and `.github/workflows/security-release-gates.yml`: remediation should set `RATE_LIMIT_BACKEND=redis`; release-mode rerun remains required.
- `backend/sql/20260516a_worker_queue_lag_view.sql`: queue lag view remediation now includes PostgREST schema reload tracking.
- `security_artifacts/release/2026-05-25-231127/summary.json`: release-mode environment gate failed.
- `security_artifacts/release/2026-05-25-231128/summary.json`: local-mode environment gate passed with warnings; not production release evidence.
- `docs/load_test_results/2026-05-26-redis-drift-validation.md`: latest Redis drift and queue lag remediation evidence; result remains NO-GO until skipped gates run.
- `security_artifacts/release/2026-05-26-042649/summary.json`: release-mode env-file validation failed.
- `security_artifacts/release/2026-05-26-042704/summary.json`: controlled release-mode env failed clearly on missing `REDIS_URL`.

Stale or conflicting docs:

- `REMEDIATION PR PENDING`: `RATE_LIMIT_BACKEND` repo config is being aligned to Redis, but launch remains blocked until release/staging evidence is regenerated.
- `AT RISK`: `docs/chat_pipeline_deployment_handoff.md` and `docs/chat_slow_response_runbook.md` both describe May 11 staging baselines but report different outcomes. Treat both as historical, not current launch evidence.
- `AT RISK`: `docs/chat_pipeline_final_deliverables.md` says no queue system was introduced; distributed-intelligence docs and `render.yaml` supersede that with an RQ worker architecture.

Deferred/non-launch-critical:

- Marketplace, expanded trainer dashboard, complex monetization/IAP, destructive deletion expansion, semantic caching/vector infra, Kubernetes, autoscaling, and multi-region deployment are `DEFERRED`.
