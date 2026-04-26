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


class FakeAccountDeletionRepository:
    def __init__(self):
        self.accessible_tables = {
            "user_accounts",
            "user_roles",
            "onboarding_states",
            "clients",
            "trainers",
            "conversations",
            "conversation_messages",
            "coach_memory",
            "trainer_invite_codes",
        }
        self.storage_paths_by_prefix = {}
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
            {"id": "client-1", "tenant_id": "tenant-1", "user_id": "user-123", "assigned_trainer_id": "trainer-1"},
        ]
        self._fail_delete_auth_user = False

    def table_is_accessible(self, *, table: str) -> bool:
        return table in self.accessible_tables

    def list_trainers_for_user(self, *, user_id: str):
        del user_id
        return list(self.trainers)

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

    def delete_clients_for_user(self, *, user_id: str) -> int:
        del user_id
        return 1

    def delete_trainers_for_user(self, *, user_id: str) -> int:
        del user_id
        return 1

    def delete_user_account_rows(self, *, user_id: str) -> int:
        del user_id
        return 1

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
        self._original_enabled = settings.account_deletion_enabled
        self._original_bucket = settings.storage_private_bucket
        settings.account_deletion_enabled = True
        settings.storage_private_bucket = "private-user-files"

    def tearDown(self):
        settings.account_deletion_enabled = self._original_enabled
        settings.storage_private_bucket = self._original_bucket

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

        result = self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(result.outcome, "succeeded")
        self.assertEqual(result.actor_role, "mixed")
        self.assertEqual(self.repo.deleted_auth_users, ["user-123"])
        self.assertEqual(len(self.repo.audit_rows), 1)
        self.assertEqual(self.repo.audit_rows[0]["outcome"], "succeeded")
        self.assertEqual(self.repo.audit_rows[0]["actor_role"], "mixed")
        self.assertEqual(result.deleted_record_counts["storage_objects"], 2)
        self.assertEqual(self.repo.rehome_calls, [("trainer-1", "tenant-self-guided")])

    def test_delete_account_fails_fast_when_required_table_missing(self):
        self.repo.accessible_tables.remove("coach_memory")

        with self.assertRaises(AccountDeletionServiceError) as raised:
            self.service.delete_account(user=self.user, confirmation="DELETE")

        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("required tables are present", str(raised.exception))
        self.assertEqual(self.repo.deleted_auth_users, [])

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
