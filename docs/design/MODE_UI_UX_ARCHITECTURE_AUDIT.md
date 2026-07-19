# MODE UI/UX Architecture Audit

**Status:** Read-only diagnostic. No redesign, remediation, or implementation recommendations
are made in this document — it exists to establish ground truth before any redesign work starts.

**Scope:** Client and trainer app rendering architecture (`App.js` → `src/app/App.js`), the
design/token system (`lib/theme.js`, `lib/theme/*`, `lib/components/*`), and the full
screen/route inventory across `src/features/**`.

**Non-goals:** This document does not propose a navigation library, a design-token migration
plan, or a cleanup order. It classifies what exists today as active, flag-gated, docs-only, or
dead, and diagnoses why the experience is fragmented. Any future redesign should start from this
map rather than from assumptions.

## Phase 0 — Baseline

| Check | Result |
|---|---|
| Branch | `main` |
| Commit | `7ed7afa93322dedbf3bc2b2f15b5804e09ade949` |
| Initial `git status --short` | clean (no output) |
| `scripts/codex_prompt_check.js` | Reviewed in full. Runs backend pytest route-contract tests (`tests/test_trainer_route_surface_contract.py`, `tests/test_chat_sessions_api.py`), probes backend health endpoints, then runs `backend/scripts/preflight_runtime_route_surface.py` against the first reachable backend. No autofix, codegen, prebuild, install, migration, or tracked-file generation — inspection-only, safe to run. |
| `backend:dev` | Confirmed at `package.json:14` → `cd backend && ./venv/bin/python main.py` |
| Navigation library | Confirmed absent — no `react-navigation`/`@react-navigation/*` in `package.json` dependencies (lines 27-56), and zero `NavigationContainer` hits anywhere in `src/`. |

## Executive Summary

- **No navigation library exists anywhere in the app.** All routing — root app state, tab
  selection, and every in-feature sub-route — is hand-rolled `useState`/array-stack view
  switching. There is no shared routing contract between features.
- **The root of the app is a single 2,122-line state machine** (`AppShell` in
  `src/app/App.js:501-2042`) that sequentially early-returns through session loading, auth,
  onboarding, role, and check-in gates before reaching the main tabbed shell.
- **Theme V2 is a single-screen pilot, not an in-progress migration.** Exactly one screen
  (`AlgorithmHomeScreen.js`) consumes it, behind a flag that defaults to **off**
  (`THEME_V2_ENABLED`, default `false`). The legacy `lib/theme.js` object remains the dominant
  styling source for 80 importing files.
- **Trainer navigation has two live modes controlled by one flag that defaults to *on***
  (`TRAINER_ROUTE_FOUNDATION_ENABLED`, default `true`), meaning the "Coach OS" `TrainerRouteHost`
  path is the default-active one and the older per-tab inline trainer rendering is the
  flag-off fallback — both are live code, not one legacy and one current.
- **Nine screen files are fully-built dead code** — never imported by any reachable path,
  spanning auth, onboarding, profile, and trainer-assignment features. This looks like
  accumulated debris from earlier iterations rather than in-progress work.
- **Two competing bottom-tab-bar implementations exist in `lib/components/`** —
  `LiquidBottomNav.js` (live, the only one rendered) and `PremiumTabBar.js` (fully built,
  zero consumers repo-wide).
- **Screen-level styling discipline is generally good** — 85% of a 20-screen sample use
  `StyleSheet.create` with theme tokens and zero hardcoded colors. Two screens
  (`OnboardingLandingScreen.js`, `CoachChatScreen.js`) deviate with hardcoded hex values.
- **Shared loading UI adoption is partial** — 7 screens use the canonical
  `BreathingTransitionOverlay` system; 5 more screens use only raw `ActivityIndicator` with no
  shared-overlay usage at all.

---

## 1. Startup & Rendering Trace

Entry point `App.js:1-2` re-exports `src/app/App.js`'s default export. All logic lives in
`src/app/App.js` (2,122 lines), inside one component, `AppShell` (`src/app/App.js:501-2042`),
which conditionally renders screens from plain `useState`/`useMemo` values. There is no
`NavigationContainer`, no `linking` config object, and no router of any kind.

### 1.1 Startup config guard

- `src/app/startupConfig.js:1-35` — `validateStartupConfig()` checks
  `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  `EXPO_PUBLIC_SUPABASE_REDIRECT_URL`, `EXPO_PUBLIC_AUTH_PASSWORD_ENABLED`.
- HTTPS-only guard is dev-build-aware: in a release/TestFlight build (`isDevBuild=false`),
  `EXPO_PUBLIC_API_BASE_URL` must start with `https://`; dev builds may use `http://` for
  LAN/loopback backends (`startupConfig.js:20-21`).
- Supabase URL must always be `https://`, no dev exception (`startupConfig.js:24`).
- Redirect URL must equal exactly `ai.modefit.app://auth/callback` (`startupConfig.js:29`),
  matching `app.json:5` (`"scheme": "ai.modefit.app"`) and iOS `bundleIdentifier`
  (`app.json:20`).
- Called at the top of `App()` (`src/app/App.js:2044-2054`); on failure renders
  `StartupConfigErrorScreen` (`App.js:256-280`) instead of `AppShell` — a hard, always-on gate,
  not feature-flagged. **Classification: (a) actively rendered.**

### 1.2 Supabase session restore

- Client config: `src/services/supabaseClient.js:52-60` — `persistSession: true`,
  `autoRefreshToken: true`, `detectSessionInUrl: false` (deep-link tokens handled manually, see
  §1.3), custom `secureSessionStorage` adapter.
- Cold-start restore: `App.js:677-757` inside a `useEffect`. `loadSession()`
  (`App.js:698-731`) calls `supabase.auth.getSession()`. `shouldRefreshRestoredSession()`
  (`App.js:428-433`) proactively refreshes if the session expires within
  `SESSION_REFRESH_SKEW_SECONDS` (60s, `App.js:76`).
- `handleSessionRestoreError` (`App.js:680-696`): invalid refresh token → clears storage and
  resets to signed-out with `SESSION_EXPIRED_MESSAGE`; otherwise generic restore-failure message.
- `isSessionLoading` (`App.js:515`) gates the initial loading screen
  (`ShellLoadingState`, `App.js:1654-1686`).
- Parallel `onAuthStateChange` subscription (`App.js:735-751`) keeps `session` in sync and
  resets tab/nav state on sign-out. Auto-refresh pauses/resumes on `AppState` changes
  (`App.js:759-782`). **Classification: (a) actively rendered, always-on.**

### 1.3 Auth callbacks (magic link / OAuth / deep link)

- `App.js:817-906`, `handleUrlAuthCallback(url)`. `isExpectedAuthCallbackUrl()`
  (`App.js:119-130`) validates the URL against `resolveOAuthRedirectUrl()`
  (`App.js:96-98`, default `ai.modefit.app://auth/callback`).
- Fragment tokens (`#access_token=...&refresh_token=...`) take precedence over query-string
  tokens (`App.js:828-839`) → `supabase.auth.setSession(...)` (magic-link/implicit-flow path,
  `App.js:845-848`). Falls back to `code` param → `supabase.auth.exchangeCodeForSession(code)`
  (PKCE/OAuth path, `App.js:864-871`).
- Live-app deep links via `Linking.addEventListener('url', ...)` (`App.js:885-887`); cold-start
  deep links via `Linking.getInitialURL()` (`App.js:889-898`).
- OAuth initiation: `handleContinueWithProvider` (`App.js:1340-1370`), gated for UI visibility
  by `AUTH_SOCIAL_ENABLED` (default `false`, `featureFlags.js`, prop `showSocialAuth` at
  `App.js:1706`).
