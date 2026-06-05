from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
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
from app.core.dependencies import get_trainer_client_repository, get_trainer_context
from app.core.rate_limit import _rate_limiter
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


class _TableResult:
    def __init__(self, data):
        self.data = data


class _FakeTableQuery:
    def __init__(self, table_name: str, db: dict[str, list[dict]]):
        self.table_name = table_name
        self.db = db
        self.operation = "select"
        self.payload = None
        self.filters: list[tuple[str, str, object]] = []
        self._limit = None
        self._order = None
        self._upsert_conflict = None
        self.insert_errors: set[str] = set()

    def select(self, _columns: str):
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

    def upsert(self, payload, on_conflict: str):
        self.operation = "upsert"
        self.payload = payload
        self._upsert_conflict = on_conflict
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def eq(self, column: str, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column: str, values):
        self.filters.append(("in", column, list(values)))
        return self

    def lt(self, column: str, value):
        self.filters.append(("lt", column, value))
        return self

    def order(self, column: str, desc: bool = False):
        self._order = (column, desc)
        return self

    def limit(self, value: int):
        self._limit = int(value)
        return self

    def execute(self):
        rows = self.db.setdefault(self.table_name, [])

        def matches(row: dict) -> bool:
            for op, column, value in self.filters:
                row_value = row.get(column)
                if op == "eq" and row_value != value:
                    return False
                if op == "in" and row_value not in value:
                    return False
                if op == "lt" and not (str(row_value or "") < str(value or "")):
                    return False
            return True

        if self.operation == "insert":
            if self.table_name in self.insert_errors:
                raise RuntimeError(f"insert failed for {self.table_name}")
            payload = dict(self.payload or {})
            payload.setdefault("id", str(uuid4()))
            rows.append(payload)
            return _TableResult([dict(payload)])

        if self.operation == "update":
            updated = []
            for row in rows:
                if not matches(row):
                    continue
                row.update(dict(self.payload or {}))
                updated.append(dict(row))
            return _TableResult(updated)

        if self.operation == "upsert":
            payload = dict(self.payload or {})
            payload.setdefault("id", str(uuid4()))
            conflict_key = str(self._upsert_conflict or "").strip()
            updated_row = None
            if conflict_key:
                conflict_value = payload.get(conflict_key)
                for row in rows:
                    if row.get(conflict_key) == conflict_value:
                        row.update(payload)
                        updated_row = row
                        break
            if updated_row is None:
                rows.append(payload)
                updated_row = payload
            return _TableResult([dict(updated_row)])

        if self.operation == "delete":
            kept = []
            deleted = []
            for row in rows:
                if matches(row):
                    deleted.append(dict(row))
                else:
                    kept.append(row)
            self.db[self.table_name] = kept
            return _TableResult(deleted)

        selected = [dict(row) for row in rows if matches(row)]
        if self._order:
            column, desc = self._order
            selected.sort(key=lambda row: row.get(column), reverse=bool(desc))
        if self._limit is not None:
            selected = selected[: self._limit]
        return _TableResult(selected)


class FakeStorageBucketClient:
    def __init__(self, storage_backend: "FakeStorageClient", bucket: str):
        self._storage_backend = storage_backend
        self._bucket = bucket
        self._token_counter = 0

    def create_signed_upload_url(self, path: str):
        if self._storage_backend.upload_error:
            raise self._storage_backend.upload_error
        self._token_counter += 1
        token = f"upload-token-{self._token_counter:04d}"
        if self._storage_backend.upload_response_mode == "dict":
            return {
                "signedUrl": f"https://files.example/upload/{path}",
                "token": token,
            }
        return _SignedUploadResult(
            signed_url=f"https://files.example/upload/{path}",
            token=token,
        )

    def create_signed_url(self, path: str, expires_in: int):
        return _SignedDownloadResult(
            signed_url=f"https://files.example/download/{path}?expires_in={expires_in}",
        )

    def add_object(self, path: str):
        normalized = str(path or "").strip().strip("/")
        if normalized:
            self._storage_backend.bucket_objects.setdefault(self._bucket, set()).add(normalized)

    def list(self, path: str = ""):
        normalized_prefix = str(path or "").strip().strip("/")
        objects = self._storage_backend.bucket_objects.setdefault(self._bucket, set())
        entries: dict[str, dict] = {}
        for object_path in objects:
            if normalized_prefix:
                prefix = f"{normalized_prefix}/"
                if not object_path.startswith(prefix):
                    continue
                remainder = object_path[len(prefix):]
            else:
                remainder = object_path
            if not remainder:
                continue
            next_token = remainder.split("/", 1)[0]
            if "/" in remainder:
                entries.setdefault(next_token, {"name": next_token})
            else:
                entries[next_token] = {"name": next_token, "id": f"obj-{next_token}"}
        return [entries[key] for key in sorted(entries)]

    def remove(self, paths: list[str]):
        objects = self._storage_backend.bucket_objects.setdefault(self._bucket, set())
        removed = []
        for path in paths:
            normalized = str(path or "").strip().strip("/")
            if normalized in objects:
                objects.remove(normalized)
                removed.append({"name": normalized})
        return removed


