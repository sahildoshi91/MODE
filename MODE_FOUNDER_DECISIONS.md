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
