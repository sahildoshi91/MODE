import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import ChatRequest, ChatResponse
from app.modules.conversation.service import ConversationProcessingError, ConversationService


router = APIRouter()


def _public_route_debug(route_debug: object | None) -> dict | None:
    if not settings.expose_route_debug or route_debug is None:
        return None
    return route_debug.model_dump()


def _public_chat_response(response: ChatResponse) -> ChatResponse:
    if settings.expose_route_debug:
        return response
    return response.model_copy(update={"route_debug": None})


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    try:
        return _public_chat_response(service.handle_chat(user.id, trainer_context, request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConversationProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    try:
        conversation_id, chunks, route_debug, result_state = service.stream_chat(user.id, trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConversationProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    def event_stream():
        start_payload = {
            "type": "start",
            "conversation_id": conversation_id,
        }
        route_debug_payload = _public_route_debug(route_debug)
        if route_debug_payload is not None:
            start_payload["route_debug"] = route_debug_payload
        yield f"data: {json.dumps(start_payload)}\n\n"
        try:
            for chunk in chunks:
                yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
            done_payload = {
                "type": "done",
                "conversation_id": conversation_id,
                "token_usage": result_state.token_usage.model_dump(),
                "conversation_usage": result_state.conversation_usage.model_dump() if result_state.conversation_usage else None,
            }
            route_debug_payload = _public_route_debug(route_debug)
            if route_debug_payload is not None:
                done_payload["route_debug"] = route_debug_payload
            yield f"data: {json.dumps(done_payload)}\n\n"
        except ConversationProcessingError as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc), 'conversation_id': conversation_id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
