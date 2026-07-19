# MODE Target Repository Structure

**Status:** Phase 1 documentation-only audit deliverable. The "target" below codifies the
repository's *existing intended* layering so future changes land consistently — it is not a
redesign proposal. **Nothing here authorizes moving or deleting anything**; every backlog
item requires its own reviewed Phase 2 PR.

**Baseline:** branch `docs/phase1-architecture-audit` from `origin/main` at
`7ed7afa93322dedbf3bc2b2f15b5804e09ade949`. Companions:
`CURRENT_REPOSITORY_MAP.md`, `REPOSITORY_AUDIT.md`, `DEAD_CODE_CANDIDATES.md`.

---

## 1. Current vs. Target Structure

The current structure is already close to its own stated conventions. Target = current
structure with the deviations resolved. Deviations are marked ⚠ and cross-referenced.

```
Current (top level)                      Target (same, deviations resolved)
├── App.js                               unchanged (thin re-export of src/app/App.js)
├── src/
│   ├── app/App.js                       unchanged location; long-term: the root state
│   │                                    machine is the single riskiest frontend file
│   │                                    (REPOSITORY_AUDIT.md §2) — future decomposition
│   │                                    is a redesign decision, out of Phase-1 scope
│   ├── config/                          unchanged (flags stay centralized here)
│   ├── services/                        unchanged (shared HTTP/Supabase infra only)
│   └── features/<feature>/
│       ├── screens/  components/        unchanged
│       ├── services/ hooks/ utils/      unchanged
│       └── __tests__/ (co-located)      unchanged
│       ⚠ 9 orphaned screens             removed via DEAD_CODE_CANDIDATES.md #1–9
├── lib/
│   ├── theme.js + theme/                unchanged (governed by MODE_PRODUCT_PRINCIPLES.md;
│   │                                    never add lib/theme/index.js)
│   └── components/ (+glass/ +premium/)  ⚠ dead exports removed (candidates #10–15)
├── backend/
│   ├── main.py                          unchanged
│   ├── app/
│   │   ├── main.py                      ⚠ root /workouts mount resolved (candidate #19)
│   │   ├── api/v1/                      routers only
│   │   │   ⚠ trainer_auth.py            conceptually belongs beside app/core auth code
│   │   │                                (AUDIT §1.6) — reviewed move, low urgency
│   │   ├── core/                        cross-cutting infra (auth, tenancy, rate limit,
│   │   │                                config, guards) — unchanged
│   │   ├── db/                          Supabase client + postgrest — unchanged
│   │   ├── ai/                          provider clients/routing/prompts — unchanged
│   │   ├── modules/<domain>/            router-facing service.py + repository.py +
│   │   │                                schemas.py per domain
│   │   │   ⚠ checkin_signals.py,        candidates for foldering into packaged modules
│   │   │     motivation.py              (AUDIT §1.4) — cosmetic, needs import updates
│   │   ├── workers/                     unchanged
│   │   └── security/                    unchanged
│   ├── prompts/                         versioned prompt contracts — unchanged
│   ├── sql/                             append-only migration history — unchanged
│   ├── scripts/                         ops/preflight scripts — unchanged
│   └── tests/                           unchanged
├── docs/
│   ├── architecture/                    (new, this audit) repo-wide ground truth
│   ├── design/ trainer-platform/ …      unchanged; trust tiers in AUDIT §4
├── scripts/                             repo-level CI/release tooling — unchanged
└── render.yaml, eas.json, app.json,     unchanged
    .github/workflows/
```

## 2. Where-Changes-Go Matrix

