from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request
from supabase import Client

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_request_scoped_supabase_client
from app.core.rate_limit import enforce_rate_limit
from app.db.client import get_supabase_admin_client
from app.modules.feedback.repository import FeedbackAdminRepository, FeedbackRepository
from app.modules.feedback.schemas import (
    AdminFeedbackReportResponse,
    AdminScreenshotUrlResponse,
    AdminUpdateReportRequest,
    CreateFeedbackReportRequest,
    FeedbackReportResponse,
)
from app.modules.feedback.service import FeedbackAdminService, FeedbackService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/reports", status_code=201, response_model=FeedbackReportResponse)
async def submit_report(
    body: CreateFeedbackReportRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> FeedbackReportResponse:
    enforce_rate_limit(group="feedback", user=user, request=request, context={})
    service = FeedbackService(FeedbackRepository(supabase))
    return service.create_report(user_id=str(user.id), request=body)


@router.get("/admin/reports", response_model=list[AdminFeedbackReportResponse])
async def list_admin_reports(
    request: Request,
    status: str | None = Query(default=None),
    limit: int = Query(default=20, le=100),
    before: str | None = Query(default=None),
    user: AuthenticatedUser = Depends(require_user),
) -> list[AdminFeedbackReportResponse]:
    admin_supabase = get_supabase_admin_client()
    service = FeedbackAdminService(FeedbackAdminRepository(admin_supabase))
    return service.list_reports(
        email=user.email or "",
        status=status,
        limit=limit,
        before=before,
    )


@router.patch("/admin/reports/{report_id}", response_model=AdminFeedbackReportResponse)
async def update_admin_report(
    report_id: str,
    body: AdminUpdateReportRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> AdminFeedbackReportResponse:
    admin_supabase = get_supabase_admin_client()
    service = FeedbackAdminService(FeedbackAdminRepository(admin_supabase))
    return service.update_report(
        email=user.email or "",
        report_id=report_id,
        reviewer_id=str(user.id),
        request=body,
    )


@router.get(
    "/admin/reports/{report_id}/screenshot-url",
    response_model=AdminScreenshotUrlResponse,
)
async def get_screenshot_signed_url(
    report_id: str,
    user: AuthenticatedUser = Depends(require_user),
) -> AdminScreenshotUrlResponse:
    admin_supabase = get_supabase_admin_client()
    service = FeedbackAdminService(FeedbackAdminRepository(admin_supabase))
    signed_url = service.get_screenshot_signed_url(
        email=user.email or "",
        report_id=report_id,
        supabase_admin=admin_supabase,
    )
    return AdminScreenshotUrlResponse(signed_url=signed_url, expires_in=300)
