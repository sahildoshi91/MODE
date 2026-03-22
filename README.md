# MODE
MODE is an Expo + FastAPI project for trainer-aware AI coaching.

The current repo is centered on a working client login + chat flow on the frontend and a multi-tenant coaching foundation on the backend. Legacy duplicate screens and unused setup files have been removed so the codebase now reflects the active product direction more closely.

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
- `GET /api/v1/profiles/me`
- `PATCH /api/v1/profiles/me`
- `GET /api/v1/plans/active`
- `POST /api/v1/plans/generate`
- `GET /api/v1/trainer-personas`
- `POST /api/v1/trainer-personas`
- `GET /api/v1/trainer-knowledge`
- `POST /api/v1/trainer-knowledge`
- `GET /api/v1/trainer-review/queue`
- `POST /api/v1/trainer-review/queue/{queue_id}/approve`

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
```

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
