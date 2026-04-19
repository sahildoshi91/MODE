# MODE Hume Glass QA Checklist

## Visual Alignment
- [ ] Global light direction reads from top-left across screens.
- [ ] No pure white text or pure black surfaces are visible in production UI.
- [ ] Glass surfaces use translucent navy fill + soft border + restrained highlight.
- [ ] Depth is produced by blur/contrast/edge-lighting, not heavy drop shadows.
- [ ] Backgrounds are atmospheric and subdued; foreground content remains dominant.

## Token / Primitive Consistency
- [ ] Core client screens render through shared glass primitives (no ad-hoc flat cards).
- [ ] `Mode*` compatibility components map to glass styling (no legacy flat variants left).
- [ ] Radius system is consistent with small/medium/large/pill usage.
- [ ] Spacing rhythm remains consistent with the updated token system.
- [ ] Motion/press interactions use shared constants (no abrupt transitions).

## Chat-First Product Fidelity
- [ ] Chat screen has premium floating input bar and compact quick action chips.
- [ ] AI/user chat bubbles are differentiated subtly, without loud color shifts.
- [ ] Retry/copy-error and typing/loading states remain functional and polished.
- [ ] Chat scrolling and keyboard behavior preserve prior interaction contracts.

## Workflow Surfaces
- [ ] Home summary reads as a calm command surface (not a cluttered dashboard).
- [ ] Workout plan cards, rows, and guided state preserve behavior and readability.
- [ ] Nutrition plan cards and macro/progress visuals remain lightweight and clear.
- [ ] Plan setup controls (pills/toggle/slider) feel embedded and consistent.

## Functional Integrity
- [ ] No backend logic, API payloads, or route contracts changed.
- [ ] Existing critical tests pass (`CoachChatScreen`, `DailyCheckin` flow, primitive suite).
- [ ] Trainer-home smoke timeout failures are tracked as pre-existing unless impacted.
- [ ] Manual QA completed for nav transitions, safe-area handling, and bottom dock overlap.

## Performance Guardrails
- [ ] iOS blur layers are limited to primary surfaces and input/nav docks only.
- [ ] Android fallback avoids stacked expensive blur effects.
- [ ] Chat/workout list scrolling remains smooth after glass migration.
