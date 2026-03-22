from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_trainer_context, get_trainer_knowledge_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.schemas import TrainerKnowledgeDocument
from app.modules.trainer_knowledge.service import TrainerKnowledgeService


router = APIRouter()


@router.get("", response_model=list[TrainerKnowledgeDocument])
async def list_documents(
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.list_documents(trainer_context.trainer_id)


@router.post("", response_model=TrainerKnowledgeDocument)
async def create_document(
    request: TrainerKnowledgeDocument,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.create_document(trainer_context.trainer_id, request)
