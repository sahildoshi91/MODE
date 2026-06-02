# MODE — Design System

Extracted from `lib/theme.js`. All values here correspond directly to exported theme tokens.

---

## Color System

### Base Palette

| Role | Token | Value |
|---|---|---|
| App background | `theme.colors.background.app` | `#08111F` (navy950) |
| App background alt | `theme.colors.background.appAlt` | `#0B1220` (navy900) |
| Primary text | `theme.colors.text.primary` | `#E7EFFF` |
| Secondary text | `theme.colors.text.secondary` | `#C7D6F3` |
| Muted/tertiary text | `theme.colors.text.muted` | `#97ABCF` |
| Disabled text | `theme.colors.text.disabled` | `#6A7D9F` |
| Accent primary | `theme.colors.accent.primary` | `#4068F5` |
| Accent soft (tint) | `theme.colors.accent.soft` | `rgba(64,104,245,0.18)` |
| Accent glow | `theme.colors.accent.glow` | `rgba(30,64,200,0.35)` |

### Surface Tiers (glass-based)

| Role | Token | Opacity |
|---|---|---|
| Base surface | `theme.colors.surface.base` | 5% white |
| Elevated surface | `theme.colors.surface.elevated` | 6% white |
| Hero surface | `theme.colors.surface.hero` | 8% white |
| Input surface | `theme.colors.surface.input` | 7% white |
| Overlay | `theme.colors.surface.overlay` | 82% navy |
| Scrim | `theme.colors.surface.scrim` | 76% navy |

### Borders

| Role | Token | Opacity |
|---|---|---|
| Soft | `theme.colors.border.soft` | 10% white |
| Default | `theme.colors.border.default` | 12% white |
| Strong | `theme.colors.border.strong` | 14% white |
| Focus/active | `theme.colors.border.focus` | 34% blue |

### Status

| Role | Token | Value |
|---|---|---|
| Success | `theme.colors.status.success` | `#5F9E7F` (green) |
| Warning | `theme.colors.status.warning` | `#B98C60` (amber) |
| Error | `theme.colors.status.error` | `#C57A6C` (rose) |
| Info | `theme.colors.status.info` | `#8FB2FF` (blue) |

### MODE State Colors

Four dynamic mode personalities applied via `theme.modes.*`:

| Mode | Accent | Usage |
|---|---|---|
| `build` | `#7BA2FF` (blue500) | Default active state |
| `beast` | `#C57A6C` (rose420) | High-intensity effort |
| `recover` | `#5F9E7F` (green420) | Recovery focus |
| `rest` | `#4867B8` (blue360) | Low-load rest |
| `fallback` | `#7BA2FF` (blue500) | When no mode is set |

**When to activate `theme.modes.*` vs. use static tokens:**

- **Activate `theme.modes[mode]`** when the surface is explicitly state-aware: the home screen, today's check-in card, the coach chat header, or any component that reflects the user's current training mode. The mode comes from the user's session/bootstrap data.
- **Use `theme.modes.fallback`** when a surface should be mode-adaptive but no mode is available yet (e.g. loading state, onboarding before first check-in).
- **Use static `theme.colors.*` tokens** for all other surfaces: onboarding flows, trainer-platform screens, settings, profile, legal. These surfaces are mode-neutral and should not shift color based on the user's current training state.

The mode system is a personality layer, not a theme override. When in doubt, use static tokens.

---

## Typography

Platform font: **Avenir Next** (iOS), `sans-serif` (Android).

| Role | Token | Size | Weight | Line Height |
|---|---|---|---|---|
| Display | `theme.typography.display` | 36 | 700 | 42 |
| H1 | `theme.typography.h1` | 30 | 700 | 36 |
| H2 | `theme.typography.h2` | 24 | 600 | 30 |
| H3 | `theme.typography.h3` | 20 | 600 | 26 |
| Body 1 | `theme.typography.body1` | 16 | 400 | 24 |
| Body 2 | `theme.typography.body2` | 14 | 400 | 20 |
| Body 3 | `theme.typography.body3` | 12 | 400 | 16 |
| Label | `theme.typography.label` | 12 | 600 | 16 |
| Button | `theme.typography.button` | 16 | 600 | 20 |
| Body strong | `theme.typography.bodyStrong` | 15 | 600 | 22 |
| Mode label | `theme.typography.modeLabel` | 10 | 700 | — (ls: 1.4) |
| Chip text | `theme.typography.chipText` | 13 | 500 | — |

