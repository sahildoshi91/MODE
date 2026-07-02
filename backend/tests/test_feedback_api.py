from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.config import settings
from app.core.dependencies import get_request_scoped_supabase_client, get_trainer_context
from app.core.rate_limit import _rate_limiter
from app.core.tenancy import TrainerContext
from app.main import app


class _TableResult:
    def __init__(self, data):
        self.data = data


class _FakeTableQuery:
    def __init__(self, table_name: str, db: dict):
        self.table_name = table_name
        self.db = db
        self.operation = "select"
        self.payload = None
        self.filters: list[tuple] = []
        self._limit = None
        self._order = None

    def select(self, _cols: str):
        self.operation = "select"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, col: str, val):
        self.filters.append(("eq", col, val))
        return self

    def lt(self, col: str, val):
        self.filters.append(("lt", col, val))
        return self

    def order(self, col: str, desc: bool = False):
        self._order = (col, desc)
        return self

    def limit(self, n: int):
        self._limit = int(n)
        return self

    def execute(self):
        rows = self.db.setdefault(self.table_name, [])

        def matches(row: dict) -> bool:
            for op, col, val in self.filters:
                rv = row.get(col)
                if op == "eq" and rv != val:
                    return False
                if op == "lt" and not (str(rv or "") < str(val or "")):
                    return False
            return True

        if self.operation == "insert":
            payload = dict(self.payload or {})
            now = datetime.now(tz=timezone.utc).isoformat()
            payload.setdefault("id", str(uuid4()))
            payload.setdefault("status", "open")
            payload.setdefault("created_at", now)
            payload.setdefault("updated_at", now)
            rows.append(payload)
            return _TableResult([dict(payload)])

        if self.operation == "update":
            updated = []
            for row in rows:
                if matches(row):
                    row.update(dict(self.payload or {}))
                    updated.append(dict(row))
            return _TableResult(updated)

        selected = [dict(row) for row in rows if matches(row)]
        if self._order:
            col, desc = self._order
            selected.sort(key=lambda r: r.get(col) or "", reverse=bool(desc))
        if self._limit is not None:
            selected = selected[: self._limit]
        return _TableResult(selected)


class FakeSupabaseClient:
    """Simulates both user-scoped and admin Supabase clients for feedback tests."""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "app_feedback_reports": [],
        }
        self.storage = _FakeStorage()

    def table(self, name: str) -> _FakeTableQuery:
        return _FakeTableQuery(name, self.tables)


class _FakeStorage:
    def from_(self, bucket: str):
        return _FakeStorageBucket()


class _FakeStorageBucket:
    def create_signed_url(self, path: str, expires_in: int):
        class _Result:
            signed_url = f"https://storage.example/{path}"
        return _Result()


ADMIN_EMAIL = "admin@modefit.ai"
NON_ADMIN_EMAIL = "notadmin@example.com"
ADMIN_USER = AuthenticatedUser(
    id="admin-user-id",
    email=ADMIN_EMAIL,
    access_token="admin-token",
)
CLIENT_USER = AuthenticatedUser(
    id="client-user-id",
    email=NON_ADMIN_EMAIL,
    access_token="client-token",
)
DEFAULT_TRAINER_CONTEXT = TrainerContext(
    tenant_id="tenant-1",
    trainer_id=None,
    trainer_user_id=None,
    trainer_display_name=None,
    client_id=None,
    client_user_id=None,
)


