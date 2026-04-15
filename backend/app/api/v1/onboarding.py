from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_onboarding_service
from app.modules.onboarding.schemas import (
    OnboardingBootstrapResponse,
    OnboardingCompleteRequest,
    OnboardingRoleRequest,
    OnboardingStatePatchRequest,
)
from app.modules.onboarding.service import OnboardingService, OnboardingServiceError


router = APIRouter()


@router.get("/bootstrap", response_model=OnboardingBootstrapResponse)
async def get_onboarding_bootstrap(
    user: AuthenticatedUser = CurrentUser,
    service: OnboardingService = Depends(get_onboarding_service),
):
    return service.get_bootstrap(user)


@router.post("/role", response_model=OnboardingBootstrapResponse)
async def post_onboarding_role(
    request: OnboardingRoleRequest,
    user: AuthenticatedUser = CurrentUser,
    service: OnboardingService = Depends(get_onboarding_service),
):
    try:
        return service.set_role(user=user, request=request)
    except OnboardingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.patch("/state", response_model=OnboardingBootstrapResponse)
async def patch_onboarding_state(
    request: OnboardingStatePatchRequest,
    user: AuthenticatedUser = CurrentUser,
    service: OnboardingService = Depends(get_onboarding_service),
):
    try:
        return service.patch_state(user=user, request=request)
    except OnboardingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/complete", response_model=OnboardingBootstrapResponse)
async def complete_onboarding(
    request: OnboardingCompleteRequest,
    user: AuthenticatedUser = CurrentUser,
    service: OnboardingService = Depends(get_onboarding_service),
):
    try:
        return service.complete_onboarding(user=user, request=request)
    except OnboardingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
