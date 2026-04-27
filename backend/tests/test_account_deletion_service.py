import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import AuthenticatedUser
from app.core.config import settings
from app.modules.account_deletion.service import AccountDeletionService, AccountDeletionServiceError
from app.security.personal_data_inventory import load_personal_data_inventory


class FakeAccountDeletionRepository:
    def __init__(self):
        inventory = load_personal_data_inventory()
        self.accessible_tables = set(inventory.table_names)
        self.live_tables = set(inventory.table_names)
        self.storage_paths_by_prefix = {}
        self.storage_ownership_paths = []
        self.deleted_by_column_calls = []
        self.deleted_many_calls = []
        self.audit_rows = []
        self.deleted_auth_users = []
        self.deletion_counts = {}
        self.rehome_calls = []
        self.trainers = [
            {"id": "trainer-1", "tenant_id": "tenant-1", "user_id": "user-123"},
        ]
        self.clients = [
            {
                "id": "client-1",
                "tenant_id": "tenant-1",
                "user_id": "user-123",
                "assigned_trainer_id": "trainer-1",
            },
        ]
        self._fail_delete_auth_user = False

    def table_is_accessible(self, *, table: str) -> bool:
        return table in self.accessible_tables

    def list_public_tables(self) -> list[str]:
        return sorted(self.live_tables)

    def list_trainers_for_user(self, *, user_id: str):
        del user_id
        return list(self.trainers)

    def get_user_account(self, *, user_id: str):
        del user_id
        return {"id": "ua-1", "auth_user_id": "user-123", "email": "user@example.com"}

    def list_clients_for_user(self, *, user_id: str):
        del user_id
        return list(self.clients)

    def ensure_self_guided_tenant(self) -> str:
        return "tenant-self-guided"

    def rehome_clients_assigned_to_trainer(self, *, trainer_id: str, target_tenant_id: str) -> int:
        self.rehome_calls.append((trainer_id, target_tenant_id))
        return 1

    def list_storage_paths_for_prefix(self, *, bucket: str, prefix: str) -> list[str]:
        del bucket
        return list(self.storage_paths_by_prefix.get(prefix, []))

    def list_storage_ownership_paths_for_subjects(self, *, user_id: str, trainer_ids: list[str], client_ids: list[str]) -> list[str]:
        del user_id, trainer_ids, client_ids
        return list(self.storage_ownership_paths)

    def mark_storage_ownership_paths_deleted(self, *, paths: list[str], reason: str = "account_deletion") -> int:
        del reason
        return len(paths)

    def delete_upload_grants_for_subjects(self, *, user_id: str, trainer_ids: list[str], client_ids: list[str]) -> int:
        del user_id, trainer_ids, client_ids
        return 2

    def delete_storage_paths(self, *, bucket: str, paths: list[str]) -> int:
        del bucket
        return len(paths)

    def delete_rows_by_column_value(self, *, table: str, column: str, value: str) -> int:
        self.deleted_by_column_calls.append((table, column, value))
        return int(self.deletion_counts.get((table, column, value), 0))

    def delete_rows_by_column_values(self, *, table: str, column: str, values: list[str]) -> int:
        self.deleted_many_calls.append((table, column, tuple(values)))
        key = (table, column, tuple(values))
        return int(self.deletion_counts.get(key, 0))

    def delete_mobile_analytics_events(self, *, user_id: str) -> int:
        return int(self.deletion_counts.get(("mobile_analytics_events", "user_id", user_id), 0))

    def delete_auth_user(self, *, user_id: str) -> None:
        if self._fail_delete_auth_user:
            raise RuntimeError("auth delete failed")
        self.deleted_auth_users.append(user_id)

    def write_deletion_audit(
        self,
        *,
        deletion_request_id: str,
        outcome: str,
        actor_role: str,
        deleted_record_counts: dict,
        metadata: dict | None = None,
    ) -> None:
        self.audit_rows.append(
            {
                "deletion_request_id": deletion_request_id,
                "outcome": outcome,
                "actor_role": actor_role,
                "deleted_record_counts": deleted_record_counts,
                "metadata": metadata or {},
            }
        )