- Password auth: `handleContinueWithPassword`/`handleForgotPassword`
  (`App.js:1412-1517`), gated by `AUTH_PASSWORD_ENABLED` (default `false`, prop
  `showPasswordAuth` at `App.js:1707`).
- **Classification:** core callback handling (a) always-on; social/password UI entry points
  (b) flag-gated, both flags default off.
- There is no deep-link router library — this manual `Linking` handling is the entirety of the
  deep-link/auth-callback surface.

### 1.4 Onboarding bootstrap

- Service: `src/features/onboarding/services/onboardingApi.js` —
  `getOnboardingBootstrap` (`:107-109`, `GET /api/v1/onboarding/bootstrap`),
  `setOnboardingRole` (`:111-117`), `patchOnboardingState` (`:119-129`),
  `completeOnboarding` (`:131-140`).
- `loadBootstrap` (`App.js:627-675`) fires on session-token change (`App.js:908-917`); on 401
  attempts one session refresh + retry (`App.js:644-668`), else clears storage and signs out.
- `isBootstrapLoading` (`App.js:516`) gates loading UI; `!bootstrap` renders `ShellErrorState`
  with retry (`App.js:1736-1748`).
- **State machine:** `appState` (`App.js:1135-1165`), values from `APP_STATE` enum
  (`App.js:87-94`): `SIGNED_OUT`, `AUTHENTICATED_ROLE_UNKNOWN`, `CLIENT_ONBOARDING`,
  `ONBOARDING_PARTIAL`, `CLIENT_ACTIVE`, `TRAINER_STUB`.
  - No token → `SIGNED_OUT`.
  - Token, no `bootstrap.role` → `AUTHENTICATED_ROLE_UNKNOWN` → `RoleSelectionScreen`
    (`App.js:1750-1759`).
  - `role === 'trainer'`, non-legacy, onboarding incomplete → `TRAINER_STUB` (§1.6).
  - `role === 'client'`, `!bootstrap.onboarding_complete`: `in_progress` →
    `ONBOARDING_PARTIAL`, else `CLIENT_ONBOARDING`. Both render `ClientOnboardingBridge`
    (`App.js:472-499`, rendered `App.js:1761-1771`), which calls `completeOnboarding(...)`
    once (guarded by `hasCalledRef`) then flips to `CLIENT_ACTIVE`.
  - Otherwise → `CLIENT_ACTIVE`.
- Onboarding chat-intro capture: `onboardingChatIntroPending`
  (`App.js:1820-1822`) passed into `ChatShell` (`App.js:1928-1929,1944-1945`) →
  `handleCaptureOnboardingIntro` (`App.js:1633-1652`) → `patchOnboardingState`.
- `ProductPreviewScreen` (`src/features/onboarding/screens/ProductPreviewScreen.js`) is
  reachable pre-auth via `authStage === 'preview'` (`App.js:1689-1696`). **Classification:**
  all on the main path, (a) actively rendered.

### 1.5 Assignment status checks

- Service: `src/features/trainerAssignment/services/trainerAssignmentApi.js` —
  `getTrainerAssignmentStatus` (`:60-62`, `GET /api/v1/trainer-assignment/status`);
  `assignTrainer`/`assignTrainerByInvite`/`removeCurrentTrainerAssignment` (`:64-85`) are used
  deeper in profile/trainer screens, not directly in `App.js`.
- `loadAssignmentStatus` (`App.js:934-973`) fetches on session-token change
  (`App.js:975-984`, one auto-retry after 900ms for network-stage errors,
  `ASSIGNMENT_STATUS_AUTO_RETRY_DELAY_MS` at `App.js:75`), and again whenever
  `isTrainerViewer` becomes true (`App.js:1260-1265`).
- `isBlockingAssignmentLoad` (`App.js:1568-1571`) gates a "Syncing Your Coach" loading screen
  when loading, viewer is a trainer, and no status/error yet.
- `assignmentStatus.assigned_trainer_id` (fallback `bootstrap.assigned_trainer_id`) →
  `hasAssignedTrainer` (`App.js:1793-1794`) determines whether an assigned client gets a
  trainer-specific Coach chat or an unassigned client gets the Atlas fallback chat
  (`sessionType="atlas_client_chat"`, `App.js:1934-1947`).
- `assignmentStatus.viewer_role` is the primary source for role gating (§1.6).
  **Classification: (a) actively rendered.**

### 1.6 Role gates (client vs. trainer)

- `viewerRole` (`App.js:1167-1171`): primarily `assignmentStatus?.viewer_role`; falls back to
  `VIEWER_ROLE.TRAINER` only if `bootstrap.role === 'trainer' && bootstrap.is_legacy_trainer`,
  else `VIEWER_ROLE.CLIENT`.
- `isTrainerViewer = viewerRole === VIEWER_ROLE.TRAINER` (`App.js:1172`).
- `useCoachOsTrainerNav = isTrainerViewer && TRAINER_ROUTE_FOUNDATION_ENABLED`
  (`App.js:1173`) — the flag gate between the new `TrainerRouteHost` (Coach OS) nav and the
  legacy per-tab inline block (`App.js:1845-2004`, `shouldUseTrainerRouteFoundation` at
  `App.js:1788`). `TRAINER_ROUTE_FOUNDATION_ENABLED` defaults **`true`**
  (`src/config/featureFlags.js:24-27`, env `EXPO_PUBLIC_TRAINER_ROUTE_FOUNDATION_ENABLED`) — so
  on a fresh build with no env override, Coach OS is the active path.
- Non-legacy trainer stub gating: `bootstrap.role === 'trainer' && !bootstrap.is_legacy_trainer`
  with onboarding incomplete → `APP_STATE.TRAINER_STUB` (`App.js:1142-1154`) →
  `TrainerOnboardingScreen` (`App.js:1773-1783`). Once complete, code explicitly falls through
  to `CLIENT_ACTIVE` (comment at `App.js:1152-1153`) — post-onboarding trainers share the
  `CLIENT_ACTIVE` branch, distinguished only by `isTrainerViewer` at render time, not by
  `appState`.
- Tab-visibility role gating: `App.js:1267-1282` (auto-corrects invalid tab on role/nav-mode
  change) and `handleTabChange` (`App.js:1284-1313`, blocks clients from `clients`/`system`
  tabs; remaps trainer tab aliases between coach-os/legacy nav modes).
- `LiquidBottomNav` receives `role={isTrainerViewer ? 'trainer' : 'client'}` and
  `trainerNavMode` (`App.js:2023-2024`), selecting between `CLIENT_TABS`,
  `TRAINER_TABS_COACH_OS`, `TRAINER_TABS_LEGACY` (`LiquidBottomNav.js:20-38`).
  **Classification: (a) core gate logic actively rendered; (b) which trainer nav mode is used is
  flag-gated, default on for Coach OS.**

### 1.7 Daily check-in gate

- Gate state `coachCheckinGate` (`App.js:537-541`, `idle|loading|required|complete|error`),
  driven by a `useEffect` (`App.js:1202-1258`) that only runs when
  `shouldUseClientCoachEntryGate` is true: session present, `appState === CLIENT_ACTIVE`,
  `!isTrainerViewer`, `activeTab === 'coach'` (`App.js:1195-1200`). **The gate only applies to
  non-trainer, fully-onboarded clients viewing the Coach tab — trainers are never gated.**
- Fetches via `getTodayCheckin({ accessToken, date: clientLocalDate })`
  (`src/features/dailyCheckin/services/checkinApi.js:77-95`,
  `GET /api/v1/checkin/today?request_date=...`). `clientLocalDate` (`App.js:535`) recomputes on
  `AppState` foreground events (`App.js:784-802`) and at local-midnight rollover
  (`App.js:804-811`, `getMillisecondsUntilNextLocalDay` at `App.js:422-426`).
- `shouldBlockCoachForCheckin` (`App.js:1808-1814`): true if the gate applies and
  (`coachCheckinGate.date !== clientLocalDate` or `status !== 'complete'`).
