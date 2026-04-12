# MODE
MODE is an Expo + FastAPI project for trainer-aware AI coaching.

The current repo is centered on a working client login + chat flow on the frontend and a multi-tenant coaching foundation on the backend. Legacy duplicate screens and unused setup files have been removed so the codebase now reflects the active product direction more closely.

## Trainer Platform Planning (Phases 1-4)

Pre-implementation architecture artifacts for the trainer-side expansion live in:

```text
docs/trainer-platform/
```

This includes:
- repo audit
- protected client surface area
- target architecture
- schema/domain model
- phased implementation plan

## Active Structure

### Frontend
```text
src/
├── app/
│   └── App.js
├── features/
│   ├── auth/
│   │   └── screens/
│   │       └── Login.js
│   └── chat/
│       ├── components/
│       ├── hooks/
│       ├── screens/
│       └── services/
└── services/
    └── supabaseClient.js
```

### Backend
```text
backend/
├── app/
│   ├── ai/
│   ├── api/v1/
│   ├── core/
│   ├── db/
│   └── modules/
│       ├── conversation/
│       ├── plan/
│       ├── profile/
│       ├── trainer_knowledge/
│       ├── trainer_persona/
│       ├── trainer_review/
│       └── workout/
├── sql/
└── tests/
```

## Current API Surface

- `POST /workouts/generate`
- `POST /api/v1/chat`
- `POST /api/v1/chat/stream`
- `GET /api/v1/checkin/today`
- `GET /api/v1/checkin/previous`
- `GET /api/v1/checkin/progress`
- `POST /api/v1/checkin`
- `POST /api/v1/checkin/generate-plan`
- `POST /api/v1/checkin/log-workout`
- `GET /api/v1/profiles/me`
- `PATCH /api/v1/profiles/me`
- `GET /api/v1/plans/active`
- `POST /api/v1/plans/generate`
- `GET /api/v1/trainer-assignment/status`
- `POST /api/v1/trainer-assignment/assign`
- `GET /api/v1/trainer-home/today`
- `GET /api/v1/trainer-home/command-center`
- `GET /api/v1/trainer-clients/{client_id}/detail`
- `GET /api/v1/trainer-clients/{client_id}/memory`
- `POST /api/v1/trainer-clients/{client_id}/memory`
- `PATCH /api/v1/trainer-clients/{client_id}/memory/{memory_id}`
- `DELETE /api/v1/trainer-clients/{client_id}/memory/{memory_id}`
- `GET /api/v1/trainer-clients/{client_id}/ai-context`
- `GET /api/v1/trainer-personas`
- `POST /api/v1/trainer-personas`
- `GET /api/v1/trainer-knowledge`
- `POST /api/v1/trainer-knowledge`
- `POST /api/v1/trainer-knowledge/ingest`
- `GET /api/v1/trainer-knowledge/rules`
- `PATCH /api/v1/trainer-knowledge/rules/{rule_id}`
- `DELETE /api/v1/trainer-knowledge/rules/{rule_id}`
- `GET /api/v1/trainer-review/outputs`
- `GET /api/v1/trainer-review/outputs/{output_id}`
- `POST /api/v1/trainer-review/outputs/{output_id}/edit`
- `POST /api/v1/trainer-review/outputs/{output_id}/approve`
- `POST /api/v1/trainer-review/outputs/{output_id}/reject`
- Legacy: `GET /api/v1/trainer-review/queue`
- Legacy: `POST /api/v1/trainer-review/queue/{queue_id}/approve`

## Supabase Setup

For a fresh project, run:

```sql
backend/sql/20260321_supabase_full_setup.sql
```

If you already ran the earlier multi-tenant policies and hit recursion, also run:

```sql
backend/sql/20260322_fix_multi_tenant_rls_recursion.sql
```

## Local Development

### Frontend
```bash
npm install
npx expo start --port 8081
```

### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py
```

## Required Environment Variables

### Root `.env`
```env
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:8000
```

When testing in Expo Go on a physical device, `localhost` points to the phone, not your computer. If auto-detection does not work in your setup, set `EXPO_PUBLIC_API_BASE_URL` to your computer's LAN IP so the phone can reach the FastAPI server.

### `backend/.env`
```env
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Test Accounts

Seeded local test users currently use:

```text
Password: ModeTest123!
```

Example client:

```text
test_client_1@mode.local
```

## Before Publishing To GitHub

1. Confirm `.env` and `backend/.env` are still ignored.
2. Make sure no real secrets are hardcoded into tracked files.
3. Review `git status`.
4. Commit the cleanup + architecture changes together.
5. Push to a new branch first if you want a safe review pass before merging to `main`.