class FeedbackApiTests(unittest.TestCase):
    def setUp(self):
        self.original_allowlist = settings.atlas_admin_email_allowlist
        self.original_rl_backend = settings.rate_limit_backend
        self.original_feedback_limit = settings.rate_limit_feedback_per_window
        self.original_feedback_window = settings.rate_limit_feedback_window_seconds

        settings.atlas_admin_email_allowlist = ADMIN_EMAIL
        settings.rate_limit_backend = "memory"
        settings.rate_limit_feedback_per_window = 10
        settings.rate_limit_feedback_window_seconds = 3600

        _rate_limiter._windows.clear()

        self.fake_supabase = FakeSupabaseClient()
        app.dependency_overrides[require_user] = lambda: CLIENT_USER
        app.dependency_overrides[get_trainer_context] = lambda: DEFAULT_TRAINER_CONTEXT
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: self.fake_supabase
        self.admin_patcher = patch(
            "app.api.v1.feedback.get_supabase_admin_client",
            return_value=self.fake_supabase,
        )
        self.admin_patcher.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.admin_patcher.stop()
        settings.atlas_admin_email_allowlist = self.original_allowlist
        settings.rate_limit_backend = self.original_rl_backend
        settings.rate_limit_feedback_per_window = self.original_feedback_limit
        settings.rate_limit_feedback_window_seconds = self.original_feedback_window
        app.dependency_overrides.clear()
        _rate_limiter._windows.clear()

    # ── submission ─────────────────────────────────────────────────────────────

    def test_submit_bug_report_returns_201(self):
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={
                "report_type": "bug",
                "summary": "App crashes on checkin",
                "steps_to_reproduce": "1. Open app. 2. Tap checkin.",
            },
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body["report_type"], "bug")
        self.assertEqual(body["status"], "open")
        self.assertIn("id", body)

    def test_submit_feature_request_returns_201(self):
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "feature_request", "summary": "Add dark mode"},
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["report_type"], "feature_request")

    def test_submit_feedback_returns_201(self):
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "feedback", "summary": "Love the app!"},
        )
        self.assertEqual(resp.status_code, 201)

    def test_unauthenticated_submit_returns_401(self):
        app.dependency_overrides.pop(require_user, None)
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "bug", "summary": "test"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_invalid_report_type_returns_422(self):
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "invalid_type", "summary": "test"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_missing_summary_returns_422(self):
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "bug"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_submit_rate_limited_at_11th_request(self):
        settings.rate_limit_feedback_per_window = 10
        for i in range(10):
            resp = self.client.post(
                "/api/v1/feedback/reports",
                json={"report_type": "feedback", "summary": f"Report {i}"},
            )
            self.assertEqual(resp.status_code, 201, f"Expected 201 on request {i + 1}")
        resp = self.client.post(
            "/api/v1/feedback/reports",
            json={"report_type": "feedback", "summary": "over limit"},
        )
        self.assertEqual(resp.status_code, 429)

    # ── admin routes ────────────────────────────────────────────────────────────

    def test_non_admin_list_returns_403(self):
        resp = self.client.get("/api/v1/feedback/admin/reports")
        self.assertEqual(resp.status_code, 403)

    def test_non_admin_patch_returns_403(self):
        resp = self.client.patch(
            "/api/v1/feedback/admin/reports/some-id",
            json={"status": "resolved"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_admin_list_returns_200(self):
        app.dependency_overrides[require_user] = lambda: ADMIN_USER
        self.fake_supabase.tables["app_feedback_reports"] = [
            {
                "id": str(uuid4()),
                "user_id": "u1",
                "report_type": "bug",
                "summary": "Test bug",
                "status": "open",
                "screen_context": {},
                "debug_context": {},
                "created_at": "2026-07-02T10:00:00+00:00",
                "updated_at": "2026-07-02T10:00:00+00:00",
            }
        ]
        resp = self.client.get("/api/v1/feedback/admin/reports")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_admin_list_paginates_with_before(self):
        app.dependency_overrides[require_user] = lambda: ADMIN_USER
        now_base = "2026-07-02T10:00:00+00:00"
        cutoff = "2026-07-02T09:00:00+00:00"
        self.fake_supabase.tables["app_feedback_reports"] = [
            {
                "id": "r1",
                "user_id": "u1",
                "report_type": "bug",
                "summary": "old",
                "status": "open",
                "screen_context": {},
                "debug_context": {},
                "created_at": "2026-07-02T08:00:00+00:00",
                "updated_at": "2026-07-02T08:00:00+00:00",
            },
            {
                "id": "r2",
                "user_id": "u1",
                "report_type": "bug",
                "summary": "new",
                "status": "open",
                "screen_context": {},
                "debug_context": {},
                "created_at": now_base,
                "updated_at": now_base,
            },
        ]
        resp = self.client.get(f"/api/v1/feedback/admin/reports?before={cutoff}")
        self.assertEqual(resp.status_code, 200)
        returned_ids = [r["id"] for r in resp.json()]
        self.assertIn("r1", returned_ids)
        self.assertNotIn("r2", returned_ids)

    def test_admin_patch_sets_last_reviewed_by_and_updated_at(self):
        app.dependency_overrides[require_user] = lambda: ADMIN_USER
        report_id = str(uuid4())
        self.fake_supabase.tables["app_feedback_reports"] = [
            {
                "id": report_id,
                "user_id": "u1",
                "report_type": "bug",
                "summary": "Test",
                "status": "open",
                "screen_context": {},
                "debug_context": {},
                "created_at": "2026-07-02T10:00:00+00:00",
                "updated_at": "2026-07-02T10:00:00+00:00",
                "last_reviewed_by": None,
                "admin_notes": None,
            }
        ]
        resp = self.client.patch(
            f"/api/v1/feedback/admin/reports/{report_id}",
            json={"status": "resolved", "admin_notes": "Fixed in v2"},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "resolved")
        self.assertEqual(body["last_reviewed_by"], ADMIN_USER.id)
        self.assertIsNotNone(body["updated_at"])

    # ── openapi route registration ──────────────────────────────────────────────

    def test_feedback_reports_route_registered(self):
        resp = self.client.get("/openapi.json")
        self.assertEqual(resp.status_code, 200)
        paths = resp.json().get("paths", {})
        self.assertIn("/api/v1/feedback/reports", paths)
        self.assertIn("/api/v1/feedback/admin/reports", paths)


if __name__ == "__main__":
    unittest.main()