- Rendering (`App.js:1886-1909`): blocked + `status === 'required'` → `DailyCheckinScreen`;
  `status === 'error'` → `ShellErrorState` with retry (`handleRetryCoachCheckinGate`,
  `App.js:1557-1559`); otherwise a "Checking Today's MODE" loading state.
- On completion, `handleCoachGateCheckinComplete` (`App.js:1541-1555`) marks the gate
  `complete`, stores `todayCheckinContext` (`buildTodayCheckinContext`, `App.js:450-470`), and
  launches Coach chat with `entrypoint: 'post_checkin'`.
- Bottom nav hidden while blocking: `shouldHideBottomNavForCoachCheckin`
  (`App.js:1815-1818`), consumed at `App.js:2018`. **Classification: (a) fully active on the
  main path, not feature-flagged.**

### 1.8 Tab state / bottom nav

- `LiquidBottomNav`: `src/features/navigation/components/LiquidBottomNav.js:109-232`. Exports
  `NAV_BOTTOM_OFFSET`/`NAV_PILL_HEIGHT` (lines 44-45), consumed by `App.js:25-28,70-71` for
  layout math.
- **All tab state is owned by `AppShell`, not by `LiquidBottomNav`.** `LiquidBottomNav` is a
  controlled presentational component: receives `activeTab`, `onTabChange`, `role`,
  `trainerNavMode`, `activeMode` (`LiquidBottomNav.js:109-116`), calls `onTabChange` on press
  (`:225`); it holds only internal Reanimated shared values for the sliding-pill animation
  (lines 121-130).
- Owning state in `AppShell`: `activeTab` (`App.js:527`), `chatLaunchContext` (528),
  `coachOverlayContext` (529), `progressRoute` (530), `progressMetricDetail` (531),
  `insightsOrigin` (532).
- Tab-list definitions live in `LiquidBottomNav.js:20-38/117-119`
  (`CLIENT_TABS`, `TRAINER_TABS_COACH_OS`, `TRAINER_TABS_LEGACY`); which set is used is decided
  by props from `App.js:2023-2024`.
- `handleTabChange` (`App.js:1284-1313`) is the single mutation point for `activeTab`.
  Rendered once, `App.js:2019-2026`, hidden when a coach overlay is open or the check-in gate
  blocks (`!coachOverlayContext && !shouldHideBottomNavForCoachCheckin`).
  **Classification: (a) actively rendered, sole live bottom nav.**

### 1.9 Trainer route host

- File: `src/features/trainerPlatform/routes/TrainerRouteHost.js` (97 lines). Imported once
  (`App.js:45`), used once (`App.js:1846-1858`).
- Mount condition: `shouldUseTrainerRouteFoundation` = `useCoachOsTrainerNav` (§1.6). If false,
  the legacy inline per-tab JSX block renders instead (`App.js:1860-2003`).
- Internally a pure function of `activeTab` (`resolveTrainerTab`, `TrainerRouteHost.js:8-16`),
  no internal state:
  - `'coach'` (default/fallback): `TrainerCoachWorkspace` if
    `chatLaunchContext.entrypoint === 'trainer_agent_training'`, else `ChatShell`
    (`role="trainer"`, `sessionType="coach_ai"`) (`TrainerRouteHost.js:18-61`).
  - `'clients'` → `TrainerClientsScreen` (`:64-72`).
  - `'system'` → `TrainerSystemScreen` (`:74-86`).
  **Classification: (b) flag-gated active path, default on.**

### 1.10 Deep link handling

- No linking-config object / navigation library — the manual `Linking` API handling described
  in §1.3 is the entirety of deep-link handling.
- Scheme: `app.json:5` (`"scheme": "ai.modefit.app"`), iOS `associatedDomains:
  ["applinks:mode.app"]` (`app.json:15-17`), `bundleIdentifier: "ai.modefit.app"`
  (`app.json:20`).
- Handles cold start (`Linking.getInitialURL()`) and warm/foreground
  (`Linking.addEventListener('url', ...)`) delivery. **Classification: (a) actively rendered.**

### 1.11 Final render tree by scenario

Sequential early-returns inside `AppShell` — order matters:

1. `isSessionLoading` → loading screen (`App.js:1654-1686`).
2. No `session.access_token` → `authStage === 'preview'` ? `ProductPreviewScreen` :
   `OnboardingLandingScreen` (`App.js:1688-1724`).
3. `isBootstrapLoading` → loading screen (`App.js:1727-1734`).
4. `!bootstrap` → `ShellErrorState` retry screen (`App.js:1736-1748`).
5. `appState === AUTHENTICATED_ROLE_UNKNOWN` → `RoleSelectionScreen` (`App.js:1750-1759`).
6. Fresh client mid-onboarding (`CLIENT_ONBOARDING`/`ONBOARDING_PARTIAL`) →
   `ClientOnboardingBridge` (`App.js:1761-1771`).
7. Trainer mid-onboarding (`TRAINER_STUB`) → `TrainerOnboardingScreen`
   (`App.js:1773-1783`).
8. Otherwise (`CLIENT_ACTIVE`, covers fully-onboarded clients AND fully-onboarded/legacy
   trainers) → main shell (`App.js:1833-2041`):
   - **Trainer, `TRAINER_ROUTE_FOUNDATION_ENABLED` on (default):** `TrainerRouteHost` renders
     `ChatShell`(trainer)/`TrainerCoachWorkspace`/`TrainerClientsScreen`/`TrainerSystemScreen`
     by `activeTab`, plus `LiquidBottomNav` with `TRAINER_TABS_COACH_OS`.
   - **Trainer, flag off or legacy trainer without Coach OS nav:** legacy inline block renders
     `TrainerHomeScreen` (home) / `CoachChatScreen`-or-`ChatShell` (coach, always "legacy" per
     `shouldUseLegacyCoachChat` at `App.js:1801-1807`) / `TrainerClientsScreen` (clients) /
     `ProfileScreen` (profile/system), plus `LiquidBottomNav` with `TRAINER_TABS_LEGACY`.
   - **Fully onboarded client:** legacy inline block renders `AlgorithmHomeScreen` (home) /
     check-in-gated `DailyCheckinScreen` then `CoachChatScreen`/`ChatShell` (coach, gated by
     `shouldBlockCoachForCheckin` and `hasAssignedTrainer`) / `ProgressScreen`/
     `MetricDrillDownScreen`/`CoachInsightsScreen` (progress, sub-routed via `progressRoute`) /
     `ProfileScreen` (profile), plus `LiquidBottomNav` with `CLIENT_TABS`.
   - Overlaid on either: `coachOverlayContext` floats a `CoachChatScreen`
     (`App.js:2007-2016`, for `generated_workout`/`generated_nutrition` entrypoints), and
     `RAGE_SHAKE_FEEDBACK_ENABLED` (default true) conditionally mounts `FeedbackReporter`
     (`App.js:2030-2039`).

### 1.12 Feature flags referenced in `App.js`

| Flag | Env var | Default | Role |
|---|---|---|---|
| `AUTH_SOCIAL_ENABLED` | `EXPO_PUBLIC_AUTH_SOCIAL_ENABLED` | `false` | Gates OAuth buttons |
| `AUTH_PASSWORD_ENABLED` | `EXPO_PUBLIC_AUTH_PASSWORD_ENABLED` | `false` | Gates password auth UI + required startup config value |
| `TRAINER_ROUTE_FOUNDATION_ENABLED` | `EXPO_PUBLIC_TRAINER_ROUTE_FOUNDATION_ENABLED` | **`true`** | Switches `TrainerRouteHost` (Coach OS) vs. legacy trainer rendering — currently the live default |
| `BREATHING_TRANSITIONS_ENABLED` | `EXPO_PUBLIC_BREATHING_TRANSITIONS_ENABLED` | `true` | Swaps plain spinners for `BreathingTransitionOverlay` |
| `BREATHING_TRANSITION_DEMO_ENABLED` | `EXPO_PUBLIC_BREATHING_TRANSITION_DEMO_ENABLED` | `false` | Dev-only demo screen, `__DEV__`-gated (`App.js:2058-2062`) — unreachable in production |
| `RAGE_SHAKE_FEEDBACK_ENABLED` | `EXPO_PUBLIC_RAGE_SHAKE_FEEDBACK_ENABLED` | `true` | Gates `FeedbackReporter` mount |

