from fastapi import APIRouter, Depends, Request

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_mobile_analytics_service
from app.core.rate_limit import enforce_rate_limit
from app.modules.mobile_analytics.service import MobileAnalyticsService
from app.modules.onboarding.schemas import AnalyticsEventsRequest, AnalyticsEventsResponse


router = APIRouter()


@router.post("/mobile-events", response_model=AnalyticsEventsResponse)
async def ingest_mobile_events(
    request: AnalyticsEventsRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    service: MobileAnalyticsService = Depends(get_mobile_analytics_service),
):
    enforce_rate_limit(group="mobile_events", user=user, request=http_request)
    return service.ingest_events(user=user, request=request)