---

## Spacing

`theme.spacing` is an array: index → value in dp.

| Index | Value |
|---|---|
| 0 | 4dp |
| 1 | 8dp |
| 2 | 12dp |
| 3 | 16dp |
| 4 | 20dp |
| 5 | 24dp |
| 6 | 32dp |

Named scale (`theme.space`): 0, 4, 8, 12, 16, 20, 24, 32, 40, 48.

---

## Border Radius

| Name | Token | Value |
|---|---|---|
| Extra small | `theme.radii.xs` | 10 |
| Small | `theme.radii.s` | 16 |
| Medium | `theme.radii.m` | 20 |
| Large | `theme.radii.l` | 26 |
| Extra large | `theme.radii.xl` | 30 |
| Pill | `theme.radii.pill` | 999 |
| Card | `theme.radii.card` | 18 |
| Chip | `theme.radii.chip` | 20 |

---

## Motion & Animation

Spring physics (use with `Animated.spring` or Reanimated):

```js
theme.motion.spring = { damping: 18, stiffness: 220, mass: 0.88 }
```

Duration tokens:

| Name | Token | Value |
|---|---|---|
| Short | `theme.animation.duration.short` | 120ms |
| Normal | `theme.animation.duration.normal` | 180ms |
| Long | `theme.animation.duration.long` | 260ms |

Press interaction:
- Scale on press: `theme.interaction.pressedScale` = 0.982
- Opacity on press: `theme.interaction.pressedOpacity` = 0.9
- Disabled opacity: `theme.interaction.disabledOpacity` = 0.5

---

## Elevation & Glass

Glass blur values (`theme.glass.blur.*`):

| Surface | Blur |
|---|---|
| Background | 72 |
| Surface | 24 |
| Elevated | 28 |
| Hero | 32 |
| Nav | 24 |

Shadow tokens (`theme.shadows.soft` / `theme.shadows.medium`): dark navy base, moderate opacity.

---

## Component Library

All components imported from `lib/components`. Prefer in this order:

**Core (always reach for these first)**
- `ModeButton` — primary, secondary, ghost, destructive variants
- `ModeCard` — variant: `default` | `tinted` | `state` (with `state` prop: BASE/BUILD/RESET/OVERDRIVE)
- `ModeText` — variant: h1–h3, body, bodySm, label; tone: primary, secondary, accent
- `ModeInput` — text input with theme styling
- `InlineFeedback` — type: success | error | warning | info
- `ModeListItem`, `ModeChip`, `StateBadge`, `EmptyState`
- `HeaderBar`, `SafeScreen` (always use SafeScreen for top-level screens)

**Glass tier (elevated visual complexity)**
- `GlassCard`, `GlassRow`, `GlassSurface`
- `GlassButtonPrimary`, `GlassButtonSecondary`, `GlassInputBar`, `GlassPill`, `GlassToggle`
- `AtmosphereBackground` — layered background with depth effects
- `ChatBubbleAI`, `ChatBubbleUser`

**Premium tier (high-impact moments)**
- `PremiumGlassCard`, `PremiumButton`, `PremiumChip`
- `PremiumTabBar` — bottom navigation

**Data & feedback**
- `HeroOverlayCard`, `MiniStat`, `MacroBar`, `ProgressRing`, `SectionHeader`
- `EmptyStateGlassPanel`
- `StreakRing`, `SystemCountBadge`, `SystemSectionCard`, `SystemSectionHeader`
- `SystemActionSheet`, `SystemNavRow`, `SystemSearchBar`, `SystemIdentityHeader`

---

## Design Patterns

**Pill selectors** (for option picking, e.g. onboarding goals, quick win feelings):
```js
style: [
  { borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface.elevated },
  isSelected && { borderColor: theme.colors.accent.primary, backgroundColor: theme.colors.accent.soft }
]
```

**Summary cards** (system_ready recap, lightweight_setup review):
Use `ModeCard variant="tinted"` or `variant="state"` with appropriate `state` prop.

**Fixed footer CTAs**: wrap in a `View` that respects `useSafeAreaInsets().bottom`. Primary action on top, secondary (Back/Skip) below with `marginTop: theme.spacing[2]`.
