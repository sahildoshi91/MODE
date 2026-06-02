---
name: design-team
description: Orchestrates the full MODE design pipeline for any UI/design task. Combines ui-ux-pro-max (rules & data engine), impeccable (methodology engine), and frontend-design (aesthetic engine) — automatically selects the right pipeline for new screens, component improvements, reviews, or targeted fixes. React Native only. Use when the user asks to create, improve, review, fix, or audit any MODE UI surface.
version: 1.0.0
user-invocable: true
argument-hint: "[create|improve|review|fix|audit] [target description]"
---

Runs the full MODE design pipeline — context load, design system generation, intent routing, and delivery gate — so you never have to pick which design skill to invoke manually.

---

## Phase 0 — Setup (always runs before anything else)

### 0a. Load impeccable context

```bash
node .claude/skills/impeccable/scripts/load-context.mjs
```

Consume the full JSON output. Never pipe it through `head`, `tail`, or `jq`.

- If `hasProduct` is false or the content is <200 chars or contains `[TODO]` markers: run `/impeccable teach` to create PRODUCT.md, then resume the original task.
- If `hasDesign` is false: nudge once ("Run `/impeccable document` for more on-brand output"), then proceed.
- Skip this step if `load-context.mjs` was already run earlier in this session. Exception: re-run if `/impeccable teach` or `/impeccable document` just executed (they rewrite the files).

### 0b. Generate design system for the specific task

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<2–4 task keywords>" --design-system --stack react-native
```

Consume full output: style recommendation, palette, typography, effects, and anti-patterns. Use these as the baseline constraints for every design decision in this session.

If the task is narrow (e.g., a single button fix), skip the full `--design-system` flag and use a targeted domain search instead:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <ux|style|typography|color|react>
```

---

## Phase 1 — Intent Routing

Map the first word of the user's argument to a pipeline. If no keyword is given, read the target description and infer the most specific route.

| Intent keyword | Pipeline |
|---|---|
| `create` / `build` / `new` | **frontend-design** aesthetic framing → `/impeccable shape [target]` → `/impeccable craft [target]` |
| `improve` / `enhance` / `update` | `/impeccable shape [target]` → pick targeted sub-command: `bolder`, `layout`, `typeset`, `colorize`, `animate`, or `delight` |
| `review` / `critique` | `/impeccable critique [target]` → `/impeccable audit [target]` → `/impeccable polish [target]` |
| `fix` / `clarify` / `adapt` | direct `/impeccable <command> [target]` — pick the tightest matching command |
| `audit` | `/impeccable audit [target]` → `/impeccable harden [target]` |
| (no keyword / ambiguous) | Read the target surface, then pick the most specific route above |

### frontend-design aesthetic framing (create/build path only)

Before invoking `/impeccable shape`, commit to a bold aesthetic direction using these defaults:

1. **Physical scene** (canonical for client-facing surfaces): *"A client checking today's training plan and coach messages on their phone — gym, office, or at home — ambient light varies. They want clarity fast."* For trainer-platform surfaces, use: *"A trainer at a desk or gym reviewing client data and AI-drafted responses, managing multiple clients in a session."* Do not invent a new scene — only override if the target surface is genuinely neither of these.
2. **Color strategy**: Committed — one saturated blue accent carries 30–60% of interactive elements. Deep navy backgrounds. Do not collapse to Restrained by reflex.
3. **Differentiating quality** — name the one thing someone will remember about this specific screen.

Hand all three into `/impeccable shape` as the starting brief.

---

## Phase 2 — Priority Resolution

When skill outputs conflict, apply this strict order. **Lower number = higher priority = wins.**

### 1. MODE project constraints (highest priority)

