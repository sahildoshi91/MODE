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
from app.core.config import settings
from app.core.dependencies import get_trainer_client_repository, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerClientRepository:
    def __init__(self):
        self.allowed_pairs = {("trainer-1", "client-1")}

    def get_client_for_trainer(self, trainer_id: str, client_id: str):
        if (trainer_id, client_id) in self.allowed_pairs:
            return {"client_id": client_id, "trainer_id": trainer_id}
        return None


class _SignedUploadResult:
    def __init__(self, signed_url: str, token: str):
        self.signed_url = signed_url
        self.token = token


class _SignedDownloadResult:
    def __init__(self, signed_url: str):
        self.signedURL = signed_url


class FakeStorageBucketClient:
    def create_signed_upload_url(self, path: str):
        return _SignedUploadResult(
            signed_url=f"https://files.example/upload/{path}",
            token="upload-token-123",
        )

    def create_signed_url(self, path: str, expires_in: int):
        return _SignedDownloadResult(
            signed_url=f"https://files.example/download/{path}?expires_in={expires_in}",
        )


class FakeStorageClient:
    def from_(self, bucket: str):
        del bucket
        return FakeStorageBucketClient()


class FakeSupabaseAdminClient:
    def __init__(self):
        self.storage = FakeStorageClient()


class StoragePrivateApiTests(unittest.TestCase):
    def setUp(self):
        self._orig_bucket = settings.storage_private_bucket
        self._orig_ttl = settings.storage_signed_url_ttl_seconds
        self._orig_max_size = settings.storage_max_file_size_bytes
        self._orig_allowed_ext = settings.storage_allowed_extensions
        self._orig_allowed_mime = settings.storage_allowed_mime_types

        settings.storage_private_bucket = "private-user-files"
        settings.storage_signed_url_ttl_seconds = 90
        settings.storage_max_file_size_bytes = 1024 * 1024
        settings.storage_allowed_extensions = "pdf,png,jpg,jpeg,webp,txt,csv,json"
        settings.storage_allowed_mime_types = (
            "application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,application/json"
        )

        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="client-user-1",
        )
        app.dependency_overrides[get_trainer_client_repository] = lambda: FakeTrainerClientRepository()
        self.client = TestClient(app)

    def tearDown(self):
        settings.storage_private_bucket = self._orig_bucket
        settings.storage_signed_url_ttl_seconds = self._orig_ttl
        settings.storage_max_file_size_bytes = self._orig_max_size
        settings.storage_allowed_extensions = self._orig_allowed_ext
        settings.storage_allowed_mime_types = self._orig_allowed_mime
        app.dependency_overrides.clear()

    def test_anonymous_private_storage_route_is_denied(self):
        app.dependency_overrides.pop(require_user, None)
        response = self.client.post("/api/v1/storage/private/upload-url", json={})
        self.assertEqual(response.status_code, 401)

    def test_issue_private_upload_url_for_client_self(self):
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/upload-url",
                json={
                    "scope": "client_self",
                    "filename": "progress-photo.jpg",
                    "mime_type": "image/jpeg",
                    "size_bytes": 12345,
                },
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["bucket"], "private-user-files")
        self.assertTrue(payload["object_path"].startswith("client/client-1/"))
        self.assertIn(".jpg", payload["object_path"])
        self.assertEqual(payload["expires_in"], 90)
        self.assertIn("upload-token-123", payload["upload_token"])

    def test_invalid_file_type_is_rejected(self):
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/upload-url",
                json={
                    "scope": "client_self",
                    "filename": "payload.exe",
                    "mime_type": "application/x-msdownload",
                    "size_bytes": 1024,
                },
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 415)

    def test_oversized_file_is_rejected(self):
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/upload-url",
                json={
                    "scope": "client_self",
                    "filename": "scan.pdf",
                    "mime_type": "application/pdf",
                    "size_bytes": settings.storage_max_file_size_bytes + 1,
                },
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 413)

    def test_cross_client_private_download_is_denied(self):
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/download-url",
                json={
                    "object_path": "client/client-2/4f9e5f50c46b4d4f9d87df505ec022bb_wKHkLdnWdQLN8FAS2M_aKQ.jpg",
                },
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 403)

    def test_cross_trainer_private_download_is_denied(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
            client_user_id=None,
        )
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/download-url",
                json={
                    "object_path": "trainer/trainer-2/workspace/4f9e5f50c46b4d4f9d87df505ec022bb_wKHkLdnWdQLN8FAS2M_aKQ.pdf",
                },
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 403)

    def test_signed_download_url_has_short_expiry(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
            client_user_id=None,
        )
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            response = self.client.post(
                "/api/v1/storage/private/download-url",
                json={
                    "object_path": "trainer/trainer-1/workspace/4f9e5f50c46b4d4f9d87df505ec022bb_wKHkLdnWdQLN8FAS2M_aKQ.pdf",
                },
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["expires_in"], 90)
        self.assertIn("expires_in=90", payload["signed_url"])

    def test_path_traversal_and_guessed_path_are_rejected(self):
        with patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=FakeSupabaseAdminClient(),
        ):
            traversal = self.client.post(
                "/api/v1/storage/private/download-url",
                json={"object_path": "../client/client-1/file.pdf"},
                headers={"Authorization": "Bearer ignored"},
            )
            guessed = self.client.post(
                "/api/v1/storage/private/download-url",
                json={"object_path": "client/client-1/profile.jpg"},
                headers={"Authorization": "Bearer ignored"},
            )
        self.assertEqual(traversal.status_code, 400)
        self.assertEqual(guessed.status_code, 403)


if __name__ == "__main__":
    unittest.main()
