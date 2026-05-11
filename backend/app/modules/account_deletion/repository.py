from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.modules.onboarding.repository import SELF_GUIDED_TENANT_NAME, SELF_GUIDED_TENANT_SLUG


class AccountDeletionRepository:
    def __init__(self, supabase_admin: Client):
        self.supabase_admin = supabase_admin

    def list_trainers_for_user(self, *, user_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase_admin
            .table("trainers")
            .select("id, tenant_id, user_id")
            .eq("user_id", user_id)
            .execute()
        )
        return response.data or []

    def get_user_account(self, *, user_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("user_accounts")
            .select("id, auth_user_id, email")
            .eq("auth_user_id", user_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def list_clients_for_user(self, *, user_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase_admin
            .table("clients")
            .select("id, tenant_id, user_id, assigned_trainer_id")
            .eq("user_id", user_id)
            .execute()
        )
        return response.data or []

    def ensure_self_guided_tenant(self) -> str:
        existing = (
            self.supabase_admin
            .table("tenants")
            .select("id")
            .eq("slug", SELF_GUIDED_TENANT_SLUG)
            .limit(1)
            .execute()
        ).data or []
        if existing:
            return str(existing[0]["id"])

        inserted = (
            self.supabase_admin
            .table("tenants")
            .insert({
                "name": SELF_GUIDED_TENANT_NAME,
                "slug": SELF_GUIDED_TENANT_SLUG,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to provision self-guided tenant")
        return str(inserted[0]["id"])

    def rehome_clients_assigned_to_trainer(
        self,
        *,
        trainer_id: str,
        target_tenant_id: str,
    ) -> int:
        updated = (
            self.supabase_admin
            .table("clients")
            .update(
                {
                    "assigned_trainer_id": None,
                    "tenant_id": target_tenant_id,
                }
            )
            .eq("assigned_trainer_id", trainer_id)
            .execute()
        ).data or []
        return len(updated)

    def delete_trainers_for_user(self, *, user_id: str) -> int:
        deleted = (
            self.supabase_admin
            .table("trainers")
            .delete()
            .eq("user_id", user_id)
            .execute()
        ).data or []
        return len(deleted)

    def delete_clients_for_user(self, *, user_id: str) -> int:
        deleted = (
            self.supabase_admin
            .table("clients")
            .delete()
            .eq("user_id", user_id)
            .execute()
        ).data or []
        return len(deleted)

    def delete_rows_by_user_id(self, *, table: str, user_id: str) -> int:
        deleted = (
            self.supabase_admin
            .table(table)
            .delete()
            .eq("user_id", user_id)
            .execute()
        ).data or []
        return len(deleted)

    def delete_rows_by_column_value(self, *, table: str, column: str, value: str) -> int:
        deleted = (
            self.supabase_admin
            .table(table)
            .delete()
            .eq(column, value)
            .execute()
        ).data or []
        return len(deleted)

    def delete_rows_by_column_values(self, *, table: str, column: str, values: list[str]) -> int:
        normalized = [str(value).strip() for value in values if str(value).strip()]
        if not normalized:
            return 0
        deleted = (
            self.supabase_admin
            .table(table)
            .delete()
            .in_(column, normalized)
            .execute()
        ).data or []
        return len(deleted)

    def delete_user_account_rows(self, *, user_id: str) -> int:
        deleted = (
            self.supabase_admin
            .table("user_accounts")
            .delete()
            .eq("auth_user_id", user_id)
            .execute()
        ).data or []
        return len(deleted)

    def delete_mobile_analytics_events(self, *, user_id: str) -> int:
        deleted = (
            self.supabase_admin
            .table("mobile_analytics_events")
            .delete()
            .eq("user_id", user_id)
            .execute()
        ).data or []
        return len(deleted)

    def list_storage_paths_for_prefix(self, *, bucket: str, prefix: str) -> list[str]:
        normalized_prefix = str(prefix or "").strip().strip("/")
        if not normalized_prefix:
            return []

        bucket_client = self.supabase_admin.storage.from_(bucket)
        pending_directories = [normalized_prefix]
        collected_paths: list[str] = []
        seen_directories: set[str] = set()

        while pending_directories:
            current = pending_directories.pop()
            if current in seen_directories:
                continue
            seen_directories.add(current)
            rows = bucket_client.list(path=current) or []
            for row in rows:
                name = str(row.get("name") or "").strip()
                if not name:
                    continue
                child_path = f"{current}/{name}" if current else name
                if row.get("id"):
                    collected_paths.append(child_path)
                else:
                    pending_directories.append(child_path)
        return collected_paths

    def delete_storage_paths(self, *, bucket: str, paths: list[str]) -> int:
        normalized_paths = [str(path).strip().strip("/") for path in paths if str(path).strip()]
        if not normalized_paths:
            return 0
        deleted_total = 0
        chunk_size = 100
        bucket_client = self.supabase_admin.storage.from_(bucket)
        for index in range(0, len(normalized_paths), chunk_size):
            chunk = normalized_paths[index:index + chunk_size]
            deleted = bucket_client.remove(chunk) or []
            deleted_total += len(deleted)
        return deleted_total

    def list_storage_ownership_paths_for_subjects(
        self,
        *,
        user_id: str,
        trainer_ids: list[str],
        client_ids: list[str],
    ) -> list[str]:
        if not self.table_is_accessible(table="storage_object_ownership"):
            return []

        paths: set[str] = set()

        def _fetch_by_values(column: str, values: list[str]) -> None:
            normalized = [str(value).strip() for value in values if str(value).strip()]
            if not normalized:
                return
            rows = (
                self.supabase_admin
                .table("storage_object_ownership")
                .select("object_path")
                .eq("is_active", True)
                .in_(column, normalized)
                .execute()
            ).data or []
            for row in rows:
                path = str(row.get("object_path") or "").strip().strip("/")
                if path:
                    paths.add(path)

        _fetch_by_values("owner_user_id", [user_id])
        _fetch_by_values("owner_trainer_id", trainer_ids)
        _fetch_by_values("owner_client_id", client_ids)
        return sorted(paths)

    def mark_storage_ownership_paths_deleted(
        self,
        *,
        paths: list[str],
        reason: str = "account_deletion",
    ) -> int:
        if not paths:
            return 0
        if not self.table_is_accessible(table="storage_object_ownership"):
            return 0

        normalized_paths = sorted({str(path).strip().strip("/") for path in paths if str(path).strip()})
        if not normalized_paths:
            return 0

        updated_total = 0
        now = datetime.now(timezone.utc).isoformat()
        chunk_size = 100
        for index in range(0, len(normalized_paths), chunk_size):
            chunk = normalized_paths[index:index + chunk_size]
            updated = (
                self.supabase_admin
                .table("storage_object_ownership")
                .update(
                    {
                        "is_active": False,
                        "deleted_at": now,
                        "deletion_reason": reason,
                    }
                )
                .in_("object_path", chunk)
                .eq("is_active", True)
                .execute()
            ).data or []
            updated_total += len(updated)
        return updated_total

    def delete_upload_grants_for_subjects(
        self,
        *,
        user_id: str,
        trainer_ids: list[str],
        client_ids: list[str],
    ) -> int:
        if not self.table_is_accessible(table="storage_upload_grants"):
            return 0

        candidate_ids: set[str] = set()

        def _fetch_ids(column: str, values: list[str]) -> None:
            normalized = [str(value).strip() for value in values if str(value).strip()]
            if not normalized:
                return
            rows = (
                self.supabase_admin
                .table("storage_upload_grants")
                .select("id")
                .in_(column, normalized)
                .execute()
            ).data or []
            for row in rows:
                row_id = str(row.get("id") or "").strip()
                if row_id:
                    candidate_ids.add(row_id)

        _fetch_ids("owner_user_id", [user_id])
        _fetch_ids("owner_trainer_id", trainer_ids)
        _fetch_ids("owner_client_id", client_ids)

        if not candidate_ids:
            return 0

        normalized_ids = sorted(candidate_ids)
        deleted_total = 0
        chunk_size = 100
        for index in range(0, len(normalized_ids), chunk_size):
            chunk = normalized_ids[index:index + chunk_size]
            deleted = (
                self.supabase_admin
                .table("storage_upload_grants")
                .delete()
                .in_("id", chunk)
                .execute()
            ).data or []
            deleted_total += len(deleted)
        return deleted_total

    def list_public_tables(self) -> list[str]:
        response = self.supabase_admin.rpc("security_list_public_tables", {}).execute()
        rows = response.data or []
        table_names: list[str] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("table_name") or "").strip()
            if name:
                table_names.append(name)
        return sorted(set(table_names))

    def table_is_accessible(self, *, table: str) -> bool:
        try:
            (
                self.supabase_admin
                .table(table)
                .select("id")
                .limit(1)
                .execute()
            )
            return True
        except Exception as exc:
            message = str(exc).lower()
            if "does not exist" in message or "schema cache" in message or "could not find the table" in message:
                return False
            raise

    def write_deletion_audit(
        self,
        *,
        deletion_request_id: str,
        outcome: str,
        actor_role: str,
        deleted_record_counts: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        (
            self.supabase_admin
            .table("account_deletion_audits")
            .insert(
                {
                    "deletion_request_id": deletion_request_id,
                    "completed_at": now,
                    "outcome": outcome,
                    "actor_role": actor_role,
                    "deleted_record_counts": deleted_record_counts,
                    "metadata": metadata or {},
                }
            )
            .execute()
        )

    def delete_auth_user(self, *, user_id: str) -> None:
        admin_api = self.supabase_admin.auth.admin
        try:
            admin_api.delete_user(user_id, should_soft_delete=False)
            return
        except TypeError:
            pass
        try:
            admin_api.delete_user(user_id, False)
            return
        except TypeError:
            pass
        admin_api.delete_user(user_id)