`TRAINER_AGENT_LAB_ENABLED`, `TRAINER_REVIEW_ENABLED`, `ATLAS_ADMIN_REVIEW_ENABLED`,
`TRAINER_ASSISTANT_V1_ENABLED`, `AI_RESPONSE_RENDERING_V1_ENABLED`, `THEME_V2_ENABLED` are not
referenced in `App.js` — they gate behavior deeper inside `ChatShell`/`TrainerCoachWorkspace`/
`TrainerSystemScreen`/`AlgorithmHomeScreen` (see §2 and §3).

---

## 2. Design System Inventory

### 2.1 `lib/theme.js`

- 605 lines. Default export `theme` (legacy system, `lib/theme.js:245-594`): `theme.modes`
  (per-Mode BUILD/BEAST/RECOVER/REST token sets, `:130-216`), `theme.memoryChip` (`:218-230`),
  `theme.colors` (background/scene/glass/surface/text/border/accent/status/feedback/utility/
  cta/nav/state/brand/neutral/emotional/bubble/input/chip/mode, plus explicit
  `// Legacy aliases` blocks: `bg`, `surfaceSoft`, `primary`, `secondary`, `accentPrimary`,
  `onPrimary`, `onSurface`, `textHigh`, `textMedium`, `textDisabled`, `divider`, `success`,
  `warning`, `error` at `:456-474`), `theme.typography`, `theme.spacing`/`theme.space`,
  `theme.radii` (with legacy aliases `md`/`lg` at `:513-515`), `theme.iconSizes`, `theme.glass`,
  `theme.shadows`, `theme.interaction`, `theme.motion`, `theme.animation`.
- Additional legacy bridge blocks: `colors.surface` bridge keys `canvas`/`subtle`/`raised`/
  `muted` (`:308`); `colors.state` bridge keys `reset`/`base`/`build`/`overdrive` (`:396-400`).
- **80 files under `src/` import `{ theme }` from `lib/theme`**, spanning nearly every feature —
  this is the single dominant styling source of truth in the app.
- Theme V2 pilot re-export block, explicitly comment-fenced (`lib/theme.js:596-604`):
  ```
  // --- Theme v2 (pilot, additive) --------------------------------------------
  // Migration note: v2 tokens live in lib/theme/ and are consumed only by
  // flag-gated pilot surfaces (EXPO_PUBLIC_THEME_V2_ENABLED, default off).
  // Do NOT fold these into the legacy `theme` object above; surfaces migrate
  // one at a time per MODE_PRODUCT_PRINCIPLES.md. Do NOT add lib/theme/index.js
  // — 'lib/theme' must keep resolving to this file.
  export { themeV2Tokens } from './theme/tokens';
  export { themeV2Modes } from './theme/modes';
  export { ThemeProvider, useTheme, resolveThemeV2 } from './theme/ThemeProvider';
  ```

### 2.2 `lib/theme/*`

- `lib/theme.js` should never gain an `index.js` sibling. **Confirmed: `lib/theme/index.js`
  does not exist** — `find lib/theme -type f` returns only the three files below, matching the
  rule stated in `lib/theme.js:600-601` and `MODE_PRODUCT_PRINCIPLES.md:108-109`.
- `lib/theme/tokens.js` (1467 bytes): exports `themeV2Tokens` (`:4-29`). Header: "Approved v2
  spec — do not modify without founder sign-off" (`:2`). `surfaces.surface3Overlay` is
  explicitly commented "NOT canonical, `__DEV__` only" (`:9-14`).
- `lib/theme/modes.js` (381 bytes): exports `themeV2Modes` (beast/build/recover/rest
  accent+wash pairs, `:2-7`).
- `lib/theme/ThemeProvider.js` (1114 bytes): exports `resolveThemeV2(currentMode)`
  (`:13-30`), `ThemeV2Context`, `ThemeProvider` component (`:34-37`), `useTheme()` hook
  (`:39-41`).
- **`ThemeProvider`/`useTheme` React context is never mounted anywhere in the app tree** — no
  hits in `App.js` or any screen. Only exercised in
  `src/features/home/__tests__/themeV2.test.js` and
  `src/features/home/screens/__tests__/AlgorithmHomeScreen.themeV2.test.js`.
  **Classification: (d) dead outside tests.**

### 2.3 `THEME_V2_ENABLED` flag and its single consumer

- `src/config/featureFlags.js:60-62`, env `EXPO_PUBLIC_THEME_V2_ENABLED`, **default `false`**.
- **The only consumer in the entire codebase is `src/features/home/screens/AlgorithmHomeScreen.js`.**
  `const themeV2 = useMemo(() => (THEME_V2_ENABLED ? resolveThemeV2(currentMode) : null),
  [currentMode])` (`AlgorithmHomeScreen.js:466-469`). ~40 conditional call sites throughout the
  file (`themeV2 ? themeV2.X : modeTheme.Y`, e.g. lines 172, 184-185, 194, 221-231, 262, 337,
  342, 376-402, 480, 733-772, 798, 829-847, 868-870, 935-985) fall back to the legacy theme
  whenever the flag is off (the default).
- A `__DEV__`-only elevation-model toggle at `AlgorithmHomeScreen.js:470-476` compares
  `themeV2Tokens.surfaces.surface3Opaque` vs. `surface3Overlay`, explicitly marked "Dev-only.
  Never ships to a real build."
- Confirmed via `git log --oneline -- lib/theme/ lib/theme.js`: the v2 pilot was introduced in
  one commit, `5751e7c4 "Add flag-gated theme v2 token pilot on client home screen"` — a
  purpose-built, scoped, single-surface pilot, not a partially-completed broad migration.
  **Classification: (b) flag-gated active path, default off, scoped to exactly one screen.**

### 2.4 `lib/components/*` usage tally

Flat components (barrel `lib/components/index.js:1-22`), with count of `src/` files importing
each (excluding `__tests__`):

| Component | Usage count | Note |
|---|---|---|
| `ModeText.js` | 74 | Core typography primitive |
| `ModeButton.js` | 37 | |
| `ModeCard.js` | 32 | |
| `SafeScreen.js` | 25 | |
| `ModeInput.js` | 20 | |
| `ModeChip.js` | 12 | Wraps `PremiumChip`; also exports unused `ModeChipLegacy` (see below) |
| `HeaderBar.js` | 11 | |
| `InlineFeedback.js` | 8 | |
| `SystemSectionCard.js` | 4 | |
| `SystemSearchBar.js`, `SystemActionSheet.js`, `SystemSectionHeader.js` | 3 each | |
| `ProgressBar.js`, `EmptyState.js`, `SystemNavRow.js` | 2 each | |
| `StateBadge.js`, `SystemIdentityHeader.js` | 1 each | |
| `ModeListItem.js`, `StreakRing.js`, `SystemCountBadge.js` | **0** | Barrel-exported, no `src/` consumer — dead |

