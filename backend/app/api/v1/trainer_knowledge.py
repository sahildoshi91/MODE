from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_knowledge_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocument,
    TrainerKnowledgeDocumentCreate,
    TrainerKnowledgeDocumentUpdateRequest,
    TrainerKnowledgeEntry,
    TrainerKnowledgeEntryCreateRequest,
    TrainerKnowledgeEntryMutationResponse,
    TrainerKnowledgeEntryUpdateRequest,
    TrainerKnowledgeClassificationRequest,
    TrainerKnowledgeClassificationSuggestion,
    TrainerKnowledgeIngestRequest,
    TrainerKnowledgeRefineRequest,
    TrainerKnowledgeSaveResponse,
    TrainerKnowledgeVersion,
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


@router.post("/ingest", response_model=TrainerKnowledgeSaveResponse)
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


@router.get("/entries", response_model=list[TrainerKnowledgeEntry])
async def list_entries(
    include_archived: bool = Query(default=False),
    scope: str | None = Query(default=None),
    ai_usable: bool | None = Query(default=None),
    ai_enabled: bool | None = Query(default=None),
    client_id: str | None = Query(default=None),
    query: str | None = Query(default=None),
    limit: int = Query(default=120, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    resolved_ai_usable = ai_usable if isinstance(ai_usable, bool) else ai_enabled
    return service.list_entries(
        trainer_context,
        include_archived=include_archived,
        scope=scope,
        ai_enabled=resolved_ai_usable,
        client_id=client_id,
        query=query,
        limit=limit,
        offset=offset,
    )


@router.post("/entries/classify", response_model=TrainerKnowledgeClassificationSuggestion)
async def classify_entry(
    request: TrainerKnowledgeClassificationRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.classify_entry(trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/entries", response_model=TrainerKnowledgeEntryMutationResponse)
async def create_entry(
    request: TrainerKnowledgeEntryCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.create_entry(trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/entries/{entry_id}", response_model=TrainerKnowledgeEntryMutationResponse)
async def update_entry(
    entry_id: str,
    request: TrainerKnowledgeEntryUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_entry(trainer_context, entry_id, request)
    except ValueError as exc:
        if str(exc).lower() == "entry not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/entries/{entry_id}", response_model=TrainerKnowledgeEntryMutationResponse)
async def archive_entry(
    entry_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.archive_entry(trainer_context, entry_id)
    except ValueError as exc:
        if str(exc).lower() == "entry not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/entries/{entry_id}/refine", response_model=TrainerKnowledgeEntryMutationResponse)
async def refine_entry(
    entry_id: str,
    request: TrainerKnowledgeRefineRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.refine_entry(trainer_context, entry_id, request)
    except ValueError as exc:
        if str(exc).lower() == "entry not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/entries/{entry_id}/versions", response_model=list[TrainerKnowledgeVersion])
async def list_entry_versions(
    entry_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    return service.list_entry_versions(trainer_context, entry_id, limit=limit)


@router.patch("/{document_id}", response_model=TrainerKnowledgeSaveResponse)
async def update_document(
    document_id: str,
    request: TrainerKnowledgeDocumentUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_document(trainer_context, document_id, request)
    except ValueError as exc:
        if str(exc).lower() == "document not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{document_id}", response_model=TrainerKnowledgeDocument)
async def delete_document(
    document_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerKnowledgeService = Depends(get_trainer_knowledge_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.delete_document(trainer_context, document_id)
    except ValueError as exc:
        if str(exc).lower() == "document not found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
