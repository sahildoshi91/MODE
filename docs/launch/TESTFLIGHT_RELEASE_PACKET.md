# MODE TestFlight Release Packet

## App Store Connect Source of Truth

App Name: MODE AI Fitness
Bundle ID: ai.modefit.app
SKU: MODE-001
Apple ID: 6782200470
Primary Language: English (U.S.)
Primary Category: Health & Fitness
Secondary Category: Lifestyle
Subtitle: AI Personal Trainer
Company: MODE Fitness Labs LLC
Domain: modefit.ai
Support Email: ops@modefit.ai

## Beta App Description

MODE AI Fitness is an AI fitness coaching app that helps clients talk through goals, schedule constraints, preferences, injuries, readiness, and training progress. The beta focuses on the core coaching chat, onboarding, daily check-ins, account settings, and early trainer-aware workflows.

This TestFlight build is for validating the first mobile client experience before public release. It should be treated as a beta product: coaching responses may be imperfect, trainer assignment may be limited, and support may be needed to reset or provision test accounts.

## What To Test

- Create an account or sign in with the provided test credentials.
- Complete client onboarding and confirm the app routes you to the right first screen.
- Send messages in coach chat and verify streaming responses appear without blank screens or crashes.
- Complete a daily check-in and confirm the coaching context reflects the latest check-in.
- Open profile/settings and verify legal, support, and account management surfaces.
- Submit an account deletion request only with a sacrificial test account.
- Exercise trainer/client assignment flows only with accounts that have been provisioned for that role.

## Tester Instructions

1. Install the latest TestFlight build.
2. Sign in with the provided beta credentials or complete the invited signup path.
3. Complete onboarding using realistic but non-sensitive fitness information.
4. Send at least three chat messages: one goal question, one schedule question, and one workout adjustment request.
5. Complete a daily check-in and return to chat.
6. Report failures with the screen name, time, account email, and a screenshot if possible.

## Known Limitations

- MODE provides AI-generated fitness coaching and accountability, not medical advice.
- Test accounts may require manual trainer/client assignment before all trainer-aware surfaces work.
- Some advanced trainer platform workflows are still beta/internal and may not be available to every tester.
- Streaming chat depends on the staging backend and may show a retry-safe error during backend deploys or provider timeouts.
- Account deletion is submitted for processing; it may not complete instantly inside the app.
- The first TestFlight build is expected to target staging unless production backend readiness is explicitly approved.

## Apple Review Notes

MODE AI Fitness is a free beta app for AI-generated fitness coaching and accountability. It does not provide medical diagnosis, injury treatment, rehabilitation, eating-disorder care, supplement prescriptions, or emergency advice.

If reviewer credentials are required, provide a demo account with an assigned client/trainer context before submission. The reviewer should be able to sign in, complete onboarding if needed, open coach chat, send a message, complete a daily check-in, view legal/support links, and submit an account deletion request from settings.

No in-app purchases are included in this beta build.

## Support Contact

Support Email: ops@modefit.ai
Support URL Placeholder: https://modefit.ai/support
Domain: https://modefit.ai

## Privacy And Legal Placeholders

Privacy Policy Placeholder: https://modefit.ai/privacy
Terms Placeholder: https://modefit.ai/terms
Support URL Placeholder: https://modefit.ai/support

Before external TestFlight review, confirm these URLs are live and match App Store Connect metadata.

## Internal Testing Steps

1. Confirm `.env.release` uses `EXPO_PUBLIC_API_BASE_URL=https://mode-backend-staging.onrender.com` or an approved production HTTPS API URL.
2. Confirm no release build config references `localhost`, `127.0.0.1`, `192.168.x.x`, or `10.x.x.x`.
3. Build with the production EAS profile and EAS-managed or Apple-approved signing credentials.
4. Install through TestFlight on at least one clean iPhone.
5. Smoke test signup/login, onboarding, chat streaming, daily check-in, legal links, and account deletion request.
6. Watch backend logs and App Store Connect crash reports during the test window.

## External Testing Steps

1. Prepare tester list and assign a support owner for the rollout window.
2. Provide each tester with invite instructions, beta scope, and the support email.
3. Confirm demo or invited accounts have valid trainer/client context where needed.
4. Start with a small cohort before expanding external testers.
5. Track failures by build number, account email, timestamp, and backend request ID when available.

## First-Build Smoke Checklist

- [ ] Bundle ID is `ai.modefit.app` in Expo and native iOS project settings.
- [ ] App display name, icon, splash, version, and build number are acceptable for the first beta.
- [ ] TestFlight build points to staging or production HTTPS, never LAN or localhost.
- [ ] EAS credentials/signing are configured for the Apple Developer team that owns `ai.modefit.app`.
- [ ] `ai.modefit.app://auth/callback` works on a clean install.
- [ ] Privacy, terms, and support links are live or intentionally documented as placeholders.
- [ ] Reviewer/demo account exists and can reach coach chat without manual database edits.
- [ ] Chat streaming returns a response or a controlled retry-safe error.
- [ ] Daily check-in can be completed.
- [ ] Account deletion request can be submitted from settings.
- [ ] No secrets are committed or copied into App Store Connect notes.