`lib/components/glass/*`: `GlassSurface` (8 files), `GlassCard` (1: `DailyCheckinScreen.js`),
`GlassRow` (**0**, dead); `GlassInputBar` (`ChatInputDock.js`, `CoachComposer.js`),
`FloatingQuickActionChip` (`QuickReplies.js`, `SuggestedActionChips.js`), `GlassPill`/
`GlassSlider`/`GlassToggle` (only in `DailyCheckinScreen.js`), `GlassButtonPrimary`/
`GlassButtonSecondary` (**0**, dead); `ChatBubbleAI`/`ChatBubbleUser` (only in
`ChatBubble.js`); `ProgressRing`/`MiniStat`/`HeroOverlayCard`/`SectionHeader` (only in
`DailyCheckinScreen.js`), `MacroBar`/`EmptyStateGlassPanel` (**0**, dead);
`AtmosphereBackground` (**0**, dead).

Note: two differently-named "section header" components exist —
`SystemSectionHeader` (lib/components, 14 call sites in `TrainerSystemScreen.js` alone, plus
`ProfileScreen.js`/`LegalSupportScreen.js`) and `SectionHeader` (lib/components/glass, used
only in `DailyCheckinScreen.js`/`ProgressScreen.js`/`MetricDrillDownScreen.js`) — a naming
collision across two component families.

`lib/components/premium/*`: `PremiumChip` (used transitively via `ModeChip`, all 12 `ModeChip`
consumers effectively render it); `PremiumGlassCard.js`, `PremiumClientCard.js`, `PremiumButton.js`
have **no direct `src/` import** found; **`PremiumTabBar.js`** (exports `PremiumTabBar`,
`PREMIUM_TAB_BAR_BOTTOM_OFFSET`, `PREMIUM_TAB_BAR_HEIGHT`, `premium/index.js:5-9`) is confirmed
dead repo-wide (`grep -rln "PremiumTabBar" .` returns only its own definition + barrel file) —
**a second, unused bottom-tab-bar implementation living alongside the active `LiquidBottomNav`.**

`ModeChipLegacy` / `LegacyStaticChip` (`lib/components/ModeChip.js:28-38`): not exported from
the barrel, zero consumers repo-wide — dead.

### 2.5 Screen-level styling consistency (20-screen sample)

| Screen | `StyleSheet.create` | imports `lib/theme` | Hardcoded hex | Inline `style={{...}}` |
|---|---|---|---|---|
| `auth/screens/Login.js` | 0 | 0 | 0 | 0 (thin wrapper) |
| `auth/screens/OnboardingLandingScreen.js` | 1 | 1 | **11** (e.g. `#5b6dff`, `#32d3bd`, `#0b0f1a`, `#f8fbff` at lines 31, 71, 413, 425, 435, 471-472, 568, 590, 686) | 0 |
| `chat/screens/CoachChatScreen.js` | 4 | 1 | 4 (`#FFFFFF`, `#3CB97A`×2, `#D6E4FF` at lines 2136, 2159, 2169, 2273) | 1 |
| `dailyCheckin/screens/DailyCheckinScreen.js` | 1 | 1 | 0 | 0 |
| `home/screens/AlgorithmHomeScreen.js` | 1 | 1 | 0 | 0 |
| `insights/screens/CoachInsightsScreen.js` | 1 | 1 | 0 | 0 |
| `onboarding/screens/AuthChoiceScreen.js` | 1 | 1 | 0 | 0 |
| `onboarding/screens/RoleSelectionScreen.js` | 1 | 1 | 0 | 0 |
| `onboarding/screens/WelcomeScreen.js` | 1 | 1 | 0 | 0 |
| `profile/screens/ProfileScreen.js` | 1 | 1 | 0 | 0 |
| `profile/screens/AccountSettingsScreen.js` | 1 | 1 | 0 | 0 |
| `profile/screens/DiagnosticsScreen.js` | 0 | 0 | 0 | 0 (thin wrapper) |
| `progress/screens/ProgressScreen.js` | 1 | 1 | 0 | 0 |
| `progress/screens/MetricDrillDownScreen.js` | 1 | 1 | 0 | 0 |
| `trainerAssignment/screens/TrainerAssignmentScreen.js` | 1 | 1 | 0 | 0 |
| `trainerAssistant/screens/TrainerAssistantScreen.js` | 1 | 1 | 0 | 0 |
| `trainerClients/screens/TrainerClientsScreen.js` | 1 | 1 | 0 | 0 |
| `trainerHome/screens/TrainerHomeScreen.js` | 1 | 1 | 0 | 0 |
| `trainerPlatform/screens/TrainerSystemScreen.js` | 1 | 1 | 0 | 0 |
| `trainerReview/screens/TrainerReviewScreen.js` | 1 | 1 | 0 | 0 |

17 of 20 (85%) follow a consistent, disciplined pattern: `StyleSheet.create` + theme tokens,
zero hardcoded hex, zero inline style objects. 2 of 20 are thin shell screens with legitimately
no styles of their own (`Login.js`, `DiagnosticsScreen.js`). Only 2 deviate:
`OnboardingLandingScreen.js` (11 hardcoded hex values — its own teal/indigo gradient palette
rather than `theme.colors.accent`) and `CoachChatScreen.js` (4 hardcoded hex + 1 inline style,
in an otherwise theme-driven ~2,000+ line file).

### 2.6 Shared loading UI adoption

- Canonical module: `src/features/shared/loading/index.js:1-4` exports
  `BreathingTransitionOverlay`, `BREATHING_CONTEXT`/`getBreathingCopy`,
  `BREATHING_PHASE`/`useBreathingTransitionMachine`, `useReducedMotionPreference`. Gated by
  `BREATHING_TRANSITIONS_ENABLED` (default `true`).
- Consumers: `App.js:61-62`, `CoachInsightsScreen.js:15`, `CoachChatScreen.js:28`,
  `DailyCheckinScreen.js:55`, `TrainerReviewScreen.js:13`, `TrainerAssistantScreen.js:24`,
  `TrainerClientsScreen.js:80`, plus `useStreamingMessage.js:3` (only
  `useReducedMotionPreference`).
- Raw `ActivityIndicator` usage found in 10 of ~35 sampled screens:
  `AlgorithmHomeScreen.js`, `DailyCheckinScreen.js`, `ProgressScreen.js`,
  `MetricDrillDownScreen.js`, `CoachInsightsScreen.js`, `TrainerAssistantScreen.js`,
  `TrainerSystemScreen.js`, `TrainerClientsScreen.js`, `TrainerReviewScreen.js`,
  `TrainerHomeScreen.js`.
  - 5 of these (`DailyCheckinScreen`, `CoachInsightsScreen`, `TrainerAssistantScreen`,
    `TrainerClientsScreen`, `TrainerReviewScreen`) use the shared overlay for full-screen/
    initial-load transitions **and** a raw indicator for small inline states (e.g. button-save
    spinners) — a reasonable split.
  - 5 of these (`AlgorithmHomeScreen`, `ProgressScreen`, `MetricDrillDownScreen`,
    `TrainerSystemScreen`, `TrainerHomeScreen`) use **only** raw `ActivityIndicator` with no
    shared-overlay usage at all — these screens roll their own loading UI entirely outside the
    canonical shared component.

---

## 3. V2 / Legacy / Feature-Flag Classification

Excluded as out of scope (backend/business-logic labels, not UI/design-system):
`is_legacy_trainer` (account status, `App.js:1142,1152,1168`), `LEGACY_MODE_LABELS` in chat
message-label normalization (`ChatShell.js:27,62`, `ChatMessageBubble.js:7,20,30`),
`LEGACY_ALIAS`/`legacy_alias` SSE event type (`useChatStreaming.js:5,77,80`),
`allowLegacyPlainText` SSE parsing option (`chatApi.js:185`, `chatMessageService.js:135`,
`sse.js:63,71,98,140`), `trainerKnowledgeApi.js`'s document-shape migration code (18+ hits),
`LEGACY_COMMAND_ALIASES` for chat slash-commands (`useTrainerCoachWorkspace.js:26-27`), and
`docs/distributed_intelligence_architecture_delta.md:6` ("v1/v2" AI architecture, unrelated to
UI theming).

