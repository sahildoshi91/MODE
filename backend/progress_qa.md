# Progress Analytics QA Playbook

## Local Runtime Alignment

1. Start backend from repo code:
   ```bash
   cd backend
   python3 main.py
   ```
2. Confirm preflight checks:
   ```bash
   curl -sS -D - http://127.0.0.1:8000/healthz
   curl -sS http://127.0.0.1:8000/openapi.json | rg '"/api/v1/checkin/progress"'
   curl -sS -D - http://127.0.0.1:8000/api/v1/checkin/progress
   ```
3. Expected:
   - `/healthz` returns `200`.
   - `/openapi.json` includes `"/api/v1/checkin/progress"`.
   - unauthenticated `/api/v1/checkin/progress` returns `401` (not `404`).

## Staging Preflight

Run the same 3 checks against the staging API base URL:

```bash
BASE_URL="https://<staging-host>"
curl -sS -D - "$BASE_URL/healthz"
curl -sS "$BASE_URL/openapi.json" | rg '"/api/v1/checkin/progress"'
curl -sS -D - "$BASE_URL/api/v1/checkin/progress"
```

Expected outcomes are the same as local.

## Backend Automated Checks

```bash
cd backend
./venv/bin/pytest -q tests/test_config.py
./venv/bin/pytest -q tests/test_daily_checkin_api.py -k "progress"
```

## Frontend Manual Checks

1. Sign in with a client account that has trainer assignment.
2. In Profile tab, confirm `API Base` is the intended host.
3. Open Progress tab and verify:
   - Current streak renders.
   - 7-day consistency renders.
   - Recent check-ins table renders.
4. Pull-to-refresh on Progress and confirm data reloads.
5. In development builds, if Progress fails, confirm diagnostics show:
   - HTTP status
   - request id
   - API base
   - attempted hosts

## Common Failure Signatures

- `404 Not Found` on `/api/v1/checkin/progress`:
  - App is pointed at stale/wrong backend runtime.
  - Fix by restarting backend from current repo and re-checking OpenAPI.
- `401 Invalid or expired session`:
  - Auth token missing/expired.
- `400 No client assignment found`:
  - Authenticated user has no linked client context.