class FakeStorageClient:
    def __init__(self):
        self.bucket_objects: dict[str, set[str]] = {}
        self._bucket_clients: dict[str, FakeStorageBucketClient] = {}
        self.upload_error: Exception | None = None
        self.upload_response_mode = "object"

    def from_(self, bucket: str):
        bucket_name = str(bucket or "").strip()
        if bucket_name not in self._bucket_clients:
            self._bucket_clients[bucket_name] = FakeStorageBucketClient(self, bucket_name)
        return self._bucket_clients[bucket_name]


class FakeSupabaseAdminClient:
    def __init__(self):
        self.storage = FakeStorageClient()
        self.table_insert_errors: set[str] = set()
        self.tables: dict[str, list[dict]] = {
            "storage_upload_grants": [],
            "storage_object_ownership": [],
            "user_accounts": [{"auth_user_id": "client-user-1"}, {"auth_user_id": "trainer-user-1"}],
        }

    def table(self, table_name: str):
        query = _FakeTableQuery(table_name, self.tables)
        query.insert_errors = self.table_insert_errors
        return query

    def find_upload_grant(self, upload_token: str) -> dict | None:
        for row in self.tables["storage_upload_grants"]:
            if row.get("upload_token") == upload_token:
                return row
        return None

    def has_object(self, bucket: str, object_path: str) -> bool:
        return str(object_path).strip().strip("/") in self.storage.bucket_objects.get(str(bucket), set())