| File:line | Item | Classification |
|---|---|---|
| `lib/theme.js:308` | `colors.surface` legacy bridge keys | (a) active — part of live `theme` object, 80 consumers |
| `lib/theme.js:396-400` | `colors.state` legacy bridge keys | (a) active |
| `lib/theme.js:456-474` | Top-level legacy color aliases | (a) active |
| `lib/theme.js:513-515` | `radii.md`/`radii.lg` legacy aliases | (a) active |
| `lib/theme.js:596-604` | Theme v2 pilot re-export block + migration-note comment | (b) flag-gated active (re-exports); comment itself is (c) docs-only guidance |
| `lib/theme/tokens.js` | `themeV2Tokens` | (b) flag-gated active for `surface3Opaque`/general tokens; `surface3Overlay` specifically is (d) dead in production (only reachable via `__DEV__` branch) |
| `lib/theme/modes.js` | `themeV2Modes` | (b) flag-gated active |
| `lib/theme/ThemeProvider.js` | `resolveThemeV2` | (b) flag-gated active (called from `AlgorithmHomeScreen.js:467`) |
| `lib/theme/ThemeProvider.js` | `ThemeProvider`/`useTheme` context | (d) dead outside tests — never mounted in the app tree |
| `src/config/featureFlags.js:60-62` | `THEME_V2_ENABLED` flag definition | (b) the gate itself, default off |
| `src/features/home/screens/AlgorithmHomeScreen.js` (~40 sites) | `themeV2 ? ... : ...` ternaries | (b) flag-gated active — only screen wired to v2 |
| `src/features/home/screens/__tests__/AlgorithmHomeScreen.themeV2.test.js`, `src/features/home/__tests__/themeV2.test.js` | V2 resolution + flag-on behavior tests | (c) docs/test-only — confirms deliberate maintenance, no production runtime effect |
| `MODE_PRODUCT_PRINCIPLES.md:1,5-9,11,14,16,75,98,103-109,122,126` | "Design Token System v2" canonical doc | (c) docs-only — verified in sync with code (rule "never add lib/theme/index.js" is honored) |
| `lib/components/ModeChip.js:28-38` | `LegacyStaticChip`/`ModeChipLegacy` | (d) dead — not barrel-exported, zero consumers |
| `lib/components/premium/PremiumTabBar.js` + `premium/index.js:5-9` | Second bottom-tab-bar component | (d) dead — barrel-exported, zero consumers |
| `src/features/navigation/components/LiquidBottomNav.js:33-38,118` | `TRAINER_TABS_LEGACY` / `trainerNavMode === 'legacy'` | (b) flag-gated active — reachable whenever `TRAINER_ROUTE_FOUNDATION_ENABLED=false`; not dead, just the flag-off branch of a flag that defaults on |
| `src/features/trainerCoach/components/__tests__/CoachPanelHost.test.js:276` | Test description "renders the redesigned /note capture sheet..." | (c) docs-only — describes a completed change, not a parallel system |

**Tally:**
- Active, unconditional legacy code: 4 legacy alias/bridge blocks in `lib/theme.js`, live for
  all 80 theme consumers.
- Flag-gated (v2) active path: 1 flag (`THEME_V2_ENABLED`, default off), 1 consuming screen,
  3 source files, plus re-exports in `lib/theme.js`.
- Dead/unreachable UI code: `ModeChipLegacy`, `PremiumTabBar`, `ThemeProvider`/`useTheme`
  context, `surface3Overlay` in production, and unused barrel exports (`ModeListItem`,
  `StreakRing`, `SystemCountBadge`, `AtmosphereBackground`, `GlassRow`,
  `GlassButtonPrimary`/`Secondary`, `MacroBar`, `EmptyStateGlassPanel`, `PremiumButton`,
  `PremiumGlassCard`).
- Documentation-only: `MODE_PRODUCT_PRINCIPLES.md` — accurately describes and constrains the
  actual v2 pilot code; no drift found between doc and implementation.

---

## 4. Screen & Route Inventory

**Confirmed: no `*Navigator.js`/`*Stack.js`/`*Tabs.js` file exists anywhere in the repo, and
`package.json` has no `react-navigation`/`@react-navigation/*` dependency.** `src/features/
navigation/` contains exactly one file, `LiquidBottomNav.js` — a visual tab-bar component, not
a router. All routing is nested ad hoc `useState`/view-stack switching at three levels: (1)
`AppShell` root state machine, (2) per-feature "shell" screens with local `viewStack`/`route`
state, (3) plain conditional JSX with no shared screen registry.

### 4.1 Screens by feature

| Feature | Screen files |
|---|---|
| `auth` | `Login.js` |
| `chat` | `CoachChatScreen.js` |
| `dailyCheckin` | `DailyCheckinScreen.js` |
| `home` | `AlgorithmHomeScreen.js` |
| `insights` | `CoachInsightsScreen.js` |
| `onboarding` | `AuthChoiceScreen.js`, `ClientOnboardingFlowScreen.js`, `CoachTabGuardScreen.js`, `ProductPreviewScreen.js`, `RoleSelectionScreen.js`, `TrainerStubScreen.js`, `WelcomeScreen.js` |
| `profile` | `AIGuidanceScreen.js`, `AccountSettingsScreen.js`, `DeleteAccountScreen.js`, `DiagnosticsScreen.js`, `LegalSupportScreen.js`, `PersonalizationScreen.js`, `ProfileScreen.js`, `SettingsScreenShell.js` (shared shell, not routed), `TrainerDefaultsScreen.js`, `TrainerScheduleScreen.js` |
| `progress` | `MetricDrillDownScreen.js`, `ProgressScreen.js` |
| `trainerAssignment` | `TrainerAssignmentScreen.js` |
| `trainerAssistant` | `TrainerAssistantScreen.js` |
| `trainerClients` | `TrainerClientsScreen.js` |
| `trainerCoach` | `TrainerCoachScreen.js` |
| `trainerHome` | `TrainerHomeScreen.js` |
| `trainerOnboarding` | `TrainerOnboardingScreen.js` |
| `trainerPlatform` | `TrainerCoachWorkspace.js`, `TrainerSystemScreen.js` (+ `routes/TrainerRouteHost.js`) |
| `trainerReview` | `TrainerReviewScreen.js` |

Also present outside `screens/`: `src/features/feedback/` (`FeedbackInboxScreen.js`,
`FeedbackReporter.js`, `FeedbackSheet.js`) and `src/features/chat/components/
ChatHistoryScreen.js` (a chat sub-view under `components/`, not `screens/`).

### 4.2 `ChatShell` sub-route stack

File: `src/features/chat/components/ChatShell.js` (543 lines). Local state, no navigation
library:

```js
const [route, setRoute] = useState({ name: readOnly ? 'detail' : 'today', sessionId: null });
```

Route names: `'today'` (default conversation), `'history'`, `'detail'` (read-only past
session). Transitions: `openHistory()`, `openSession(session)`, `backToToday()`,
`backFromDetail()`. Render logic (`ChatShell.js:487-536`): `route.name === 'history'` →
`ChatHistoryScreen`; otherwise `ChatConversationView` (internal component, same file) with
`readOnly`/`sessionId` derived from `route`.

`ChatConversationView` nests two more local-state-gated overlays: `isDailyCheckinOpen` →
`DailyCheckinScreen` inline (from the "Daily check-in" suggested action), and `activePlanType`
(`CHECKIN_PLAN_TYPE.TRAINING`/`NUTRITION`) → `CheckinPlanBuilder` (exported from
`DailyCheckinScreen.js`). Full sub-route stack: `today` → (`history` → `detail`) plus two
modal-like overlays (`checkin`, `plan-builder`), all local component state — no shared history
API.

