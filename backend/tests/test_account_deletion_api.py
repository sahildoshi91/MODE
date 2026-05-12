import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_request_scoped_supabase_client
from app.main import app
from app.modules.intelligence_jobs.schemas import EnqueueResult


class _TableResult:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows
        self.payload = None
        self.filters = {}

    def insert(self, payload):
        self.payload = dict(payload)
        return self

    def update(self, payload):
        self.payload = dict(payload)
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def execute(self):
        if self.payload is None:
            return _TableResult([])
        if self.filters:
            updated = []
            for row in self.rows:
                if all(row.get(column) == value for column, value in self.filters.items()):
                    row.update(self.payload)
                    updated.append(dict(row))
            return _TableResult(updated)
        self.rows.append(dict(self.payload))
        return _TableResult([dict(self.payload)])


class FakeSupabase:
    def __init__(self):
        self.account_deletion_requests = []

    def table(self, table_name):
        if table_name != "account_deletion_requests":
            raise AssertionError(f"Unexpected table: {table_name}")
        return _FakeTable(self.account_deletion_requests)


class AccountDeletionApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        self.fake_supabase = FakeSupabase()
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: self.fake_supabase
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_account_deletion_requires_authentication(self):
        app.dependency_overrides.pop(require_user, None)
        response = self.client.request("DELETE", "/api/v1/account/me", json={"confirmation": "DELETE"})
        self.assertEqual(response.status_code, 401)

    def test_delete_me_returns_queued_response(self):
        with patch(
            "app.api.v1.account.enqueue_intelligence_job",
            return_value=EnqueueResult(ok=True, job_id="job-123", queue_name="mode:intelligence:high"),
        ) as enqueue:
            response = self.client.request(
                "DELETE",
                "/api/v1/account/me",
                json={"confirmation": "DELETE"},
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["outcome"], "queued")
        self.assertEqual(response.json()["worker_job_id"], enqueue.call_args.args[0].job_id)
        self.assertEqual(len(self.fake_supabase.account_deletion_requests), 1)
        self.assertEqual(self.fake_supabase.account_deletion_requests[0]["status"], "queued")
        self.assertEqual(self.fake_supabase.account_deletion_requests[0]["user_id"], "user-123")

    def test_delete_me_rejects_invalid_confirmation_without_enqueue(self):
        with patch("app.api.v1.account.enqueue_intelligence_job") as enqueue:
            response = self.client.request(
                "DELETE",
                "/api/v1/account/me",
                json={"confirmation": "oops"},
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Invalid deletion confirmation")
        enqueue.assert_not_called()

    def test_delete_me_marks_request_failed_when_enqueue_fails(self):
        with patch(
            "app.api.v1.account.enqueue_intelligence_job",
            return_value=EnqueueResult(ok=False, job_id="job-123", error_category="redis_url_missing"),
        ):
            response = self.client.request(
                "DELETE",
                "/api/v1/account/me",
                json={"confirmation": "DELETE"},
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.fake_supabase.account_deletion_requests[0]["status"], "failed")
        self.assertEqual(self.fake_supabase.account_deletion_requests[0]["error_category"], "redis_url_missing")

if __name__ == "__main__":
    unittest.main()
