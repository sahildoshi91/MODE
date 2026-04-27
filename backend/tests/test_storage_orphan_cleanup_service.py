import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.storage_lifecycle.service import StorageLifecycleService


class FakeStorageLifecycleRepository:
    def __init__(self):
        self.upload_rows = []
        self.ownership_rows = []
        self.bucket_paths: list[str] = []
        self.live_user_ids: set[str] = set()
        self.deleted_paths_calls: list[list[str]] = []
        self.mark_deleted_calls: list[tuple[list[str], str]] = []
        self.updated_upload_tokens: list[str] = []
        self.cleanup_heartbeats: list[dict] = []

    def list_expired_unverified_upload_grants(self, *, now_iso: str, limit: int = 500):
        del now_iso, limit
        return list(self.upload_rows)

    def delete_storage_paths(self, *, bucket: str, paths: list[str]) -> int:
        del bucket
        normalized = [str(path).strip().strip("/") for path in paths if str(path).strip()]
        self.deleted_paths_calls.append(normalized)
        self.bucket_paths = [path for path in self.bucket_paths if path not in normalized]
        return len(normalized)

    def update_upload_grant(self, *, upload_token: str, payload: dict):
        del payload
        self.updated_upload_tokens.append(upload_token)
        return {"upload_token": upload_token}

    def list_active_storage_ownership_rows(self, *, limit: int = 3000):
        del limit
        return list(self.ownership_rows)

    def list_all_storage_paths(self, *, bucket: str, prefixes: list[str]):
        del bucket, prefixes
        return list(self.bucket_paths)

    def mark_ownership_paths_deleted(self, *, paths: list[str], reason: str) -> int:
        normalized = [str(path).strip().strip("/") for path in paths if str(path).strip()]
        self.mark_deleted_calls.append((normalized, reason))
        return len(normalized)

    def list_user_account_ids(self, *, limit: int = 10000):
        del limit
        return set(self.live_user_ids)

    def create_cleanup_job_heartbeat(self, payload: dict):
        row = dict(payload)
        self.cleanup_heartbeats.append(row)
        return row


class StorageOrphanCleanupServiceTests(unittest.TestCase):
    def test_cleanup_removes_expired_and_orphan_paths(self):
        repo = FakeStorageLifecycleRepository()
        repo.upload_rows = [
            {
                "upload_token": "expired-token",
                "bucket": "private-user-files",
                "object_path": "client/client-1/expired.jpg",
            }
        ]
        repo.ownership_rows = [
            {
                "bucket": "private-user-files",
                "object_path": "trainer/trainer-1/owned.pdf",
                "owner_user_id": "user-live",
            }
        ]
        repo.bucket_paths = [
            "client/client-1/expired.jpg",
            "trainer/trainer-1/orphan.pdf",
            "trainer/trainer-1/owned.pdf",
        ]
        repo.live_user_ids = {"user-live"}

        result = StorageLifecycleService(repo).run_cleanup(
            bucket="private-user-files",
            known_prefixes=["client", "trainer"],
            dry_run=False,
            max_items=100,
        )

        self.assertEqual(result["expired_upload_paths"], 1)
        self.assertEqual(result["orphan_object_paths"], 1)
        self.assertEqual(result["deleted_user_paths"], 0)
        flattened_deleted = [item for chunk in repo.deleted_paths_calls for item in chunk]
        self.assertIn("client/client-1/expired.jpg", flattened_deleted)
        self.assertIn("trainer/trainer-1/orphan.pdf", flattened_deleted)
        self.assertIn("expired-token", repo.updated_upload_tokens)

    def test_cleanup_removes_paths_owned_by_deleted_users(self):
        repo = FakeStorageLifecycleRepository()
        repo.upload_rows = []
        repo.ownership_rows = [
            {
                "bucket": "private-user-files",
                "object_path": "trainer/trainer-2/clients/client-2/history.pdf",
                "owner_user_id": "deleted-user-id",
            }
        ]
        repo.bucket_paths = ["trainer/trainer-2/clients/client-2/history.pdf"]
        repo.live_user_ids = {"still-live-user"}

        result = StorageLifecycleService(repo).run_cleanup(
            bucket="private-user-files",
            known_prefixes=["trainer"],
            dry_run=False,
            max_items=100,
        )

        self.assertEqual(result["deleted_user_paths"], 1)
        flattened_deleted = [item for chunk in repo.deleted_paths_calls for item in chunk]
        self.assertIn("trainer/trainer-2/clients/client-2/history.pdf", flattened_deleted)
        self.assertIn(
            (["trainer/trainer-2/clients/client-2/history.pdf"], "deleted_user_cleanup"),
            repo.mark_deleted_calls,
        )

    def test_record_cleanup_heartbeat_writes_expected_payload(self):
        repo = FakeStorageLifecycleRepository()
        service = StorageLifecycleService(repo)

        row = service.record_cleanup_heartbeat(
            run_source="scheduled",
            status="succeeded",
            bucket="private-user-files",
            result={
                "expired_upload_paths": 1,
                "orphan_object_paths": 2,
                "stale_ownership_paths": 3,
                "deleted_user_paths": 4,
                "dry_run": 0,
            },
            started_at_iso="2026-04-26T10:00:00+00:00",
            finished_at_iso="2026-04-26T10:01:00+00:00",
            expected_interval_minutes=15,
        )

        self.assertEqual(len(repo.cleanup_heartbeats), 1)
        self.assertEqual(row["run_source"], "scheduled")
        self.assertEqual(row["status"], "succeeded")
        self.assertEqual(row["bucket"], "private-user-files")
        self.assertEqual(row["orphan_object_paths"], 2)
        self.assertEqual(row["deleted_user_paths"], 4)


if __name__ == "__main__":
    unittest.main()