### 4.3 `ProfileScreen` sub-route stack

File: `src/features/profile/screens/ProfileScreen.js` (683 lines). Explicit view-stack array:

```js
const [viewStack, setViewStack] = useState([{ key: PROFILE_SETTINGS_VIEW.ROOT, params: null }]);
const currentView = viewStack[viewStack.length - 1];
```

| View key | Component | File |
|---|---|---|
| `ROOT` | inline `SystemNavRow` menu | `ProfileScreen.js:579-671` |
| `ACCOUNT` | `AccountSettingsScreen` | `profile/screens/AccountSettingsScreen.js` |
| `PERSONALIZATION` | `PersonalizationScreen` | `profile/screens/PersonalizationScreen.js` |
| `TRAINER_SCHEDULE` (client viewer only) | `TrainerScheduleScreen` | `profile/screens/TrainerScheduleScreen.js` |
| `TRAINER_DEFAULTS` (trainer viewer only) | `TrainerDefaultsScreen` | `profile/screens/TrainerDefaultsScreen.js` |
| `AI_GUIDANCE` | `AIGuidanceScreen` | `profile/screens/AIGuidanceScreen.js` |
| `LEGAL_SUPPORT` | `LegalSupportScreen` | `profile/screens/LegalSupportScreen.js` |
| `DIAGNOSTICS` (dev/flag-gated) | `DiagnosticsScreen` | `profile/screens/DiagnosticsScreen.js` |

Account deletion is implemented **inline inside `AccountSettingsScreen`** via props passed
from `ProfileScreen` — the separate `DeleteAccountScreen.js` file in the same directory is
never imported anywhere (§4.6). All sub-screens share `SettingsScreenShell.js` for header/back
chrome (a layout wrapper, not a router).

### 4.4 `TrainerRouteHost` and nested trainer sub-shells

`TrainerRouteHost.js` itself has no internal state — a pure function of `activeTab` (§1.9).
Deeper trainer shells each run their own local view-stack:

- `TrainerCoachWorkspace.js`: local `activeSubview` state
  (`COACH_SUBVIEW.ASSISTANT | CHAT | REVIEW`), toggled by an inline `CoachSubviewSwitcher`
  pill, rendering `TrainerAssistantScreen` (gated `TRAINER_ASSISTANT_V1_ENABLED`),
  `CoachChatScreen`, or `TrainerReviewScreen` (gated `TRAINER_REVIEW_ENABLED`).
- `TrainerSystemScreen.js` (4,310 lines): another `viewStack`-based shell, `SYSTEM_VIEW` enum:
  `HUB`, `COACH_WORKSPACE`, `KNOWLEDGE_WORKSPACE`, `DEFAULTS_SESSION`,
  `DEFAULTS_COMMUNICATION`, `CLIENTS_LIST`, `CLIENT_MANAGEMENT`,
  `CLIENT_DETAIL_MANAGEMENT`, `REVIEW_HUB`, `ATLAS_ADMIN_REVIEW` (flag-gated),
  `SYSTEM_ACCOUNT`, `FEEDBACK_INBOX` (gated on `bootstrap?.is_feedback_admin`, renders
  `src/features/feedback/FeedbackInboxScreen.js`). Internal sub-components (not separate
  files): `TrainerSystemHubScreen`, `CoachWorkspaceScreen`, `KnowledgeWorkspaceScreen`,
  `DefaultsSessionScreen`, `DefaultsCommunicationScreen`.
- `TrainerClientsScreen.js`: local `viewMode` state machine, `VIEW_MODE.COMMAND_CENTER` /
  `CLIENT_DETAIL` / `CLIENT_SETUP`.

### 4.5 Central navigator vs. ad hoc wiring, per feature

