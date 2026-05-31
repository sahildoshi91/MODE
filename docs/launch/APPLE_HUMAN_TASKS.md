# Apple Human Tasks

Planning date: 2026-05-25

These tasks require Apple Developer/App Store Connect access, business records, or legal/product judgment. Codex should not invent values for them.

| Task | Required Evidence | Owner | Status |
| --- | --- | --- | --- |
| Final Bundle ID decision | Final identifier replaces `com.anonymous.mode` only after owner approval | Founder/App Store owner | Open |
| Apple Developer Organization account | Active organization membership for MODE | Founder | Open |
| D-U-N-S number | D-U-N-S verified or Apple accepted alternative path | Founder | Open |
| Apple Team ID | Team ID recorded for signing and CI/export setup | Founder/Mobile owner | Open |
| App Store Connect app record | App name, SKU, bundle ID, category, and availability created | App Store owner | Open |
| Privacy Policy URL | Verified 2026-05-31: `https://modefit.ai/privacy.html` redirects to `/privacy` and returns 200 | Legal/privacy owner | Done |
| Terms URL | Verified 2026-05-31: `https://modefit.ai/terms.html` redirects to `/terms` and returns 200 | Legal/privacy owner | Done |
| Support URL | Verified 2026-05-31: `https://modefit.ai/support.html` redirects to `/support` and returns 200 | Support owner | Done |
| App Privacy labels | Health/fitness, identifiers, diagnostics, usage data, tracking, deletion, and retention answers reviewed | Legal/privacy owner | Open |
| Age rating | App Store age questionnaire completed honestly | Product owner | Open |
| Reviewer demo credentials | Credentials or deterministic invite/onboarding path prepared | QA/App Store owner | Open |
| Screenshots | Current iPhone screenshots of shipped app flows | Product owner | Open |
| Export compliance | Encryption/export questions answered for shipped build | App Store owner | Open |
| TestFlight internal tester plan | Internal group, devices, smoke script, and feedback owner recorded | QA owner | Open |
| TestFlight external tester plan | External group scope, public-link limit if any, support capacity, and beta notes recorded | QA/App Store owner | Open |

## Reviewer Notes Checklist
- [ ] State MODE provides AI fitness coaching/accountability and is not medical advice.
- [ ] Explain sign-in and onboarding steps.
- [ ] Explain v1 trainer assignment or invite constraints.
- [ ] Explain that account deletion is requested in-app and processed asynchronously.
- [ ] State there is no IAP/payment requirement for v1 free beta.
- [ ] Provide support contact for reviewer issues.

## Do Not Do In Code
- Do not set a final bundle ID unless the approved value is documented.
- Do not create fake production URLs, credentials, or App Store metadata.
- Do not submit current unsigned/local IPA artifacts.
