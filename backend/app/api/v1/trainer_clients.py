from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_client_service, get_trainer_context
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.conversation.cache import invalidate_chat_context
from app.modules.trainer_clients.schemas import (
    ConnectionRequestStatus,
    TrainerAIContextResponse,
    TrainerClientConnectionRequestDecisionRequest,
    TrainerClientConnectionRequestListResponse,
    TrainerClientConnectionRequestRecord,
    TrainerClientDetailResponse,
    TrainerClientIdentity,
    TrainerClientInviteCodeCreateRequest,
    TrainerClientInviteCodeListResponse,
    TrainerClientInviteCodeRecord,
    TrainerClientListResponse,
    TrainerClientUpdateRequest,
    TrainerMeetingLocationRecord,
    TrainerMeetingLocationUpdateRequest,
    TrainerMemoryCreateRequest,
    TrainerMemoryRecord,
    TrainerMemoryUpdateRequest,
    TrainerScheduleExceptionCreateRequest,
    TrainerScheduleExceptionRecord,
    TrainerSchedulePreferencesRecord,
    TrainerSchedulePreferencesUpdateRequest,
)
from app.modules.trainer_clients.service import TrainerClientService


router = APIRouter()
INVITE_CODES_SERVICE_ONLY_DETAIL = (
    "Invite code management is service-controlled. Contact platform support to issue or revoke codes."
)

def _handle_service_value_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() in {
        "client not found for trainer",
        "memory not found",
        "invite code not found",
        "connection request not found",
        "connection request client not found",
        "no scheduled session found for client on requested date",
        "schedule exception not found",
    }:
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


def _invalidate_client_chat_context(trainer_context: TrainerContext, client_id: str, *, reason: str) -> None:
    if trainer_context.trainer_id and client_id:
        invalidate_chat_context(trainer_context.trainer_id, client_id, reason=reason)


@router.get("", response_model=TrainerClientListResponse)
async def list_trainer_clients(
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_clients(
            trainer_context,
            search=search,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/invite-codes", response_model=TrainerClientInviteCodeListResponse)
async def list_trainer_client_invite_codes(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    del limit, offset, service
    raise HTTPException(status_code=403, detail=INVITE_CODES_SERVICE_ONLY_DETAIL)


@router.post("/invite-codes", response_model=TrainerClientInviteCodeRecord)
async def create_trainer_client_invite_code(
    request: TrainerClientInviteCodeCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    del request, service
    raise HTTPException(status_code=403, detail=INVITE_CODES_SERVICE_ONLY_DETAIL)


@router.delete("/invite-codes/{invite_id}", response_model=TrainerClientInviteCodeRecord)
async def deactivate_trainer_client_invite_code(
    invite_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    del invite_id, service
    raise HTTPException(status_code=403, detail=INVITE_CODES_SERVICE_ONLY_DETAIL)


@router.get("/connection-requests", response_model=TrainerClientConnectionRequestListResponse)
async def list_trainer_client_connection_requests(
    status: ConnectionRequestStatus | None = Query(default="pending"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_connection_requests(trainer_context, status=status)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.post(
    "/connection-requests/{request_id}/approve",
    response_model=TrainerClientConnectionRequestRecord,
)
async def approve_trainer_client_connection_request(
    request_id: str,
    request: TrainerClientConnectionRequestDecisionRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.approve_connection_request(trainer_context, request_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.post(
    "/connection-requests/{request_id}/reject",
    response_model=TrainerClientConnectionRequestRecord,
)
async def reject_trainer_client_connection_request(
    request_id: str,
    request: TrainerClientConnectionRequestDecisionRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.reject_connection_request(trainer_context, request_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.patch("/{client_id}", response_model=TrainerClientIdentity)
async def patch_trainer_client(
    client_id: str,
    request: TrainerClientUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_client(trainer_context, client_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.delete("/{client_id}", response_model=TrainerClientIdentity)
async def delete_trainer_client(
    client_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.remove_client(trainer_context, client_id)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/detail", response_model=TrainerClientDetailResponse)
async def get_trainer_client_detail(
    client_id: str,
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    target_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.get_client_detail(
            trainer_context,
            client_id,
            target_date=target_date,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/memory", response_model=list[TrainerMemoryRecord])
async def list_trainer_client_memory(
    client_id: str,
    include_archived: bool = Query(default=False),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_memory(
            trainer_context,
            client_id,
            include_archived=include_archived,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.post("/{client_id}/memory", response_model=TrainerMemoryRecord)
async def create_trainer_client_memory(
    client_id: str,
    request: TrainerMemoryCreateRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    enforce_rate_limit(
        group="memory_create",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": client_id,
        },
    )
    try:
        response = service.create_memory(trainer_context, client_id, request)
        _invalidate_client_chat_context(trainer_context, client_id, reason="trainer_note_added")
        return response
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.patch("/{client_id}/memory/{memory_id}", response_model=TrainerMemoryRecord)
async def patch_trainer_client_memory(
    client_id: str,
    memory_id: str,
    request: TrainerMemoryUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        response = service.update_memory(trainer_context, client_id, memory_id, request)
        _invalidate_client_chat_context(trainer_context, client_id, reason="trainer_note_updated")
        return response
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.delete("/{client_id}/memory/{memory_id}", response_model=TrainerMemoryRecord)
async def archive_trainer_client_memory(
    client_id: str,
    memory_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        response = service.archive_memory(trainer_context, client_id, memory_id)
        _invalidate_client_chat_context(trainer_context, client_id, reason="trainer_note_deleted")
        return response
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/ai-context", response_model=TrainerAIContextResponse)
async def get_trainer_client_ai_context(
    client_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.get_ai_context(trainer_context, client_id)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.patch("/{client_id}/meeting-location", response_model=TrainerMeetingLocationRecord)
async def patch_trainer_client_meeting_location(
    client_id: str,
    request: TrainerMeetingLocationUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_meeting_location(trainer_context, client_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/schedule-preferences", response_model=TrainerSchedulePreferencesRecord)
async def get_trainer_client_schedule_preferences(
    client_id: str,
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.get_schedule_preferences(
            trainer_context,
            client_id,
            selected_date=request_date,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.patch("/{client_id}/schedule-preferences", response_model=TrainerSchedulePreferencesRecord)
async def patch_trainer_client_schedule_preferences(
    client_id: str,
    request: TrainerSchedulePreferencesUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_schedule_preferences(trainer_context, client_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.post("/{client_id}/schedule-exceptions", response_model=TrainerScheduleExceptionRecord)
async def create_trainer_client_schedule_exception(
    client_id: str,
    request: TrainerScheduleExceptionCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.create_schedule_exception(trainer_context, client_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.delete("/{client_id}/schedule-exceptions/{session_date}", response_model=TrainerScheduleExceptionRecord)
async def delete_trainer_client_schedule_exception(
    client_id: str,
    session_date: date,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.delete_schedule_exception(
            trainer_context,
            client_id,
            session_date=session_date,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)