| Feature | Wiring mechanism | Where |
|---|---|---|
| chat | `AppShell` renders `ChatShell` on `activeTab === 'coach'`; internal routing is `ChatShell`'s own state | `App.js:1911-1947`; `ChatShell.js:466` |
| dailyCheckin | Rendered inline by `AppShell` (check-in gate) and by `ChatShell`/`ChatConversationView` local boolean | `App.js:1886-1909`; `ChatShell.js:355-376` |
| home | `AppShell` `activeTab === 'home'` | `App.js:1861-1884` |
| insights | `AppShell` `progressRoute === 'insights'` | `App.js:1976-1982` |
| onboarding | `AppShell` `appState`/`authStage` machine (only `ProductPreviewScreen`, `RoleSelectionScreen` reachable) | `App.js:1688-1783` |
| profile | `AppShell` `activeTab === 'profile'/'system'` → `ProfileScreen` self-routes via `viewStack` | `App.js:1992-2002`; `ProfileScreen.js:82` |
| progress | `AppShell` `progressRoute` local state | `App.js:1956-1982` |
| trainerAssignment | **Not screen-wired** — only its service is used by `App.js`/onboarding | n/a |
| trainerAssistant | Rendered by `TrainerCoachWorkspace`'s local `activeSubview` | `TrainerCoachWorkspace.js:138-147` |
| trainerClients | `AppShell` `activeTab === 'clients'` (legacy) **and** `TrainerRouteHost` (Coach OS); self-routes via `viewMode` | `App.js:1984-1990`; `TrainerRouteHost.js:64-72` |
| trainerCoach | **Not screen-wired** — `TrainerCoachScreen.js` orphaned; only its service is used (by `TrainerSystemScreen`'s Review Hub) | n/a |
| trainerHome | `AppShell` `activeTab === 'home'` when `isTrainerViewer` (legacy nav only) | `App.js:1872-1884` |
| trainerOnboarding | `AppShell` `appState === TRAINER_STUB` | `App.js:1773-1783` |
| trainerPlatform | `AppShell` renders `TrainerRouteHost` when Coach OS nav enabled; fans out to `TrainerCoachWorkspace`/`TrainerSystemScreen` | `App.js:1845-1858`; `TrainerRouteHost.js` |
| trainerReview | Rendered by `TrainerCoachWorkspace`'s local `activeSubview` (flag-gated) | `TrainerCoachWorkspace.js:127-136` |

No feature uses a declarative navigator config — every row above is an
`if (activeTab === X)` / `if (currentView.key === X)` conditional chain.

### 4.6 Orphaned screens (dead code, confirmed via `grep -rl` — never imported by any live path)

| File | Note |
|---|---|
| `src/features/auth/screens/Login.js` | Thin wrapper around `AuthChoiceScreen`; not imported anywhere. Superseded by `OnboardingLandingScreen.js`, which implements auth UI inline and imports none of `Login`/`AuthChoiceScreen`/`WelcomeScreen`. |
| `src/features/onboarding/screens/AuthChoiceScreen.js` | Only referenced by the other orphans below — an isolated island unreachable from `App.js`. |
| `src/features/onboarding/screens/WelcomeScreen.js` | Not imported by anything reachable from the app root. |
| `src/features/onboarding/screens/ClientOnboardingFlowScreen.js` | Not imported anywhere. The actual path in `App.js` is the lightweight `ClientOnboardingBridge`, not this multi-step screen. |
| `src/features/onboarding/screens/CoachTabGuardScreen.js` | Not imported anywhere. |
| `src/features/onboarding/screens/TrainerStubScreen.js` | Not imported anywhere; explicitly superseded per comment in `TrainerOnboardingScreen.js` ("Replaces TrainerStubScreen for non-legacy trainers"). |
| `src/features/profile/screens/DeleteAccountScreen.js` | Not imported anywhere. Deletion is implemented inline inside `AccountSettingsScreen.js` instead. |
| `src/features/trainerAssignment/screens/TrainerAssignmentScreen.js` | Not imported anywhere (only its sibling service is used, by `App.js`/`ProfileScreen.js`/onboarding). |
| `src/features/trainerCoach/screens/TrainerCoachScreen.js` | Not imported anywhere (only its sibling service is used, by `TrainerSystemScreen.js`'s Review Hub). |

All nine are fully-formed components with real UI code — accumulated debris from earlier
auth/onboarding/profile/trainer iterations, not in-progress work.

Not orphaned, but worth flagging: `SettingsScreenShell.js` is correctly used by 7 other profile
screens as a shared layout wrapper — it is not itself a routed "screen."

### 4.7 Tab-key inventory

Source: `LiquidBottomNav.js:20-38`, cross-referenced with `AppShell`'s `handleTabChange`.

**Client tabs** (`CLIENT_TABS`): `coach` (Coach/Dumbbell), `home` (Home/Home),
`progress` (Progress/BarChart3), `profile` (Settings/User).

**Trainer tabs — Coach OS** (`TRAINER_TABS_COACH_OS`, active when
`TRAINER_ROUTE_FOUNDATION_ENABLED` is on — the default): `coach` (Coach/Dumbbell),
`clients` (Clients/Users), `system` (System/User).

**Trainer tabs — legacy** (`TRAINER_TABS_LEGACY`, active when the flag is off):
`home` (Home/Home), `coach` (Coach/Dumbbell), `clients` (Clients/Users),
`profile` (Settings/User).

`App.js`'s `handleTabChange` (`App.js:1284-1313`) remaps trainer taps between the two schemes:
`home`→`coach` and `profile`→`system` when Coach OS is active; `system`→`profile` when legacy
is active. `progressRoute` (`progress`, `metric-detail`, `insights`) is a separate, non-tab-bar
sub-route only used within the client `progress` tab. No tab bar is shown during the
daily-check-in gate or while `coachOverlayContext` is active.

---

## 5. Fragmentation Diagnosis

This section explains *why* the experience reads as fragmented, based only on the evidence
above — it does not prescribe a fix.

1. **Three independent routing idioms coexist with no shared contract.** The root
   (`AppShell`) is a monolithic state machine keyed on enums (`APP_STATE`, `activeTab`,
   `progressRoute`); feature shells (`ProfileScreen`, `TrainerSystemScreen`,
   `TrainerClientsScreen`) each invent their own `viewStack`/`viewMode` array with their own
   push/pop helpers; and `TrainerRouteHost` is a third pattern — a stateless pure function of a
   parent-owned prop. None of these share a screen registry, a back-history API, or deep-link
   addressability below the top level. Adding a new sub-route means learning whichever local
   convention that particular shell happened to invent.
2. **Two tab-bar implementations exist for one visible tab bar.** `LiquidBottomNav` is live;
   `PremiumTabBar` is fully built, styled, and exported, but has zero consumers. This suggests
   an abandoned redesign attempt that was never deleted, which risks a future contributor
   wiring it back in by mistake, or spending time reasoning about which one is "current."
2a. Note the `PremiumChip`/`ModeChip`/`ModeChipLegacy` pattern is a smaller instance of the same
   thing — a components family with a shipped variant, a wrapped variant, and a dead variant, all
   in the same file/barrel.
3. **The trainer nav split is not "legacy vs. current" in the way the naming implies.** Both
   `TRAINER_TABS_COACH_OS` and `TRAINER_TABS_LEGACY` are live, reachable code paths, controlled
   by one flag that defaults to Coach OS. Anyone reading `App.js` without checking the flag
   default could reasonably assume "legacy" is dead — it is not; it is the flag-off branch of
   an on-by-default flag. This is a naming/labeling fragmentation, not a code fragmentation.
4. **The Theme V2 pilot is correctly scoped but creates two theming worlds on paper.** The
   pilot is deliberately restricted to one screen and one flag (default off), and the doc
   (`MODE_PRODUCT_PRINCIPLES.md`) matches the code exactly — this is *not* an example of drift.
   But its mere existence, plus the four legacy-alias blocks already inside `lib/theme.js`,
   means a reader encountering `theme.colors.bg` vs `theme.colors.background.app` vs
   `themeV2Tokens.surfaces.surface3Opaque` has three ways to reach a background color with no
   single canonical entry point signposted at the top of the file.
5. **Nine dead screens accumulate with no removal step in the workflow.** Every one of them is
   a complete, styled component — not a stub — meaning each represents real effort that was
   superseded but never cleaned up (auth flow superseded by `OnboardingLandingScreen`,
   onboarding flow superseded by `ClientOnboardingBridge`, trainer stub superseded by
   `TrainerOnboardingScreen`, account deletion moved inline). This pattern — build a
   replacement, wire it in, leave the old file in place — appears to be the norm rather than
   the exception in this codebase, based on the volume of orphans found in one pass.
6. **Loading-state UX is inconsistent by omission, not by design.** There is one canonical
   shared loading system (`BreathingTransitionOverlay`), but roughly a third of screens never
   adopt it, defaulting instead to bare `ActivityIndicator`. Nothing in the codebase enforces
   or flags this at the point a new screen is created.

---

## 6. Runtime-Verification-Needed List

The following are asserted from static analysis (source reading + `grep`) and should be
confirmed by actually running the app before being treated as certain:

- Confirm `TRAINER_ROUTE_FOUNDATION_ENABLED`'s default (`true`) is indeed what ships in the
  current build config (no env override in `.env`/EAS build profiles that flips it), i.e. that
  Coach OS trainer nav is genuinely what a fresh trainer sees today.
- Confirm the 9 orphaned screens (§4.6) are truly never mounted — static `grep` cannot rule out
  a dynamic `require()`/computed import path; a runtime trace (e.g. temporarily logging on
  mount, or a bundler dead-code report) would make this certain.
- Confirm `PremiumTabBar` and the other zero-consumer `lib/components`/`lib/components/glass`/
  `lib/components/premium` exports are not referenced from any Storybook-style dev harness or
  design-preview screen not covered by this `src/features/**` sweep.
- Confirm the two screens with hardcoded hex values (`OnboardingLandingScreen.js`,
  `CoachChatScreen.js`) render visually distinct from the rest of the theme-token-driven app in
  both light conditions the theme system supports, to gauge real visual impact vs. a purely
  code-level deviation.
- Confirm the 5 screens using only raw `ActivityIndicator` (§2.6) actually present a visibly
  different loading experience to a user, versus the `BreathingTransitionOverlay` screens, in a
  live run.

---

## 7. Verification

### Commands run

```
$ git status --short
(clean, no output)

$ git rev-parse HEAD
7ed7afa93322dedbf3bc2b2f15b5804e09ade949

$ git branch --show-current
main
```

`scripts/codex_prompt_check.js` was read in full prior to running (see Phase 0 table above) and
confirmed inspection-only.

### `npm run codex:check`

A local dev backend was already reachable (no need to start one for this audit). Result:

```
MODE Codex prompt check

Backend static route tests
.............                                                            [100%]
13 passed in 2.25s

Backend reachability
Reachable backend: http://192.168.6.145:8000

Runtime route surface preflight
Runtime route surface preflight: PASSED
Base URL: http://192.168.6.145:8000
Verified 33 required route paths.
Verified unauth route behavior for trainer coach and chat history endpoints.
Skipped authenticated chat session history endpoint; pass --auth-token to verify it.

Codex prompt check: PASSED
```

(Backend health reported `"status":"degraded"`/`"db":"error"` — a pre-existing local dev DB
connectivity issue unrelated to this audit; route-surface and route-contract checks still
passed.)

### Final repo status

```
$ git status --short
?? docs/design/

$ git diff --stat
(empty — no tracked files modified)

$ git diff --name-only
(empty)

$ git status --porcelain --untracked-files=all
?? docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md
```

Confirmed: the only change introduced by this audit is the new file
`docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md`. No tracked file was modified, and
`npm run codex:check` did not alter repo state.

---
