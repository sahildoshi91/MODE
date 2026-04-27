from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings
from app.modules.storage_lifecycle.repository import StorageLifecycleRepository


class StorageLifecycleError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = int(status_code)


@dataclass(frozen=True)
class UploadGrantVerificationResult:
    bucket: str
    object_path: str
    status: str
    verified: bool


class StorageLifecycleService:
    def __init__(self, repository: StorageLifecycleRepository):
        self.repository = repository

    def record_upload_grant(
        self,
        *,
        upload_token: str,
        bucket: str,
        object_path: str,
        scope: str,
        owner_user_id: str,
        owner_trainer_id: str | None,
        owner_client_id: str | None,
        expires_in_seconds: int,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=max(1, int(expires_in_seconds)))
        payload = {
            "upload_token": str(upload_token).strip(),
            "bucket": str(bucket).strip(),
            "object_path": str(object_path).strip().strip("/"),
            "scope": str(scope).strip(),
            "owner_user_id": str(owner_user_id).strip(),
            "owner_trainer_id": str(owner_trainer_id).strip() if owner_trainer_id else None,
            "owner_client_id": str(owner_client_id).strip() if owner_client_id else None,
            "issued_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "status": "issued",
            "metadata": {"source": "signed_upload_url"},
            "updated_at": now.isoformat(),
        }
        return self.repository.create_upload_grant(payload)

    def verify_upload_completion(
        self,
        *,
        upload_token: str,
        bucket: str,
        object_path: str,
        owner_user_id: str,
        owner_trainer_id: str | None,
        owner_client_id: str | None,
    ) -> UploadGrantVerificationResult:
        normalized_token = str(upload_token or "").strip()
        normalized_bucket = str(bucket or "").strip()
        normalized_path = str(object_path or "").strip().strip("/")
        if not normalized_token or not normalized_bucket or not normalized_path:
            raise StorageLifecycleError("upload_token, bucket, and object_path are required", status_code=422)

        grant = self.repository.get_upload_grant(upload_token=normalized_token)
        if not grant:
            raise StorageLifecycleError("Upload grant was not found", status_code=404)

        expected_bucket = str(grant.get("bucket") or "").strip()
        expected_path = str(grant.get("object_path") or "").strip().strip("/")
        expected_owner_user_id = str(grant.get("owner_user_id") or "").strip()
        expected_owner_trainer_id = str(grant.get("owner_trainer_id") or "").strip() or None
        expected_owner_client_id = str(grant.get("owner_client_id") or "").strip() or None

        if (
            expected_bucket != normalized_bucket
            or expected_path != normalized_path
            or expected_owner_user_id != str(owner_user_id).strip()
            or expected_owner_trainer_id != (str(owner_trainer_id).strip() if owner_trainer_id else None)
            or expected_owner_client_id != (str(owner_client_id).strip() if owner_client_id else None)
        ):
            self.repository.update_upload_grant(
                upload_token=normalized_token,
                payload={
                    "status": "rejected",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "metadata": {"reason": "ownership_or_path_mismatch"},
                },
            )
            raise StorageLifecycleError("Upload ownership validation failed", status_code=403)

        expires_at = self._parse_timestamp(grant.get("expires_at"))
        grace_seconds = max(0, int(settings.storage_upload_verification_grace_seconds))
        if datetime.now(timezone.utc) > (expires_at + timedelta(seconds=grace_seconds)):
            self.repository.delete_storage_paths(bucket=expected_bucket, paths=[expected_path])
            self.repository.update_upload_grant(
                upload_token=normalized_token,
                payload={
                    "status": "expired",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "metadata": {"reason": "upload_window_expired"},
                },
            )
            raise StorageLifecycleError("Upload window expired", status_code=410)

        if not self.repository.storage_object_exists(bucket=expected_bucket, object_path=expected_path):
            raise StorageLifecycleError("Uploaded file is not available yet", status_code=404)

        now_iso = datetime.now(timezone.utc).isoformat()
        self.repository.upsert_storage_object_ownership(
            {
                "bucket": expected_bucket,
                "object_path": expected_path,
                "owner_user_id": expected_owner_user_id,
                "owner_trainer_id": expected_owner_trainer_id,
                "owner_client_id": expected_owner_client_id,
                "source_upload_grant_id": grant.get("id"),
                "is_active": True,
                "deleted_at": None,
                "deletion_reason": None,
                "updated_at": now_iso,
                "metadata": {"verified_via": "upload_complete"},
            }
        )
        self.repository.update_upload_grant(
            upload_token=normalized_token,
            payload={
                "status": "verified",
                "verified_at": now_iso,
                "updated_at": now_iso,
            },
        )

        return UploadGrantVerificationResult(
            bucket=expected_bucket,
            object_path=expected_path,
            status="verified",
            verified=True,
        )

    def run_cleanup(
        self,
        *,
        bucket: str,
        known_prefixes: list[str],
        dry_run: bool = False,
        max_items: int = 1000,
    ) -> dict[str, int]:
        now_iso = datetime.now(timezone.utc).isoformat()
        max_items = max(1, min(int(max_items), 10000))
        normalized_bucket = str(bucket or "").strip()
        if not normalized_bucket:
            raise StorageLifecycleError("storage private bucket is required for cleanup", status_code=500)

        expired_uploads = self.repository.list_expired_unverified_upload_grants(now_iso=now_iso, limit=max_items)
        expired_paths = sorted(
            {
                str(row.get("object_path") or "").strip().strip("/")
                for row in expired_uploads
                if str(row.get("bucket") or "").strip() == normalized_bucket and str(row.get("object_path") or "").strip()
            }
        )
        if not dry_run and expired_paths:
            self.repository.delete_storage_paths(bucket=normalized_bucket, paths=expired_paths)
            for row in expired_uploads:
                token = str(row.get("upload_token") or "").strip()
                if not token:
                    continue
                self.repository.update_upload_grant(
                    upload_token=token,
                    payload={
                        "status": "cleaned",
                        "updated_at": now_iso,
                        "metadata": {"reason": "expired_or_unverified_cleanup"},
                    },
                )

        ownership_rows = self.repository.list_active_storage_ownership_rows(limit=max_items)
        ownership_paths = {
            str(row.get("object_path") or "").strip().strip("/")
            for row in ownership_rows
            if str(row.get("bucket") or "").strip() == normalized_bucket and str(row.get("object_path") or "").strip()
        }
        live_bucket_paths = set(self.repository.list_all_storage_paths(bucket=normalized_bucket, prefixes=known_prefixes))
        orphan_paths = sorted(live_bucket_paths - ownership_paths)
        stale_ownership_paths = sorted(ownership_paths - live_bucket_paths)

        if not dry_run and orphan_paths:
            self.repository.delete_storage_paths(bucket=normalized_bucket, paths=orphan_paths)
        if not dry_run and stale_ownership_paths:
            self.repository.mark_ownership_paths_deleted(paths=stale_ownership_paths, reason="orphaned_metadata_cleanup")

        live_user_ids = self.repository.list_user_account_ids(limit=max_items)
        deleted_user_paths = sorted(
            {
                str(row.get("object_path") or "").strip().strip("/")
                for row in ownership_rows
                if str(row.get("bucket") or "").strip() == normalized_bucket
                and str(row.get("owner_user_id") or "").strip()
                and str(row.get("owner_user_id") or "").strip() not in live_user_ids
            }
        )
        if not dry_run and deleted_user_paths:
            self.repository.delete_storage_paths(bucket=normalized_bucket, paths=deleted_user_paths)
            self.repository.mark_ownership_paths_deleted(paths=deleted_user_paths, reason="deleted_user_cleanup")

        return {
            "expired_upload_grants_seen": len(expired_uploads),
            "expired_upload_paths": len(expired_paths),
            "orphan_object_paths": len(orphan_paths),
            "stale_ownership_paths": len(stale_ownership_paths),
            "deleted_user_paths": len(deleted_user_paths),
            "dry_run": 1 if dry_run else 0,
        }

    def record_cleanup_heartbeat(
        self,
        *,
        run_source: str,
        status: str,
        bucket: str,
        result: dict[str, Any] | None,
        started_at_iso: str,
        finished_at_iso: str,
        expected_interval_minutes: int,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        normalized_source = str(run_source or "").strip().lower()
        if normalized_source not in {"scheduled", "manual", "release_gate"}:
            normalized_source = "manual"

        normalized_status = str(status or "").strip().lower()
        if normalized_status not in {"succeeded", "failed"}:
            normalized_status = "failed"

        metrics = result if isinstance(result, dict) else {}
        payload = {
            "run_source": normalized_source,
            "status": normalized_status,
            "bucket": str(bucket or "").strip(),
            "expired_upload_paths": int(metrics.get("expired_upload_paths") or 0),
            "orphan_object_paths": int(metrics.get("orphan_object_paths") or 0),
            "stale_ownership_paths": int(metrics.get("stale_ownership_paths") or 0),
            "deleted_user_paths": int(metrics.get("deleted_user_paths") or 0),
            "dry_run": bool(int(metrics.get("dry_run") or 0)),
            "expected_interval_minutes": max(1, int(expected_interval_minutes)),
            "started_at": str(started_at_iso or datetime.now(timezone.utc).isoformat()),
            "finished_at": str(finished_at_iso or datetime.now(timezone.utc).isoformat()),
            "error_message": str(error_message or "").strip() or None,
        }
        return self.repository.create_cleanup_job_heartbeat(payload)

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime:
        text = str(value or "").strip()
        if not text:
            return datetime.now(timezone.utc)
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
