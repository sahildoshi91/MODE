# MODE Dead Code Candidates

**Status:** Phase 1 documentation-only audit deliverable. **No candidate on this list is
authorized for deletion or movement by this document.** Every removal requires its own
reviewed Phase 2 PR with tests and rollback notes.

**Baseline:** branch `docs/phase1-architecture-audit` from `origin/main` at
`7ed7afa93322dedbf3bc2b2f15b5804e09ade949`.
All `rg` evidence below was re-run first-hand on this baseline (not inherited from prior
audits).

**Confidence scale (fixed):**
- **High** — no references found via `rg`; not imported; not registered in any router, test,
  script, deployment config, or entrypoint.
- **Medium** — no active references found, but dynamic import, reflection, string routing,
  or config-driven usage could hide references (includes: referenced only by its own tests
  or by other candidates on this list).
- **Low** — ambiguous, feature-flagged, environment-conditional, or referenced only in
  docs/comments.

**Policy exclusions:** `backend/sql/*.sql` (all 89 files) are **migration history, never
dead-code candidates**, regardless of whether any current code references them.

---

## 1. Orphaned frontend screens

| # | Path | Classification | Confidence | Evidence | Removal risk | Recommended next action |
|---|---|---|---|---|---|---|
| 1 | `src/features/onboarding/screens/WelcomeScreen.js` | Superseded screen (auth/onboarding island) | High | `rg -l "\bWelcomeScreen\b"` outside the file itself: 0 non-test, 0 test refs | Low — unreachable from `App.js` | Separate Phase 2 removal PR (bundle with #2–3) |
| 2 | `src/features/onboarding/screens/CoachTabGuardScreen.js` | Superseded screen | High | 0 non-test importers, 0 test refs | Low | Separate Phase 2 removal PR |
| 3 | `src/features/profile/screens/DeleteAccountScreen.js` | Superseded screen — deletion now inline in `AccountSettingsScreen.js` | High | 0 non-test importers, 0 test refs | Low — but account deletion is a high-risk surface; reviewer must confirm the inline path is the only one | Separate Phase 2 removal PR with `mode-review` second pass |
| 4 | `src/features/auth/screens/Login.js` | Superseded thin wrapper (renders `AuthChoiceScreen`) | Medium | 0 non-test importers; 4 refs are its own co-located test files, removable with it | Low | Phase 2 PR removing screen + its tests together |
| 5 | `src/features/onboarding/screens/AuthChoiceScreen.js` | Superseded screen — only importers are candidates #1 and #4 (an orphan island) | Medium | Non-test importers: `WelcomeScreen.js`, `Login.js` (both on this list); 1 test ref | Low — must be removed together with #1/#4 or after them | Phase 2 PR removing the island as one unit |
| 6 | `src/features/onboarding/screens/ClientOnboardingFlowScreen.js` | Superseded multi-step flow — live path is `ClientOnboardingBridge` in `src/app/App.js` | Medium | 0 non-test importers; 4 refs are its own tests | Medium — onboarding is high-risk; confirm no planned revival before deleting | Founder decision, then Phase 2 PR |
| 7 | `src/features/trainerAssignment/screens/TrainerAssignmentScreen.js` | Superseded screen (only the sibling service `trainerAssignmentApi.js` is live) | Medium | 0 non-test importers; 1 test ref (own test) | Low — service must remain | Phase 2 PR removing screen + own test only |
| 8 | `src/features/trainerCoach/screens/TrainerCoachScreen.js` | Superseded screen (only the sibling service `trainerCoachApi.js` is live, used by `TrainerSystemScreen.js`) | Medium | 0 non-test importers; 1 test ref (own test) | Low — service must remain | Phase 2 PR removing screen + own test only |
| 9 | `src/features/onboarding/screens/TrainerStubScreen.js` | Superseded screen — replaced by `TrainerOnboardingScreen` | Low (per fixed scale: referenced only in a comment) | 0 importers, 0 tests; sole reference is the comment at `src/features/trainerOnboarding/screens/TrainerOnboardingScreen.js:4` ("Replaces TrainerStubScreen…") | Low | Phase 2 PR; update the comment in the same PR |

## 2. Dead `lib/components` exports

| # | Path | Classification | Confidence | Evidence | Removal risk | Recommended next action |
|---|---|---|---|---|---|---|
| 10 | `lib/components/premium/PremiumTabBar.js` | Abandoned second bottom-tab-bar (live one: `src/features/navigation/components/LiquidBottomNav.js`) | High | `rg -l "\bPremiumTabBar\b"` outside `lib/components/`: 0 | Low — but its existence invites accidental re-wiring | Phase 2 removal PR (incl. its `premium/index.js` barrel exports) |
| 11 | `lib/components/ModeChip.js:28-38` (`LegacyStaticChip`/`ModeChipLegacy`) | Dead legacy variant inside a live file | High | 0 refs outside the defining file; not barrel-exported | Low — edit within a live file; keep `ModeChip`/`PremiumChip` path intact | Phase 2 PR trimming the dead export only |
| 12 | `lib/components/glass/` dead exports: `GlassRow`, `AtmosphereBackground`, `EmptyStateGlassPanel`, `GlassButtonPrimary`, `GlassButtonSecondary` | Dead component exports | High | `rg -l "\b<Name>\b"` outside `lib/components/`: 0 for each | Low | One Phase 2 PR for the glass family |
| 13 | `lib/components/glass/` `MacroBar` | Dead in production; mocked in tests | Medium | 0 production refs; 2 refs are test mocks in `src/features/dailyCheckin/screens/__tests__/` (loadingStates, trainingFlow) | Low — remove mocks in same PR | Phase 2 PR: component + test-mock cleanup together |
| 14 | `lib/components/` barrel dead exports: `ModeListItem`, `StreakRing`, `SystemCountBadge` | Dead component exports (barrel-exported, zero consumers) | High | `rg -l` outside `lib/components/`: 0 for each | Low | Phase 2 PR incl. `lib/components/index.js` cleanup |
| 15 | `lib/components/premium/` `PremiumGlassCard`, `PremiumButton` | Dead component exports | High | 0 refs outside `lib/components/` | Low | Bundle with #10 |

## 3. Theme system

| # | Path | Classification | Confidence | Evidence | Removal risk | Recommended next action |
|---|---|---|---|---|---|---|
| 16 | `lib/theme/ThemeProvider.js` — `ThemeProvider` component + `useTheme` hook | Unmounted React context (the sibling `resolveThemeV2` **is** live via `AlgorithmHomeScreen.js`) | Medium | `rg -ln "ThemeProvider\|useTheme" src/ App.js --glob '!**/__tests__/**'` → 0; consumers are 2 test files + the `lib/theme.js` re-export; untouched since its introducing commit `5751e7c4` | Medium — `MODE_PRODUCT_PRINCIPLES.md:104` explicitly sanctions `ThemeProvider`/`useTheme` as an approved v2 consumption path, so this is likely intended future API, not leftover | **Founder decision first**; do not remove as routine cleanup — likely keep until the v2 migration either adopts or abandons context-based consumption |
| 17 | `lib/theme/tokens.js` — `surfaces.surface3Overlay` | Dev-only token, unreachable in production builds | Low (environment-conditional by design) | Reached only via the `__DEV__` elevation toggle in `AlgorithmHomeScreen.js`; token file self-documents "NOT canonical, `__DEV__` only" | Low | Already tracked as pending cleanup in the Theme V2 pilot; fold into that PR |

## 4. Config / frontend logic

| # | Path | Classification | Confidence | Evidence | Removal risk | Recommended next action |
|---|---|---|---|---|---|---|
| 18 | `src/config/featureFlags.js:15` `SHOW_DEV_CONNECTION_DEBUG` + gated block at `src/features/dailyCheckin/screens/DailyCheckinScreen.js:2585` | Unreachable-by-value code: flag is hardcoded `false` (the only non-env flag), so `__DEV__ && SHOW_DEV_CONNECTION_DEBUG` is permanently false | Low (flag-conditional; trivially revivable by editing the constant) | `rg -n "SHOW_DEV_CONNECTION_DEBUG"`: definition, one import/use pair, 2 test-mock refs | Low | Founder choice: make it env-driven like the other 12 flags, or remove flag + debug UI block in a Phase 2 PR |

## 5. Backend

| # | Path | Classification | Confidence | Evidence | Removal risk | Recommended next action |
|---|---|---|---|---|---|---|
| 19 | `backend/app/main.py:50` — root-prefix `/workouts` mount of the workouts router | Duplicate route mount (canonical surface: `/api/v1/workouts` via `backend/app/api/v1/__init__.py:39`) | Low (behavioral/config; a deployed client or external caller could depend on it) | No frontend reference to the root prefix: `rg "'/workouts\|\"/workouts" src/ lib/ App.js` → none | Medium — removing a live URL surface; needs runtime/log confirmation that nothing calls it, plus a route-surface test asserting the change | Phase 2: add coverage in `backend/tests/test_trainer_route_surface_contract.py` style, confirm via staging logs, then remove in a reviewed PR |

## 6. Investigated and cleared (NOT dead — listed to prevent misclassification)

| Path | Why it stays |
|---|---|
| `backend/sql/*.sql` (89 files) | Migration history — excluded by policy, never dead code |
| `backend/app/modules/motivation.py` | Imported by 6 services incl. `conversation/service.py`, `profile/service.py`, `daily_checkins/service.py` (`rg -l "modules\.motivation"`) |
| `backend/app/modules/checkin_signals.py` | Imported by `trainer_clients/service.py`, `trainer_home/service.py` + tests |
| `backend/app/api/v1/trainer_auth.py` | Not a router but live — auth dependencies used by ~15 routers |
| `lib/components/premium/PremiumClientCard.js` | **Live** — used in `src/features/trainerClients/screens/TrainerClientsScreen.js:1131`. This corrects the earlier UI/UX audit (local `main` `02402ebd`), which listed it as having no direct `src/` import |
| `TRAINER_TABS_LEGACY` / legacy trainer nav branch (`src/app/App.js`, `LiquidBottomNav.js`) | Flag-off branch of `TRAINER_ROUTE_FOUNDATION_ENABLED` (default on) — live, reachable code |
| Theme V2 files (`lib/theme/tokens.js`, `modes.js`, `resolveThemeV2`) | Flag-gated active pilot (`THEME_V2_ENABLED`), consumed by `AlgorithmHomeScreen.js` |
| All 13 frontend feature flags except #18 | Each has ≥1 external usage |
| All `src/services/*` and `src/features/*/services/*` files | Each has ≥1 non-test importer |