class AccountDeletionServiceTests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeAccountDeletionRepository()
        self.service = AccountDeletionService(self.repo)
        self.user = AuthenticatedUser(id="user-123", email="user@example.com", access_token="token-123")
        self.original = {
            "enabled": settings.account_deletion_enabled,
            "contract": settings.account_deletion_contract_enforced,
            "bucket": settings.storage_private_bucket,
            "active_sinks": settings.account_deletion_active_sink_categories,
            "disabled_sinks": settings.account_deletion_disabled_sink_categories,
        }
        settings.account_deletion_enabled = True
        settings.account_deletion_contract_enforced = True
        settings.storage_private_bucket = "private-user-files"
        settings.account_deletion_active_sink_categories = "file_storage,retrieval_caches,analytics_events"
        settings.account_deletion_disabled_sink_categories = (
            "vector_indexes,embedding_stores,logs,notification_providers,email_providers,ai_memory_retrieval_systems"
        )
        os.environ.pop("MODE_EXTERNAL_SINK_VECTOR_INDEXES_ENABLED", None)

    def tearDown(self):
        settings.account_deletion_enabled = self.original["enabled"]
        settings.account_deletion_contract_enforced = self.original["contract"]
        settings.storage_private_bucket = self.original["bucket"]
        settings.account_deletion_active_sink_categories = self.original["active_sinks"]
        settings.account_deletion_disabled_sink_categories = self.original["disabled_sinks"]
        os.environ.pop("MODE_EXTERNAL_SINK_VECTOR_INDEXES_ENABLED", None)

    def test_delete_account_requires_delete_confirmation(self):
        with self.assertRaises(AccountDeletionServiceError) as raised:
            self.service.delete_account(user=self.user, confirmation="delete me")

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(str(raised.exception), "Invalid deletion confirmation")

    def test_delete_account_succeeds_and_writes_success_audit(self):
        self.repo.storage_paths_by_prefix = {
            "trainer/trainer-1": ["trainer/trainer-1/file-a.txt"],
            "client/client-1": ["client/client-1/file-b.txt"],
        }
        self.repo.storage_ownership_paths = ["trainer/trainer-1/file-c.txt"]
        self.repo.deletion_counts[("mobile_analytics_events", "user_id", "user-123")] = 3

        result = self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(result.outcome, "succeeded")
        self.assertEqual(result.actor_role, "mixed")
        self.assertEqual(self.repo.deleted_auth_users, ["user-123"])
        self.assertEqual(len(self.repo.audit_rows), 1)
        self.assertEqual(self.repo.audit_rows[0]["outcome"], "succeeded")
        self.assertEqual(self.repo.audit_rows[0]["actor_role"], "mixed")
        self.assertEqual(result.deleted_record_counts["sink:file_storage:objects_deleted"], 3)
        self.assertEqual(result.deleted_record_counts["sink:file_storage:ownership_rows_deleted"], 3)
        self.assertEqual(result.deleted_record_counts["sink:file_storage:upload_grants_deleted"], 2)
        self.assertEqual(result.deleted_record_counts["sink:analytics_events:events_deleted"], 3)
        self.assertEqual(self.repo.rehome_calls, [("trainer-1", "tenant-self-guided")])

    def test_delete_account_fails_when_live_schema_has_unknown_table(self):
        self.repo.live_tables.add("future_personal_data_table")

        with self.assertRaises(AccountDeletionServiceError) as raised:
            self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("classified in the personal-data inventory", str(raised.exception))
        self.assertEqual(self.repo.deleted_auth_users, [])

    def test_delete_account_fails_when_disabled_sink_is_enabled(self):
        os.environ["MODE_EXTERNAL_SINK_VECTOR_INDEXES_ENABLED"] = "true"

        with self.assertRaises(AccountDeletionServiceError) as raised:
            self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("external sink vector_indexes is enabled", str(raised.exception))

    def test_delete_account_failure_writes_failed_audit(self):
        self.repo._fail_delete_auth_user = True

        with self.assertRaises(AccountDeletionServiceError) as raised:
            self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(str(raised.exception), "Unable to delete account")
        self.assertEqual(len(self.repo.audit_rows), 1)
        self.assertEqual(self.repo.audit_rows[0]["outcome"], "failed")


if __name__ == "__main__":
    unittest.main()
