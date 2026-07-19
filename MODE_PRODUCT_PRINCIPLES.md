# MODE Product Principles — Design Token System v2

## 1. Purpose & Status

This document is the canonical source for the MODE design token system v2.
Status: **pilot**. The v2 layer is additive, dark-only, and flag-gated behind
`EXPO_PUBLIC_THEME_V2_ENABLED` (default off). The only pilot surface is the
client home screen (`src/features/home/screens/AlgorithmHomeScreen.js`). No
other surface may consume v2 tokens until its own pilot PR is approved.

Token source of truth in code: `lib/theme/tokens.js` and `lib/theme/modes.js`.
Those files and this document must match exactly at all times.

## 2. Canonical v2 Token Spec

> **Approved v2 spec — do not modify without founder sign-off.**

Scope: **dark-only**. There is no light-mode variant of these tokens; do not
derive one.

### Surfaces

| Token | Fill | Border |
| --- | --- | --- |
| `page` | `#080B14` | — |
| `surface1` | `rgba(255, 255, 255, 0.045)` | `rgba(255, 255, 255, 0.08)` |
| `surface2` | `rgba(255, 255, 255, 0.075)` | `rgba(255, 255, 255, 0.13)` |
| `surface3Opaque` (canonical) | `#0E121E` | `rgba(255, 255, 255, 0.16)` |
| `surface3Overlay` (comparison only, NOT canonical) | `rgba(255, 255, 255, 0.10)` | `rgba(255, 255, 255, 0.18)` |

### Text

| Token | Value |
| --- | --- |
| `primary` | `#F3F5FA` |
| `secondary` | `#8B93A9` |
| `tertiary` | `#525A70` |

### Spacing

`4, 8, 12, 16, 24, 32, 48, 64`

### Radius

| Token | Value |
| --- | --- |
| `sm` | `10` |
| `md` | `16` |
| `lg` | `24` |
| `pill` | `999` |

### Typography

System font only — no font packages. The `data` role uses React Native's
built-in `fontVariant: ['tabular-nums']` for stable digit alignment.

| Role | Size | Weight | Other |
| --- | --- | --- | --- |
| `display` | 26 | `700` | letterSpacing `-0.2` |
| `body` | 15 | `400` | lineHeight `21` |
| `bodyEmphasis` | 15 | `500` | lineHeight `21` |
| `data` | 20 | `600` | letterSpacing `0.3`, `fontVariant: ['tabular-nums']` |

### Mode Accents

| Mode | Accent | Wash |
| --- | --- | --- |
| `beast` | `#FF6152` | `rgba(255, 97, 82, 0.14)` |
| `build` | `#4F8DFF` | `rgba(79, 141, 255, 0.14)` |
| `recover` | `#7CC48A` | `rgba(124, 196, 138, 0.14)` |
| `rest` | `#A78BFA` | `rgba(167, 139, 250, 0.14)` |

Mode resolution matches only `BEAST`, `BUILD`, `RECOVER`, `REST` (after
trim + uppercase). Anything else resolves to `null` and the surface renders
its v1 path. There is no default v2 mode and no neutral v2 accent.

## 3. Elevation Rule & Decision Record

Elevation is expressed solely by stepping `surface1 → surface2 → surface3`
over `page`. No colored shadows or glows may be used to express elevation.

**Decision record (2026-07-03):** Model A (`surface3Opaque`, an opaque sheet
darker than the overlays beneath it) is confirmed canonical. Model B
(`surface3Overlay`, Material-style white overlay) exists only as a temporary
`__DEV__`-gated comparison inside the home pilot (long-press the mode headline
in a dev build). It is a design-review tool, not a product feature, and is
unreachable in production builds — the production code path is hard-coded to
`surface3Opaque`. Once the founder picks a model on-device, the losing token
and the toggle are deleted in a follow-up cleanup PR.

## 4. Mode-Accent Usage Limits

- `accent` is reserved for the mode headline and small interactive glyphs
  (icons, save affordances). Never use it for body text or large fills.
- `wash` is reserved for atmosphere gradients and soft accent fills (e.g.
  save-button backgrounds). Structural borders come from surface tokens, not
  from `wash`.
- Unresolvable mode ⇒ no accent at all: `resolveThemeV2` returns `null` by
  design and the surface falls back to v1. Do not invent a fallback accent.