- **Stack**: React Native only. No HTML/CSS APIs, no SwiftUI, no web-only browser APIs.
- **Component library**: reach for `lib/components` first. Standard components:
  - `ModeButton`, `ModeCard`, `ModeText`, `ModeInput`, `InlineFeedback`
  - `ModeListItem`, `ModeChip`, `StateBadge`, `EmptyState`, `HeaderBar`, `SafeScreen`
  - Glass tier: `GlassCard`, `GlassRow`, `GlassSurface`, `GlassButtonPrimary`, `GlassButtonSecondary`, `GlassInputBar`, `GlassPill`, `GlassToggle`, `AtmosphereBackground`
  - Premium tier: `PremiumGlassCard`, `PremiumButton`, `PremiumChip`, `PremiumTabBar`
  - Only go fully custom when no existing component covers the need.
- **Theme tokens**: always use `theme.*` — never hardcode hex values or raw `px` numbers.
  - Colors: `theme.colors.background.*`, `theme.colors.surface.*`, `theme.colors.text.*`, `theme.colors.border.*`, `theme.colors.accent.*`, `theme.colors.status.*`, `theme.colors.glass.*`, `theme.colors.cta.*`
  - Spacing: `theme.spacing[n]` (array: 0=4, 1=8, 2=12, 3=16, 4=20, 5=24, 6=32) or `theme.space[n]`
  - Radii: `theme.radii.xs/s/m/l/xl/pill/card/chip`
  - Typography: `theme.typography.*` (display, h1–h3, body1–body3, label, button, etc.)
  - Motion: `theme.motion.spring`, `theme.animation.duration.*`
  - Mode states: `theme.modes.build/beast/recover/rest/fallback`
- **State management**: hooks only. No Redux, no Zustand, no new context providers unless explicitly scoped.
- **No new navigation libraries or API client patterns** unless the task explicitly requires it.
- **No comments in output code** unless the WHY is non-obvious (a hidden constraint, workaround, or surprising invariant).

### 2. Impeccable absolute bans (non-negotiable, match-and-refuse)

If you're about to write any of these, rewrite the element with different structure:

- **Side-stripe borders**: `border-left` / `border-right` >1px as colored accent. Use full borders, background tints, or nothing.
- **Gradient text**: `background-clip: text` + gradient. Use solid color. Emphasize via weight or size.
- **Glassmorphism as default**: blur + glass card used decoratively. Purposeful only — or nothing.
- **The hero-metric template**: big number + small label + supporting stats + gradient accent. SaaS cliché.
- **Identical card grids**: same-sized cards with icon + heading + text, repeated.
- **Modal as first thought**: exhaust inline / progressive alternatives first.

### 3. ui-ux-pro-max critical rules (Priority 1–2, CRITICAL)

- **Accessibility**: 4.5:1 contrast ratio for normal text; 3:1 for large text. Alt text / `accessibilityLabel` on meaningful images. VoiceOver reading order matches visual order. `accessibilityRole` on all interactive elements.
- **Touch targets**: all interactive elements ≥44×44pt. Use `hitSlop` to extend hit area when the visual is smaller.
- **Loading states**: disable button and show feedback during async operations. Never leave the user with a frozen UI.
- **No hover-only interactions**: tap/press is the primary event.

### 4. Impeccable shared design laws

- **Color**: Use OKLCH. Tint every neutral toward the brand hue (chroma 0.005–0.01). No pure `#000` or `#fff`.
- **Theme**: derive from the physical scene sentence (written in Phase 1). Dark is MODE's default — the scene sentence confirms it.
- **Typography**: body line length ≤75ch. Hierarchy via scale + weight contrast (≥1.25× between steps). Avoid flat scales.
- **Layout**: vary spacing for rhythm. Cards only when they're the best affordance. Never nest cards.
- **Motion**: `transform`/`opacity` only. Ease-out with exponential curves. No bounce, no elastic. Respect `prefers-reduced-motion`.
- **Copy**: every word earns its place. No em dashes.

### 5. frontend-design aesthetic direction

- Commit to a bold, distinctive direction. Vary across screens. No generic AI aesthetics (no Inter/Roboto/Arial, no purple-gradient-on-white, no cookie-cutter layouts).
- Match implementation complexity to the aesthetic vision: maximalism needs elaborate code; minimalism needs precision.

