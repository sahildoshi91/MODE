from __future__ import annotations

from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

from supabase import Client


class StorageLifecycleRepository:
    def __init__(self, supabase_admin: Client):
        self.supabase_admin = supabase_admin

    def create_upload_grant(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase_admin.table("storage_upload_grants").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def get_upload_grant(self, *, upload_token: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("storage_upload_grants")
            .select("*")
            .eq("upload_token", upload_token)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def update_upload_grant(self, *, upload_token: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("storage_upload_grants")
            .update(payload)
            .eq("upload_token", upload_token)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def upsert_storage_object_ownership(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase_admin
            .table("storage_object_ownership")
            .upsert(payload, on_conflict="object_path")
            .execute()
        )
        return (response.data or [None])[0] or {}

    def list_expired_unverified_upload_grants(
        self,
        *,
        now_iso: str,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        return (
            self.supabase_admin
            .table("storage_upload_grants")
            .select("id, upload_token, bucket, object_path, owner_user_id, expires_at, status")
            .in_("status", ["issued", "rejected", "expired"])
            .lt("expires_at", now_iso)
            .order("expires_at", desc=False)
            .limit(max(1, min(int(limit), 1000)))
            .execute()
        ).data or []

    def list_active_storage_ownership_rows(self, *, limit: int = 3000) -> list[dict[str, Any]]:
        return (
            self.supabase_admin
            .table("storage_object_ownership")
            .select("id, bucket, object_path, owner_user_id, owner_trainer_id, owner_client_id, is_active, deleted_at")
            .eq("is_active", True)
            .order("created_at", desc=False)
            .limit(max(1, min(int(limit), 10000)))
            .execute()
        ).data or []

    def list_user_account_ids(self, *, limit: int = 10000) -> set[str]:
        rows = (
            self.supabase_admin
            .table("user_accounts")
            .select("auth_user_id")
            .limit(max(1, min(int(limit), 100000)))
            .execute()
        ).data or []
        return {
            str(row.get("auth_user_id") or "").strip()
            for row in rows
            if str(row.get("auth_user_id") or "").strip()
        }

    def mark_ownership_paths_deleted(self, *, paths: list[str], reason: str) -> int:
        normalized = sorted({str(path).strip().strip("/") for path in paths if str(path).strip()})
        if not normalized:
            return 0

        now_iso = datetime.now(timezone.utc).isoformat()
        updated_total = 0
        chunk_size = 100
        for index in range(0, len(normalized), chunk_size):
            chunk = normalized[index:index + chunk_size]
            updated = (
                self.supabase_admin
                .table("storage_object_ownership")
                .update(
                    {
                        "is_active": False,
                        "deleted_at": now_iso,
                        "deletion_reason": reason,
                        "updated_at": now_iso,
                    }
                )
                .in_("object_path", chunk)
                .eq("is_active", True)
                .execute()
            ).data or []
            updated_total += len(updated)
        return updated_total

    def storage_object_exists(self, *, bucket: str, object_path: str) -> bool:
        normalized = str(object_path or "").strip().strip("/")
        if not normalized:
            return False
        object_name = PurePosixPath(normalized).name
        parent = str(PurePosixPath(normalized).parent)
        if parent == ".":
            parent = ""
        rows = self.supabase_admin.storage.from_(bucket).list(path=parent) or []
        for row in rows:
            if str(row.get("name") or "").strip() != object_name:
                continue
            if row.get("id"):
                return True
        return False

    def list_storage_paths_for_prefix(self, *, bucket: str, prefix: str) -> list[str]:
        normalized_prefix = str(prefix or "").strip().strip("/")
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
                child_path = f"{current}/{name}".strip("/") if current else name
                if row.get("id"):
                    collected_paths.append(child_path)
                else:
                    pending_directories.append(child_path)
        return collected_paths

    def list_all_storage_paths(self, *, bucket: str, prefixes: list[str]) -> list[str]:
        all_paths: set[str] = set()
        for prefix in prefixes:
            normalized_prefix = str(prefix or "").strip().strip("/")
            all_paths.update(self.list_storage_paths_for_prefix(bucket=bucket, prefix=normalized_prefix))
        return sorted(all_paths)

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

    def create_cleanup_job_heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase_admin
            .table("storage_cleanup_job_heartbeats")
            .insert(payload)
            .execute()
        )
        return (response.data or [None])[0] or {}
