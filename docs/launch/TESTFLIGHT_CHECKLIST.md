# MODE TestFlight Checklist

Planning date: 2026-05-25

## Build Readiness
- [ ] Bundle identifier is final and owned by the correct Apple Developer team.
- [ ] App display name, icon, splash, version, and build number are final for the candidate.
- [ ] IPA is signed/exported through an approved release path, not an unsigned local artifact.
- [ ] Artifact scan passes with no LAN/local/staging API URL, stale Expo metadata, debug flag, fixture token, or obvious secret.
- [ ] `ai.modefit.app://auth/callback` and associated domains are verified on a clean install.

## Demo Account Readiness
- [ ] Reviewer demo credentials or deterministic invite/onboarding instructions are prepared.
- [ ] Demo account has a valid tenant/trainer/client context.
- [ ] Demo account can reach coach chat without manual database changes.
- [ ] Sacrificial account exists for account deletion request smoke testing.

## Reviewer Notes
- [ ] State MODE is AI-generated fitness coaching/accountability, not medical advice.
- [ ] Explain how to sign in and complete onboarding.
- [ ] Explain trainer assignment/invite limitations for v1.
- [ ] Explain account deletion request behavior as asynchronous processing.
- [ ] Document that v1 is free beta/free tier and has no IAP.

## Privacy / Terms / Support Links
- [ ] `EXPO_PUBLIC_PRIVACY_POLICY_URL` points to a live Privacy Policy.
- [ ] `EXPO_PUBLIC_TERMS_URL` points to live Terms of Service.
- [ ] `EXPO_PUBLIC_SUPPORT_URL` points to a live support/contact destination.
- [ ] Links are visible in the app settings/profile surface.

## Account Deletion Flow
- [ ] User can initiate deletion in-app.
- [ ] Confirmation is required before submitting.
- [ ] UI says request submitted/processing, not deletion complete.
- [ ] Backend returns the expected accepted/queued state.
- [ ] Privacy policy describes deleted, anonymized, retained, and manually processed data.

## AI Disclaimer
- [ ] Onboarding/auth surface shows concise AI fitness disclaimer.
- [ ] Chat or profile surface shows concise AI fitness disclaimer.
- [ ] No App Store copy claims diagnosis, rehab, injury treatment, supplements, eating-disorder care, or extreme transformation guarantees.

## Streaming Chat Smoke Tests
- [ ] First chat request creates or resumes the expected session.
- [ ] Stream emits status/token/done or a safe controlled error.
- [ ] Provider timeout returns a safe user-facing failure.
- [ ] `CHAT_ENABLED=false`, `STREAMING_ENABLED=false`, and `LLM_PROVIDER_ENABLED=false` are tested in staging-like config.

## Weak Network Tests
- [ ] Slow network still shows progress or retry-safe failure.
- [ ] Airplane-mode send fails with user-safe copy.
- [ ] Retry does not duplicate visible assistant messages.
- [ ] Background/foreground during stream does not corrupt session state.

## Auth Tests
- [ ] Apple sign-in works.
- [ ] Google sign-in works.
- [ ] Email OTP works.
- [ ] Returning user resumes the correct state.
- [ ] Unassigned client sees trainer assignment guard.

## Crash / Log Monitoring
- [ ] Crash reporting or App Store Connect crash monitoring owner is assigned.
- [ ] Backend structured logs capture request IDs, tenant/trainer presence, provider, timeout, rate limit, and stream outcome without raw chat content.
- [ ] Launch runbook names who watches logs during internal and external TestFlight rollout.