### 6. ui-ux-pro-max supplemental rules (Priority 3–10)

Apply in order: Performance → Style selection → Layout/Responsive → Typography/Color → Animation → Forms/Feedback → Navigation → Charts/Data. Consult the full Quick Reference in `ui-ux-pro-max/SKILL.md` for specific checks.

---

## Phase 3 — MODE-Specific Design Constraints

Apply these on top of all skill outputs:

**Dark theme is the default.** MODE's physical scene: *"a client checking today's training plan and coach messages on their phone — gym, office, or at home — ambient light varies."* This resolves to dark surfaces. Confirm or explicitly override per surface.

**Aesthetic position**: premium, focused, human. Not flashy/gamified, not clinical/medical, not generic SaaS. Restrained → Committed on the color commitment axis: one strong blue accent (`theme.colors.accent.primary`), deep navy backgrounds (`theme.colors.background.app`), glass surfaces with controlled blur.

**MODE state system**: screens can adapt to the user's current mode (build/beast/recover/rest). When a surface is state-aware, use `theme.modes.*` tokens. When it's not, use the `fallback` mode tokens or static `theme.colors.*`.

**Onboarding and check-in surfaces**: calm, low-cognitive-load. Pill selectors for choices (`theme.radii.pill`, `theme.colors.accent.soft` for selected state). Tinted summary cards, no nested cards. One primary action per screen.

**Safe area compliance**: all fixed headers, tab bars, and bottom CTA bars must account for Expo safe area insets (`SafeAreaView` or `useSafeAreaInsets()`). Never place tappable content under the notch, status bar, or gesture bar.

**Trainer-platform surfaces** (trainerPlatform, trainerCoach, trainerClients, trainerAssistant, trainerReview): follow the same system but lean more informational — data-dense cards, list patterns, section headers. Glass tier components are appropriate here.

---

## Phase 4 — Delivery Gate

This gate is not optional. Do not mark the task complete until every checkbox is explicitly verified.

Before reporting work as done, verify every item:

**Component & token compliance**
- [ ] All new components use `lib/components` or extend them correctly
- [ ] All colors/spacing reference `theme.*` tokens — no raw hex or px
- [ ] No emoji used as icons (use `@expo/vector-icons` or SVG)

**Interaction quality**
- [ ] Touch targets ≥44pt on all interactive elements
- [ ] Async operations show loading state and disable buttons during submission
- [ ] All interactive elements have `accessibilityRole` and `accessibilityLabel`

**Visual correctness**
- [ ] Impeccable absolute bans are absent from the output
- [ ] Dark mode contrast: primary text ≥4.5:1, secondary ≥3:1 on dark surfaces
- [ ] No nested cards, no modal-as-first-thought
- [ ] Safe area insets respected on fixed/sticky elements

**Scope**
- [ ] No changes to surfaces outside the task scope (per CLAUDE.md keep-changes-scoped rule)
- [ ] No new navigation patterns, state management libraries, or API client changes introduced incidentally

---

## Quick-Reference: Which Sub-Command to Pick

| User says | Use |
|---|---|
| "make it bolder / more impactful" | `/impeccable bolder` |
| "tone it down / too aggressive" | `/impeccable quieter` |
| "add animation / motion" | `/impeccable animate` |
| "improve the layout / spacing" | `/impeccable layout` |
| "improve the typography / fonts" | `/impeccable typeset` |
| "add color / too monochromatic" | `/impeccable colorize` |
| "simplify / strip back" | `/impeccable distill` |
| "add personality / delight" | `/impeccable delight` |
| "make it production-ready / harden" | `/impeccable harden` |
| "fix the copy / labels" | `/impeccable clarify` |
| "make it responsive / fix on small screen" | `/impeccable adapt` |
| "full UX review" | `/impeccable critique` → `/impeccable audit` |
| "final polish before shipping" | `/impeccable polish` |
| "live iteration in browser" | `/impeccable live` |
