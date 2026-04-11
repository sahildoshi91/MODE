from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_knowledge_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocument,
    TrainerKnowledgeDocumentCreate,
    TrainerKnowledgeIngestRequest,
    TrainerKnowledgeIngestResponse,
    TrainerRule,
    TrainerRuleUpdateRequest,
)
from app.modules.trainer_knowledge.service import TrainerKnowledgeService


router = APIRouter()

@router.get("", response_model=list[TrainerKnowledgeDocument])
async def list_documents(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    return service.list_documents(trainer_id)


@router.post("", response_model=TrainerKnowledgeDocument)
async def create_document(
    request: TrainerKnowledgeDocumentCreate,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    return service.create_document(trainer_id, request)


@router.post("/ingest", response_model=TrainerKnowledgeIngestResponse)
async def ingest_document(
    request: TrainerKnowledgeIngestRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.ingest_document(trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rules", response_model=list[TrainerRule])
async def list_rules(
    include_archived: bool = Query(default=False),
    category: str | None = Query(default=None),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    return service.list_rules(
        trainer_id,
        include_archived=include_archived,
        category=category,
    )


@router.patch("/rules/{rule_id}", response_model=TrainerRule)
async def update_rule(
    rule_id: str,
    request: TrainerRuleUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_rule(trainer_context, rule_id, request)
    except ValueError as exc:
        if str(exc).lower() == "rule not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/rules/{rule_id}", response_model=TrainerRule)
async def archive_rule(
    rule_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.archive_rule(trainer_context, rule_id)
    except ValueError as exc:
        if str(exc).lower() == "rule not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
