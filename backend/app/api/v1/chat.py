from fastapi import APIRouter, Depends, HTTPException

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
