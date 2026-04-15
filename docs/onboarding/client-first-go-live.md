# Client-First Onboarding Go-Live

## 1) Database
Run these in your target Supabase project SQL editor:

```sql
backend/sql/20260414_client_first_onboarding_foundation.sql
```

Optional invite code seeding template:

```sql
backend/sql/20260414b_seed_trainer_invite_codes_template.sql
```

## 2) Backend Deploy
Deploy backend with these routes enabled:

- `GET /api/v1/onboarding/bootstrap`
- `POST /api/v1/onboarding/role`
- `PATCH /api/v1/onboarding/state`
- `POST /api/v1/onboarding/complete`
- `POST /api/v1/analytics/mobile-events`
- `POST /api/v1/trainer-assignment/assign-by-invite`

## 3) Mobile App Deploy
Ensure app deep-link scheme and auth config:

- `app.json` includes `"scheme": "mode"`
- Root env includes `EXPO_PUBLIC_SUPABASE_REDIRECT_URL=mode://auth/callback`

## 4) Supabase Auth Dashboard
In Supabase Auth settings:

- Add `mode://auth/callback` to allowed Redirect URLs.
- Enable Apple provider with valid credentials.
- Enable Google provider with valid credentials.
- Keep Email OTP enabled and redirecting to `mode://auth/callback`.

## 5) Smoke Validation
Run minimum checks after deploy:

1. Welcome -> Preview -> Auth renders and navigates.
2. Apple/Google/email OTP starts and callback returns to app.
3. Role selection persists.
4. Client onboarding completes: attach optional -> quick win -> setup -> system ready.
5. Trainer role (non-provisioned) lands on trainer stub screen.
6. Unassigned client opening Coach tab sees guard and can attach via invite code.
7. Returning complete users bypass onboarding.
8. Partial onboarding users resume at saved step.
9. API endpoints above return `200` for valid authenticated requests.
