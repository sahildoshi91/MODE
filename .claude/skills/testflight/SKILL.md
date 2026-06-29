---
name: testflight
description: Build and optionally submit a MODE iOS TestFlight release via EAS. Use when the user wants to queue a TestFlight build, run release pre-flight checks, or submit a build to App Store Connect.
---

# TestFlight Build

Use this skill to queue a MODE iOS build via EAS and optionally submit it to TestFlight.

## Intent Parsing

Map the user's args to the correct script invocation **before running anything**:

| User types | Command |
|------------|---------|
| `/testflight` (no args) | Ask: build only, or build + submit? Then run. |
| `/testflight submit` | `bash scripts/testflight.sh --submit` |
| `/testflight preflight` | `bash scripts/testflight.sh --preflight-only` |
| `/testflight dirty` | `bash scripts/testflight.sh --allow-dirty --allow-any-branch` |
| `/testflight dirty submit` | Confirm intent, then `bash scripts/testflight.sh --allow-dirty --allow-any-branch --submit` |
| `/testflight skip security` | Ask for explicit confirmation, then `bash scripts/testflight.sh --skip-security` |

If no args, ask this single question before doing anything else:

> Build only, or build and submit to TestFlight?

## Steps

1. Run `git status --short` and `git branch --show-current`. Report the branch and tree state.
2. Run `bash scripts/testflight.sh` with flags derived from the intent table above.
3. Surface the EAS dashboard URL if the script prints one.
4. If the script fails mid-run, print the next-step block manually:
   - Fix the reported issue
   - Re-run with the same command

## Failure Handling

| Failure | Tell the user |
|---------|---------------|
| EAS auth error | Run `npx eas-cli login` then retry |
| Dirty working tree | Commit or stash first. If intentional, re-run with `/testflight dirty submit` |
| Wrong branch | Switch to `main`, or re-run with `/testflight dirty` to override |
| Security gate failure | Print the **name of the failing gate** and the last non-empty error line |
| `autoIncrement` missing | Add `"autoIncrement": true` to `eas.json → build.production` and re-run |

## Guardrails

- Do NOT add `--skip-security` unless the user explicitly asks.
- Do NOT edit `eas.json`, `app.json`, or `package.json` as part of this skill.
- Do NOT call `eas submit` or `npx eas-cli` directly — the script handles all EAS calls.
- Do NOT suggest amending published commits or force-pushing as part of the build flow.
- Do NOT skip the preflight-only verification step if the user seems uncertain about state.
