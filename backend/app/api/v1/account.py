from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_account_deletion_service
from app.modules.account_deletion.service import AccountDeletionService, AccountDeletionServiceError


router = APIRouter()


class DeleteMyAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=32)


class DeleteMyAccountResponse(BaseModel):
    deletion_request_id: str
    outcome: Literal["succeeded"] = "succeeded"
    actor_role: Literal["client", "trainer", "mixed", "unassigned"] = "unassigned"


@router.delete("/me", response_model=DeleteMyAccountResponse)
async def delete_my_account(
    request: DeleteMyAccountRequest,
    user: AuthenticatedUser = CurrentUser,
    service: AccountDeletionService = Depends(get_account_deletion_service),
):
    try:
        result = service.delete_account(user=user, confirmation=request.confirmation)
    except AccountDeletionServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return DeleteMyAccountResponse(
        deletion_request_id=result.deletion_request_id,
        actor_role=result.actor_role,
    )
