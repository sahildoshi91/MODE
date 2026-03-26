import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import ChatRequest, ChatResponse
from app.modules.conversation.service import ConversationService


router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    try:
        return service.handle_chat(user.id, trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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

    def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'conversation_id': conversation_id, 'route_debug': route_debug.model_dump()})}\n\n"
        for chunk in chunks:
            yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
        done_payload = {
            'type': 'done',
            'conversation_id': conversation_id,
            'route_debug': route_debug.model_dump(),
            'token_usage': result_state.token_usage.model_dump(),
            'conversation_usage': result_state.conversation_usage.model_dump() if result_state.conversation_usage else None,
        }
        yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
