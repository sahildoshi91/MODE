import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_account_deletion_service
from app.main import app
from app.modules.account_deletion.service import AccountDeletionResult, AccountDeletionServiceError


class FakeAccountDeletionService:
    def __init__(self):
        self.calls = []
        self._error = None

    def fail_with(self, message: str, status_code: int):
        self._error = AccountDeletionServiceError(message, status_code=status_code)

    def delete_account(self, *, user, confirmation):
        self.calls.append({"user_id": user.id, "confirmation": confirmation})
        if self._error:
            raise self._error
        return AccountDeletionResult(
            deletion_request_id="7c15fd7a-c451-4f4a-a1b1-32f0c0cd6de4",
            outcome="succeeded",
            actor_role="client",
            deleted_record_counts={"auth.users": 1},
        )


class AccountDeletionApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        self.fake_service = FakeAccountDeletionService()
        app.dependency_overrides[get_account_deletion_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_account_deletion_requires_authentication(self):
        app.dependency_overrides.pop(require_user, None)
        response = self.client.request("DELETE", "/api/v1/account/me", json={"confirmation": "DELETE"})
        self.assertEqual(response.status_code, 401)

    def test_delete_me_returns_success_response(self):
        response = self.client.request(
            "DELETE",
            "/api/v1/account/me",
            json={"confirmation": "DELETE"},
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["outcome"], "succeeded")
        self.assertEqual(response.json()["actor_role"], "client")
        self.assertEqual(len(self.fake_service.calls), 1)
        self.assertEqual(self.fake_service.calls[0]["confirmation"], "DELETE")

    def test_delete_me_maps_service_error(self):
        self.fake_service.fail_with("Invalid deletion confirmation", 422)

        response = self.client.request(
            "DELETE",
            "/api/v1/account/me",
            json={"confirmation": "oops"},
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Invalid deletion confirmation")


if __name__ == "__main__":
    unittest.main()
