from __future__ import annotations

import logging

from fastapi import HTTPException

from app.core.config import Settings, settings as default_settings
from app.modules.feedback.repository import FeedbackAdminRepository, FeedbackRepository
from app.modules.feedback.schemas import (
    AdminFeedbackReportResponse,
    AdminUpdateReportRequest,
    CreateFeedbackReportRequest,
    FeedbackReportResponse,
)

logger = logging.getLogger(__name__)

_SCREENSHOT_SIGNED_URL_EXPIRY_SECONDS = 300


class FeedbackService:
    def __init__(self, repository: FeedbackRepository) -> None:
        self._repo = repository

    def create_report(
        self,
        *,
        user_id: str,
        request: CreateFeedbackReportRequest,
    ) -> FeedbackReportResponse:
        data = {
            "report_type": request.report_type,
            "summary": request.summary,
            "screen_context": request.screen_context.model_dump(),
            "debug_context": request.debug_context.model_dump(),
        }
        if request.steps_to_reproduce is not None:
            data["steps_to_reproduce"] = request.steps_to_reproduce
        if request.screenshot_bucket is not None:
            data["screenshot_bucket"] = request.screenshot_bucket
        if request.screenshot_object_path is not None:
            data["screenshot_object_path"] = request.screenshot_object_path

        row = self._repo.insert_report(user_id=user_id, data=data)
        return FeedbackReportResponse(
            id=str(row["id"]),
            report_type=row["report_type"],
            summary=row["summary"],
            status=row["status"],
            created_at=str(row["created_at"]),
        )


class FeedbackAdminService:
    def __init__(
        self,
        repository: FeedbackAdminRepository,
        app_settings: Settings | None = None,
    ) -> None:
        self._repo = repository
        self._settings = app_settings or default_settings

    def _assert_admin(self, email: str) -> None:
        if email.lower() not in self._settings.atlas_admin_email_allowlist_list:
            raise HTTPException(status_code=403, detail="Forbidden")

    def list_reports(
        self,
        *,
        email: str,
        status: str | None,
        limit: int,
        before: str | None,
    ) -> list[AdminFeedbackReportResponse]:
        self._assert_admin(email)
        rows = self._repo.list_reports(status=status, limit=limit, before=before)
        return [_row_to_admin_response(r) for r in rows]

    def update_report(
        self,
        *,
        email: str,
        report_id: str,
        reviewer_id: str,
        request: AdminUpdateReportRequest,
    ) -> AdminFeedbackReportResponse:
        self._assert_admin(email)
        updates: dict = {}
        if request.status is not None:
            updates["status"] = request.status
        if request.admin_notes is not None:
            updates["admin_notes"] = request.admin_notes

        row = self._repo.update_report(
            report_id=report_id,
            updates=updates,
            reviewed_by=reviewer_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found")
        return _row_to_admin_response(row)

    def get_screenshot_signed_url(
        self,
        *,
        email: str,
        report_id: str,
        supabase_admin,
    ) -> str:
        self._assert_admin(email)
        row = self._repo.get_report(report_id=report_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found")
        bucket = row.get("screenshot_bucket")
        path = row.get("screenshot_object_path")
        if not bucket or not path:
            raise HTTPException(status_code=404, detail="No screenshot attached to this report")

        try:
            result = supabase_admin.storage.from_(bucket).create_signed_url(
                path,
                _SCREENSHOT_SIGNED_URL_EXPIRY_SECONDS,
            )
            if isinstance(result, dict):
                signed_url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl")
            else:
                signed_url = getattr(result, "signed_url", None) or getattr(result, "signedURL", None)
            if not signed_url:
                raise HTTPException(status_code=502, detail="Failed to generate signed URL")
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Screenshot signed URL generation failed: %s", exc)
            raise HTTPException(status_code=502, detail="Failed to generate signed URL")

        return str(signed_url)


def _row_to_admin_response(row: dict) -> AdminFeedbackReportResponse:
    return AdminFeedbackReportResponse(
        id=str(row["id"]),
        report_type=row["report_type"],
        summary=row["summary"],
        status=row["status"],
        created_at=str(row["created_at"]),
        steps_to_reproduce=row.get("steps_to_reproduce"),
        screen_context=row.get("screen_context") or {},
        debug_context=row.get("debug_context") or {},
        screenshot_bucket=row.get("screenshot_bucket"),
        screenshot_object_path=row.get("screenshot_object_path"),
        admin_notes=row.get("admin_notes"),
        last_reviewed_by=str(row["last_reviewed_by"]) if row.get("last_reviewed_by") else None,
        updated_at=str(row["updated_at"]),
        user_id=str(row["user_id"]),
    )
