# MODE App Store Launch Plan

Planning date: 2026-05-25

## Current State Summary
- MODE is an Expo/React Native mobile app with a native iOS project and FastAPI backend.
- Mobile chat routes through MODE backend APIs; backend provider clients are centralized under `backend/app/ai/client.py`.
- Existing iOS artifacts are not release-ready: unsigned IPA, local/LAN API base risk, stale Expo metadata risk, and incomplete signing/export path.
- Release/security, compliance copy, backend kill switches, and DB/RLS migration planning are the current launch blockers before iOS signing work.

## v1 Launch Scope
- Single polished AI personal trainer experience backed by multi-tenant-native data structures.
- Supabase auth, client onboarding, coach chat/streaming, profile/settings, account deletion request initiation, and release security checks.
- Free beta/free tier. No App Store payments or IAP for this slice.

## Explicitly Deferred Scope
- Marketplace, trainer dashboard expansion, complex monetization, and final App Store signing identity.
- Live DB/RLS migrations from `docs/launch`.
- Destructive account deletion behavior beyond the existing request/enqueue mechanism.
- Medical, rehab, diagnosis, supplement, eating-disorder, or extreme transformation claims.

## Technical Workstreams
- Launch docs: maintain this plan, risk register, TestFlight checklist, Apple human task list, and DB/RLS migration plan.
- Security/release tooling: redact secret scans, inspect IPA artifacts including large bundles, and keep env examples placeholder-only.
- Mobile compliance UX: async deletion wording, legal/support links, and lightweight AI fitness disclaimer.
- Backend controls: chat/streaming/provider/memory kill switches, configurable provider timeout, token cap, and rate limits.
- DB/RLS planning: document chat event/RLS drift and tenant-pair guardrail migrations without applying SQL.
- QA: run focused lint, tests, backend checks, scanner help, and iOS hardening lint.

## Acceptance Criteria
- No provider or Supabase service-role secrets are added to client/mobile code or repo-tracked env files.
- Mobile AI/chat traffic continues to call MODE backend APIs only.
- Chat, streaming, provider calls, memory writes, provider timeout, max output tokens, and chat rate limits are configurable.
- Account deletion copy says the request is submitted/processing, not immediately complete.
- Privacy Policy, Terms, Support, and AI fitness safety copy are visible in appropriate mobile surfaces.
- DB/RLS work is documented as planning-only and clearly requires human approval before application.

## Verification Commands
Run these before marking Slice 1 complete:

```bash
npm run lint
npm test
cd backend && ./venv/bin/pytest -q
npm run backend:check
npm run codex:check
python3 scripts/ios_hardening_lint.py --require-prebuild
python3 scripts/ios_artifact_scan.py --help
npm run release:security -- --help
```

## Risks Requiring Human Approval
- DB/RLS migrations or policy changes.
- Destructive account deletion processing changes.
- Final bundle identifier, Apple Team ID, signing, and export lane.
- Production Privacy Policy, Terms, Support URLs, App Privacy labels, age rating, and reviewer demo credentials.
