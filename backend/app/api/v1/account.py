from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_request_scoped_supabase_client
from app.modules.account_deletion.repository import AccountDeletionRequestRepository
from app.modules.account_deletion.service import AccountDeletionService
from app.modules.intelligence_jobs.queue import enqueue_intelligence_job
from app.modules.intelligence_jobs.schemas import IntelligenceJob


router = APIRouter()


class DeleteMyAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=32)


class DeleteMyAccountResponse(BaseModel):
    deletion_request_id: str
    outcome: Literal["queued"] = "queued"
    actor_role: Literal["client", "trainer", "mixed", "unassigned"] = "unassigned"
    worker_job_id: str | None = None


@router.delete("/me", response_model=DeleteMyAccountResponse, status_code=status.HTTP_202_ACCEPTED)
async def delete_my_account(
    request: DeleteMyAccountRequest,
    user: AuthenticatedUser = CurrentUser,
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    if str(request.confirmation or "").strip().upper() != AccountDeletionService.CONFIRMATION_TOKEN:
        raise HTTPException(status_code=422, detail="Invalid deletion confirmation")

    deletion_request_id = str(uuid4())
    job = IntelligenceJob(
        job_type="account_deletion",
        trainer_id="",
        client_id="",
        conversation_id=deletion_request_id,
        trace_id=deletion_request_id,
        payload={
            "request_id": deletion_request_id,
            "user_id": user.id,
        },
    )
    request_repository = AccountDeletionRequestRepository(supabase)
    request_repository.create_request(
        request_id=deletion_request_id,
        user_id=user.id,
        job_id=job.job_id,
    )
    enqueue_result = enqueue_intelligence_job(job)
    if not enqueue_result.ok:
        request_repository.mark_enqueue_failed(
            request_id=deletion_request_id,
            error_category=enqueue_result.error_category or "enqueue_failed",
        )
        raise HTTPException(status_code=503, detail="Account deletion queue unavailable")

    return DeleteMyAccountResponse(
        deletion_request_id=deletion_request_id,
        actor_role="unassigned",
        worker_job_id=job.job_id,
    )