class StoragePrivateApiTests(unittest.TestCase):
    def setUp(self):
        self.original = {
            "bucket": settings.storage_private_bucket,
            "ttl": settings.storage_signed_url_ttl_seconds,
            "upload_window": settings.storage_upload_window_seconds,
            "verify_grace": settings.storage_upload_verification_grace_seconds,
            "max_size": settings.storage_max_file_size_bytes,
            "allowed_ext": settings.storage_allowed_extensions,
            "allowed_mime": settings.storage_allowed_mime_types,
            "rate_limit_backend": settings.rate_limit_backend,
        }
        settings.rate_limit_backend = "memory"
        _rate_limiter._windows.clear()

        settings.storage_private_bucket = "private-user-files"
        settings.storage_signed_url_ttl_seconds = 90
        settings.storage_upload_window_seconds = 90
        settings.storage_upload_verification_grace_seconds = 0
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
        self.fake_supabase = FakeSupabaseAdminClient()
        self.admin_client_patcher = patch(
            "app.api.v1.storage_private.get_supabase_admin_client",
            return_value=self.fake_supabase,
        )
        self.admin_client_patcher.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.admin_client_patcher.stop()
        settings.storage_private_bucket = self.original["bucket"]
        settings.storage_signed_url_ttl_seconds = self.original["ttl"]
        settings.storage_upload_window_seconds = self.original["upload_window"]
        settings.storage_upload_verification_grace_seconds = self.original["verify_grace"]
        settings.storage_max_file_size_bytes = self.original["max_size"]
        settings.storage_allowed_extensions = self.original["allowed_ext"]
        settings.storage_allowed_mime_types = self.original["allowed_mime"]
        settings.rate_limit_backend = self.original["rate_limit_backend"]
        app.dependency_overrides.clear()
        _rate_limiter._windows.clear()

    def test_anonymous_private_storage_route_is_denied(self):
        app.dependency_overrides.pop(require_user, None)
        response = self.client.post("/api/v1/storage/private/upload-url", json={})
        self.assertEqual(response.status_code, 401)

    def test_issue_private_upload_url_for_client_self(self):
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
        self.assertIn("upload-token-", payload["upload_token"])
        self.assertEqual(len(self.fake_supabase.tables["storage_upload_grants"]), 1)

    def test_issue_private_upload_url_accepts_dict_signed_upload_response(self):
        self.fake_supabase.storage.upload_response_mode = "dict"

        response = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "notes.txt",
                "mime_type": "text/plain",
                "size_bytes": 12,
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["signed_upload_url"].startswith("https://files.example/upload/"))
        self.assertIn("upload-token-", payload["upload_token"])

    def test_signed_upload_storage_exception_returns_502(self):
        self.fake_supabase.storage.upload_error = RuntimeError("bucket not found")

        response = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "notes.txt",
                "mime_type": "text/plain",
                "size_bytes": 12,
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Unable to issue upload URL")

    def test_missing_storage_bucket_returns_controlled_error(self):
        settings.storage_private_bucket = " "

        response = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "notes.txt",
                "mime_type": "text/plain",
                "size_bytes": 12,
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "Storage bucket is not configured")

    def test_upload_grant_persistence_failure_returns_controlled_500(self):
        self.fake_supabase.table_insert_errors.add("storage_upload_grants")

        response = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "notes.txt",
                "mime_type": "text/plain",
                "size_bytes": 12,
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "Upload lifecycle storage unavailable")

    def test_invalid_file_type_is_rejected(self):
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

    def test_upload_complete_succeeds_and_creates_ownership_record(self):
        issue = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "profile-image.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1000,
            },
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(issue.status_code, 200, issue.text)
        issued = issue.json()
        self.fake_supabase.storage.from_(issued["bucket"]).add_object(issued["object_path"])

        complete = self.client.post(
            "/api/v1/storage/private/upload-complete",
            json={
                "upload_token": issued["upload_token"],
                "object_path": issued["object_path"],
                "bucket": issued["bucket"],
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(complete.status_code, 200, complete.text)
        payload = complete.json()
        self.assertEqual(payload["status"], "verified")
        self.assertTrue(payload["verified"])
        ownership_rows = self.fake_supabase.tables["storage_object_ownership"]
        self.assertEqual(len(ownership_rows), 1)
        self.assertEqual(ownership_rows[0]["object_path"], issued["object_path"])
        self.assertTrue(ownership_rows[0]["is_active"])

    def test_upload_complete_after_expiry_is_rejected_and_object_is_deleted(self):
        issue = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "late-upload.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1000,
            },
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(issue.status_code, 200, issue.text)
        issued = issue.json()

        grant = self.fake_supabase.find_upload_grant(issued["upload_token"])
        self.assertIsNotNone(grant)
        grant["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        self.fake_supabase.storage.from_(issued["bucket"]).add_object(issued["object_path"])

        complete = self.client.post(
            "/api/v1/storage/private/upload-complete",
            json={
                "upload_token": issued["upload_token"],
                "object_path": issued["object_path"],
                "bucket": issued["bucket"],
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(complete.status_code, 410)
        self.assertFalse(self.fake_supabase.has_object(issued["bucket"], issued["object_path"]))

    def test_upload_complete_rejects_cross_tenant_or_forged_path(self):
        issue = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "client-upload.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1000,
            },
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(issue.status_code, 200, issue.text)
        issued = issue.json()
        self.fake_supabase.storage.from_(issued["bucket"]).add_object(issued["object_path"])

        forged = issued["object_path"].replace("/client-1/", "/client-2/")
        response = self.client.post(
            "/api/v1/storage/private/upload-complete",
            json={
                "upload_token": issued["upload_token"],
                "object_path": forged,
                "bucket": issued["bucket"],
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 403)

    def test_storage_scope_paths_cover_release_file_consumer_categories(self):
        profile_upload = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "profile-image.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1000,
            },
            headers={"Authorization": "Bearer ignored"},
        ).json()
        progress_photo_upload = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "client_self",
                "filename": "progress-photo.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1000,
            },
            headers={"Authorization": "Bearer ignored"},
        ).json()

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

        knowledge_upload = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "trainer_workspace",
                "filename": "knowledge-doc.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 4000,
            },
            headers={"Authorization": "Bearer ignored"},
        ).json()
        export_upload = self.client.post(
            "/api/v1/storage/private/upload-url",
            json={
                "scope": "trainer_client",
                "filename": "generated-export.csv",
                "mime_type": "text/csv",
                "size_bytes": 2000,
                "client_id": "client-1",
            },
            headers={"Authorization": "Bearer ignored"},
        ).json()

        self.assertTrue(profile_upload["object_path"].startswith("client/client-1/"))
        self.assertTrue(progress_photo_upload["object_path"].startswith("client/client-1/"))
        self.assertTrue(knowledge_upload["object_path"].startswith("trainer/trainer-1/workspace/"))
        self.assertTrue(export_upload["object_path"].startswith("trainer/trainer-1/clients/client-1/"))


if __name__ == "__main__":
    unittest.main()
