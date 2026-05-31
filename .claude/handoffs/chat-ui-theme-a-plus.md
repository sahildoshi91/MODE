# Handoff: CoachChatScreen — Theme A+ Visual Redesign

## Completed Work

### `lib/theme.js` ✅ DONE
- `accent.primary` → `#4068F5` (was `#7BA2FF`)
- `accent.soft` → `rgba(64,104,245,0.18)`
- `accent.glow` → `rgba(30,64,200,0.35)`
- `accent.gradient` → `['#1B3FCC', '#3660F0']` (new)
- `background.primary` → `#0A1120` (new)
- `text.accent` → `#4068F5` (new)
- New namespaces: `colors.bubble.{ai,user}`, `colors.chip`, `colors.input`, `colors.mode.{build,beast,recover,rest}`
- New typography: `modeLabel`, `bubbleLabel`, `bodyStrong`, `timestamp`, `chipText`, `headerName`, `headerSub`
- New radii: `bubble: 16`, `bubbleSm: 4`, `chip: 20`, `card: 18`

### `CoachChatScreen.js` — partially done

**Imports:**
- Added: `Text`, `ScrollView` (react-native), `LinearGradient` (expo-linear-gradient), `useSafeAreaInsets` (react-native-safe-area-context)
- Removed: `import ChatHeader`, `import ChatBubble`

**New constants/utils added (after `MEMORY_CAPTURE_TAG_OPTIONS`):**
- `OPENING_LABEL_PATTERN`, `OPENING_QUESTION_PATTERN`
- `parseOpeningSummary(text)` — splits text into title/subtitle/sections/question
- `getModeColor(mode)` — maps mode string to `theme.colors.mode.*`
- `isOpeningAssistantMessage(item)` — detects welcome/opening_summary messages

**New local components added (before `parseMemoryVisibilityLabel`):**
- `CoachScreenHeader` — avatar circle (LinearGradient), coach name, "● online" status, back button
- `OpeningMessageSequence` — mode badge → AI bubble 1 (title/readiness) → AI bubble 2 (T/N/M sections) → CTA bubble (question)
- `InlineBubbleUser` — LinearGradient user bubble
- `InlineBubbleAI` — frosted glass AI bubble with COACH label
- `resolveUserCorner(groupPosition)` / `resolveAICorner(groupPosition)` — corner radius helpers

**Render tree updates:**
- `<ChatHeader>` → `<CoachScreenHeader trainerName isError onBack />`
- Ambient glow `<LinearGradient>` added at top of `<SafeScreen>` (absolute, full-width, 300h, rgba(30,60,200,0.08) → transparent)

**renderItem updates:**
- `isOpeningAssistantMessage(item)` check added
- ChatBubble replaced with: `<OpeningMessageSequence>` | `<InlineBubbleUser>` | `<InlineBubbleAI>`
- `fallbackTriggered` tag inlined (was inside ChatBubble)

---

## Changed Files

| File | Status |
|---|---|
| `lib/theme.js` | ✅ Complete |
| `src/features/chat/screens/CoachChatScreen.js` | 🔄 ~80% — StyleSheet missing |

No other files touched.

---

## Open Issues

1. **StyleSheet not written yet** — `headerStyles`, `openingStyles`, `bubbleStyles` are referenced by the new components but not defined. The file has runtime errors right now.
2. `styles.screen` still uses `theme.colors.background.app` (`#08111F`) — should be `theme.colors.background.primary` (`#0A1120`).
3. `ambientGlowContainer` / `ambientGlow` style objects needed in `styles`.
4. `ScrollView` imported but not used — was pre-emptively added, can be removed if not needed by StyleSheet work.

---

## Important Decisions

- **Two-file constraint**: only `lib/theme.js` and `CoachChatScreen.js` change. All bubble/header rendering moved inline to CoachChatScreen to avoid touching GlassMessaging.js or ChatHeader.js.
- **Accent color is app-wide**: `#4068F5` cascades to all components that read `theme.colors.accent.primary` (ChatHeader, GlassControls, etc.). This is intentional.
- **text.secondary / text.muted NOT changed**: keeping existing values to avoid breaking other screens; chat-specific dim text uses `theme.colors.bubble.ai.text` instead.
- **AIResponseRenderer dropped**: inline bubbles render plain text only. Acceptable trade-off for the two-file constraint.
- **expo-linear-gradient already installed** (v55.0.13) — no new deps needed.

---

## Current Risks

- `ScrollView` in imports is unused — will trigger a lint warning. Remove if not used in StyleSheet work.
- `CoachScreenHeader` accepts no `onOpenHistory` prop — history button is absent (current CoachChatScreen never passed `onOpenHistory` to ChatHeader anyway, so behavior is identical).
- Opening message parsing relies on backend sending `Training:` / `Nutrition:` / `Mindset:` line-prefixed text or `\n`-separated content. Simple welcome messages render as a single AI bubble — intentional graceful fallback.

---

## Exact Next Steps

1. **Add `headerStyles` StyleSheet** (for `CoachScreenHeader`):
   - `header`, `row`, `backButton`, `backButtonPressed`, `backChevron`, `backPlaceholder`
   - `avatarWrap`, `avatar` (38×38, borderRadius 19), `avatarInitial`
   - `titleBlock`, `titleText` (headerName typography), `statusRow`, `statusDot`, `statusDotOnline`, `statusDotError`, `statusText`, `statusTextOnline`, `statusTextError`
   - `rightSlot`

2. **Add `openingStyles` StyleSheet** (for `OpeningMessageSequence`):
   - `container` (gap 8), `modeBadgeWrap`, `modeBadge` (pill, borderWidth 1), `modeDot` (6×6), `modeBadgeText` (modeLabel typography)
   - `bubbleWrap`, `aiBubble` (bubble.ai.bg, bubble.ai.border, radii.bubble), `aiBubbleText`, `aiBubbleSubText`
   - `coachLabel` (bubbleLabel typography, bubble.ai.label color)
   - `sectionLine`, `sectionLabel`, `sectionBody`
   - `ctaBubbleWrap`, `ctaBubble` (slightly brighter: rgba(255,255,255,0.065)), `ctaBubbleText`

3. **Add `bubbleStyles` StyleSheet** (for `InlineBubbleUser` / `InlineBubbleAI`):
   - `userRow`, `userSpeakerLabel`, `userBubble` (overflow hidden, shadow from bubble.user.shadow)
   - `userCornerSingle/Start/Middle/End` (iMessage-style radii using radii.bubble + radii.bubbleSm)
   - `userBubbleText` (bubble.user.text, body typography)
   - `aiRow`, `coachLabel`, `coachLabelError`, `aiBubble`, `aiCornerSingle/Start/Middle/End`
   - `aiBubbleText`, `aiBubbleError`, `aiBubbleTextError`

4. **Update `styles` (existing StyleSheet at bottom)**:
   - `screen.backgroundColor` → `theme.colors.background.primary`
   - Add `ambientGlowContainer: { position: 'absolute', top: 0, left: 0, right: 0, height: 300, zIndex: 0, pointerEvents: 'none' }`
   - Add `ambientGlow: { flex: 1 }`
   - Add `fallbackTag`, `userFallbackTag`, `fallbackTagText`
   - Remove `ScrollView` import if not used

5. **Run** `npm run codex:check` — start backend if needed with `npm run backend:dev`
6. **Verify** `git diff --stat` shows only `lib/theme.js` and `CoachChatScreen.js`
