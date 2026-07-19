# MODE Founder Decisions

Canonical decisions that affect auth, security, routing, or tenant behavior.
Consult this file before changing the areas it covers.

---

## Auth: Canonical Redirect URL [2026-06-22]

**Decision:** `ai.modefit.app://auth/callback` is the sole valid Supabase redirect URL.

**Supersedes:** `mode://auth/callback` — deprecated, now rejected by startup validation.

**Behavior:**
- Magic-link tokens are parsed from the URL fragment first (`#access_token=…`), then query params as fallback. Fragment and query sources are never merged.
- On successful `supabase.auth.setSession`, the returned session is written directly to React state. The app does not depend on `onAuthStateChange` emitting for the session to take effect.
- Startup validation (`src/app/startupConfig.js`) requires `EXPO_PUBLIC_SUPABASE_REDIRECT_URL === 'ai.modefit.app://auth/callback'`. Any other value shows a config error screen and blocks the app from loading.

**Files:** `src/app/App.js`, `src/app/startupConfig.js`

---

## Auth: Magic-Link Session Establishment [2026-06-22]

**Decision:** Session establishment after magic-link auth does not depend on `onAuthStateChange` emitting. `supabase.auth.setSession` result is written directly to React state.

**Rationale:** Supabase does not guarantee `onAuthStateChange` fires in all deep-link entry scenarios on React Native / Expo. Direct state update is the safe path.

**Contract:**
- `setSession` success → write `data.session` to local React state → bootstrap fires
- `setSession` throws → show "Unable to complete sign-in." error
- `setSession` resolves with `{ error }` → same error path as above
- Auth-state event is a secondary signal, never the primary one for magic-link flows

**Files:** `src/app/App.js`

---

## Auth: iOS URL Scheme Registration [2026-06-22]

**Decision:** The registered iOS URL scheme is `ai.modefit.app`. `mode://` is no longer registered as a URL scheme.

**Note:** `bundleIdentifier: "ai.modefit.app"` is the App Store identity — it does NOT auto-register as a URL scheme. Scheme registration comes from `"scheme"` in `app.json` only.

**Files:** `app.json`

**Build required:** Yes — scheme registration is a native binary change. Expo Go and existing dev client builds will not pick it up.

---

## RLS + GRANT: `app_feedback_reports` Permission Denied [2026-07-03]

**Decision:** Grant `SELECT, INSERT` to the `authenticated` role on `app_feedback_reports` via additive migration.

**Root cause:** The table was created with RLS policies but no explicit GRANT. Supabase/Postgres requires both. Confirmed `42501` from live staging error text.

**`trainer_assignment_events`:** Checked — intentionally service-role-only (no `authenticated` grant). Not related to this bug.

**Cleanup:** Removed unused `get_trainer_context` dependency from `submit_report`. The endpoint only uses `user` + `supabase`; trainer context was never read from this route.

**Files:** `backend/sql/20260703a_grant_app_feedback_reports_authenticated.sql`, `backend/app/api/v1/feedback.py`

---

## Routing: Trainer Nav "Legacy" Label Is Not Dead Code [2026-07-19]

**Decision:** `TRAINER_TABS_LEGACY` / `trainerNavMode === 'legacy'`
(`src/features/navigation/components/LiquidBottomNav.js:33-38,118`) is live, reachable code —
the flag-off branch of `TRAINER_ROUTE_FOUNDATION_ENABLED` (default `true`). It must not be
removed, deprioritized, or skipped in testing on the assumption that "legacy" means "unused."

**Rationale:** Surfaced by the UI/UX architecture audit
(`docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md`); the naming was found to be misleading
relative to actual code liveness.

**Related:** Two adjacent, lower-stakes doc decisions from the same audit (legacy color/radius
alias deprecation in `lib/theme.js`; a removal policy for confirmed-dead component exports) are
recorded in full in `MODE_PRODUCT_PRINCIPLES.md` §8 — not duplicated here since they don't
affect auth/security/routing/tenant behavior, matching this file's stated scope.

**Files:** `src/features/navigation/components/LiquidBottomNav.js`, `src/app/App.js`