| Change type | Where it goes | Convention source / example |
|---|---|---|
| New backend endpoint | Router in `backend/app/api/v1/<area>.py`, registered in `backend/app/api/v1/__init__.py`; logic in `backend/app/modules/<domain>/service.py`; DB access in `repository.py`; request/response shapes in `schemas.py` (Pydantic) | `CLAUDE.md` conventions; e.g. `progress.py` → `modules/progress/` |
| New backend env var | Field on `Settings` in `backend/app/core/config.py`; add the name to all three env templates if user-facing | `CLAUDE.md`; `test_release_env_templates_static.py` guards templates |
| New schema change | **New** date-prefixed file in `backend/sql/` (`YYYYMMDD[letter]_description.sql`); never edit an existing migration | `MODE_AGENT_RULES.md`; latest example `20260703a_*.sql` |
| New background job | Handler in `backend/app/modules/intelligence_jobs/handlers.py`, consumed by `backend/app/workers/intelligence_worker.py` | Existing job handlers |
| New frontend screen | `src/features/<feature>/screens/`; wired from `src/app/App.js` (root gate/tab) or the owning feature shell's local route state; **remove the superseded screen in the same PR** (anti-pattern documented in AUDIT §3.4) | Existing features; UI/UX audit §4 |
| New frontend API call | Feature service file in `src/features/<feature>/services/` using `fetchWithApiFallback` from `src/services/apiRequest.js` | `CLAUDE.md`; e.g. `progressApi.js` |
| New feature flag | `src/config/featureFlags.js`, env-driven via `EXPO_PUBLIC_*` (never hardcoded — see candidate #18) | 12 of 13 existing flags |
| New shared UI primitive | `lib/components/` (+ barrel export) — check `lib/components/index.js` for an existing primitive first; 20+ dead/duplicate components already exist there | AUDIT §3.4; candidates #10–15 |
| Theme/token change | Legacy: `lib/theme.js`. V2: `lib/theme/*` only behind `THEME_V2_ENABLED`, founder sign-off required, never add `lib/theme/index.js` | `MODE_PRODUCT_PRINCIPLES.md`; `lib/theme.js:596-604` fence comment |
| New backend test | `backend/tests/test_<area>_*.py`; static-analysis tests for scripts/config follow `test_*_static.py` naming | Existing clusters (MAP §11) |
| New frontend test | Co-located `__tests__/` beside the code under test | `jest.config.js` (`roots: src/`) |
| New prompt change | New version file under `backend/prompts/<kind>/` — prompt files are safety contracts requiring second-agent review | `CLAUDE.md` high-risk list |
| Ops/release script | `scripts/` (repo-level) or `backend/scripts/` (backend/DB); anything touching live data must be flagged as such in its docstring | Script inventory in MAP/AUDIT |
| Deployment change | `render.yaml` (staging services), `eas.json` (mobile build profiles), `.github/workflows/` (gates) — all are release-gate surfaces requiring second-agent review | `MODE_AGENT_RULES.md` |

## 3. Ownership Matrix

Source: `git log --format='%an' -- <path> | sort | uniq -c` (full history at baseline).
No `CODEOWNERS` file exists.

| Area | Commits | Author signal | Practical owner |
|---|---|---|---|
| `backend/` | 145 | Doshi (sole author) | Founder (human final authority per `MODE_AGENT_RULES.md`) |
| `src/` | 98 | Doshi (sole author) | Founder |
| `docs/` | 36 | Doshi (sole author) | Founder |
| `lib/` | 26 | Doshi (sole author) | Founder |
| `scripts/` | 14 | Doshi (sole author) | Founder |
| `.github/` | 11 | Doshi (sole author) | Founder |

The repository is single-maintainer; commit history cannot distinguish per-area ownership.
Working authority model (from `MODE_AGENT_RULES.md`): Codex = primary implementer,
Claude Code = second-pass reviewer/architect, human founder = final approval. There is no
area where ownership is contested; equally, there is no second reviewer of record beyond
the agent workflow.

## 4. Prioritized Cleanup Backlog (each item = its own Phase 2 PR; none authorized here)

Ordered by (risk reduction ÷ effort), highest first:

1. **Remove the dead second tab bar and dead `lib/components` exports**
   (candidates #10–15). Highest confusion-per-line; zero runtime risk; prevents accidental
   re-wiring of `PremiumTabBar`.
2. **Remove the orphaned-screen island and singleton orphans**
   (candidates #1–5, #7–9). Real navigation debris; low risk; `DeleteAccountScreen` (#3)
   needs a `mode-review` second pass because deletion is a high-risk surface.
3. **Decide `ClientOnboardingFlowScreen`** (#6) — founder call on whether the multi-step
   flow returns before deleting.
4. **Make `SHOW_DEV_CONNECTION_DEBUG` env-driven or remove it** (#18) — one-line
   consistency fix or a small deletion.
5. **Resolve the root `/workouts` double mount** (#19) — needs staging-log confirmation
   and a route-surface test first (AUDIT §6.6); the only backlog item with runtime risk.
6. **Add route-level justification or refactor for the four service-layer-bypassing
   routers** (AUDIT §1.2) — documentation-or-refactor decision per router; three are
   high-risk surfaces.
7. **Theme V2 pilot cleanup per its own plan** — dev elevation toggle + `surface3Overlay`
   (#17) and the unmounted `ThemeProvider`/`useTheme` (#16); governed by
   `MODE_PRODUCT_PRINCIPLES.md`, founder decision required.
8. **Cosmetic backend structure** — fold `checkin_signals.py`/`motivation.py` into packaged
   modules; relocate `trainer_auth.py` out of the router directory (AUDIT §1.4, §1.6).
   Import-churn only; batch with other backend work.
9. **De-drift `README.md`** — replace the hand-maintained "Active Structure" and "Current
   API Surface" sections with pointers to `docs/architecture/CURRENT_REPOSITORY_MAP.md`
   and the router registry (AUDIT §3.6).