## 5. Pilot-First Rollout Policy

- One surface per PR, always behind `EXPO_PUBLIC_THEME_V2_ENABLED`.
- Consume v2 via `resolveThemeV2(currentMode)` or `ThemeProvider`/`useTheme`
  from `lib/theme` — never hardcode v2 values in feature code.
- Never modify shared glass/premium primitives (`lib/components`) for v2;
  pass v2 values through their existing color props.
- Never add `lib/theme/index.js` or `lib/theme/package.json` — the module
  specifier `lib/theme` must keep resolving to the legacy `lib/theme.js` file
  for all existing importers.
- V1 render paths stay byte-identical when the flag is off or the mode is
  unresolvable.

## 6. Migration Sizing

Phase 0 hardcoded hex counts in `src/features/**` (candidates for future
token migration, one surface per PR): auth 11, chat 4, progress 6, shared 6,
trainerCoach 5.

## 7. Rollback

Disable via EXPO_PUBLIC_THEME_V2_ENABLED=false — no data migration, no backend involvement, safe to flip instantly.

Note: `EXPO_PUBLIC_*` values are inlined at JS-bundle time, so "instantly"
means a rebundle in dev or a new build/OTA update for TestFlight. Hard
rollback is a plain revert — every v2 change is additive, and the pilot's v1
expressions are preserved verbatim as ternary fallbacks.

## 8. Legacy Theme, Navigation Labeling & Dead-Code Policy

Findings and file:line citations below come from
`docs/design/MODE_UI_UX_ARCHITECTURE_AUDIT.md`, a read-only architecture audit. This section
records policy decisions in response to that audit; it does not change any code.

### 8.1 Legacy Color & Radius Aliases (Deprecated)

`lib/theme.js` contains four blocks of alias/bridge keys layered on top of the fully-qualified
token paths:

- `colors.surface` bridge keys `canvas`/`subtle`/`raised`/`muted` (`lib/theme.js:308`)
- `colors.state` bridge keys `reset`/`base`/`build`/`overdrive` (`lib/theme.js:396-400`)
- Top-level color aliases `bg`, `surfaceSoft`, `primary`, `secondary`, `accentPrimary`,
  `onPrimary`, `onSurface`, `textHigh`, `textMedium`, `textDisabled`, `divider`, `success`,
  `warning`, `error` (`lib/theme.js:456-474`)
- `radii.md`/`radii.lg` aliases (`lib/theme.js:513-515`)

**Status: deprecated.** New code should prefer the fully-qualified paths (e.g.
`theme.colors.background.app` over `theme.colors.bg`). Existing call sites are not required to
migrate — these aliases remain fully supported and byte-identical to today. No removal
timeline is set by this document; removing them is a separate, dedicated migration project
(touches ~80 importing files) and is out of scope here.

### 8.2 "Legacy" Trainer Navigation Naming Clarification

`TRAINER_TABS_LEGACY` and `trainerNavMode === 'legacy'`
(`src/features/navigation/components/LiquidBottomNav.js:33-38,118`) are **live, reachable
code** — the flag-off branch of `TRAINER_ROUTE_FOUNDATION_ENABLED` (default `true`). "Legacy"
here means "pre-Coach-OS trainer navigation," not "unused" or "dead." Do not remove,
deprioritize, or skip testing this path on the assumption that its name implies it is inactive.

### 8.3 Dead-Export Removal Policy

The audit confirmed (via repo-wide grep, zero consumers found) that the following exports are
currently dead: `PremiumTabBar`, `ModeChipLegacy`/`LegacyStaticChip`, `ModeListItem`,
`StreakRing`, `SystemCountBadge`, `AtmosphereBackground`, `GlassRow`, `GlassButtonPrimary`/
`GlassButtonSecondary`, `MacroBar`, `EmptyStateGlassPanel`, `PremiumButton`,
`PremiumGlassCard`.

**Policy:** an export with zero repo-wide consumers, re-confirmed via grep at removal time,
should be removed within a bounded window in its own standalone PR — never bundled into
unrelated doc or feature work. This document does not delete the exports above; it establishes
the policy so confirmed-dead code stops accumulating silently, which is how the audit's nine
orphaned screen files likely built up over time.
