from __future__ import annotations

from datetime import datetime, timezone

from app.core.tenancy import TrainerContext
from app.modules.trainer_programs.repository import TrainerProgramRepository
from app.modules.trainer_programs.schemas import (
    TrainerProgramTemplate,
    TrainerProgramTemplateCreateRequest,
    TrainerProgramTemplateListResponse,
    TrainerProgramTemplatePatchRequest,
)


class TrainerProgramService:
    def __init__(self, repository: TrainerProgramRepository):
        self.repository = repository

    def list_templates(
        self,
        trainer_context: TrainerContext,
        *,
        include_archived: bool = False,
        limit: int = 120,
    ) -> TrainerProgramTemplateListResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        rows = self.repository.list_templates(
            trainer_id,
            include_archived=include_archived,
            limit=limit,
        )
        items = [TrainerProgramTemplate(**self._normalize_template_row(row)) for row in rows]
        return TrainerProgramTemplateListResponse(
            count=len(items),
            items=items,
        )

    def create_template(
        self,
        trainer_context: TrainerContext,
        request: TrainerProgramTemplateCreateRequest,
    ) -> TrainerProgramTemplate:
        trainer_id = self._require_trainer_id(trainer_context)
        now_iso = datetime.now(timezone.utc).isoformat()
        payload = {
            "trainer_id": trainer_id,
            "name": self._normalize_required_text(request.name, "Template name"),
            "goal_type": self._normalize_optional_text(request.goal_type),
            "experience_level": self._normalize_optional_text(request.experience_level),
            "equipment_access": self._normalize_optional_text(request.equipment_access),
            "frequency": request.frequency,
            "template_json": request.template_json or {},
            "metadata": request.metadata or {},
            "is_archived": False,
            "updated_at": now_iso,
        }
        created = self.repository.create_template(payload)
        if not created:
            raise ValueError("Program template create failed")
        return TrainerProgramTemplate(**self._normalize_template_row(created))

    def update_template(
        self,
        trainer_context: TrainerContext,
        template_id: str,
        request: TrainerProgramTemplatePatchRequest,
    ) -> TrainerProgramTemplate:
        trainer_id = self._require_trainer_id(trainer_context)
        existing = self.repository.get_template(trainer_id, template_id)
        if not existing:
            raise ValueError("Program template not found")

        provided_fields = set(getattr(request, "model_fields_set", set()))
        updates: dict[str, object] = {}
        if "name" in provided_fields and request.name is not None:
            updates["name"] = self._normalize_required_text(request.name, "Template name")
        if "goal_type" in provided_fields:
            updates["goal_type"] = self._normalize_optional_text(request.goal_type)
        if "experience_level" in provided_fields:
            updates["experience_level"] = self._normalize_optional_text(request.experience_level)
        if "equipment_access" in provided_fields:
            updates["equipment_access"] = self._normalize_optional_text(request.equipment_access)
        if "frequency" in provided_fields:
            updates["frequency"] = request.frequency
        if "template_json" in provided_fields and request.template_json is not None:
            updates["template_json"] = request.template_json
        if "metadata" in provided_fields and request.metadata is not None:
            updates["metadata"] = request.metadata

        if updates:
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()
            updated = self.repository.update_template(trainer_id, template_id, updates)
            row = updated or existing
        else:
            row = existing

        return TrainerProgramTemplate(**self._normalize_template_row(row))

    def archive_template(
        self,
        trainer_context: TrainerContext,
        template_id: str,
    ) -> TrainerProgramTemplate:
        trainer_id = self._require_trainer_id(trainer_context)
        existing = self.repository.get_template(trainer_id, template_id)
        if not existing:
            raise ValueError("Program template not found")

        if bool(existing.get("is_archived")):
            return TrainerProgramTemplate(**self._normalize_template_row(existing))

        updates = {
            "is_archived": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updated = self.repository.update_template(trainer_id, template_id, updates)
        row = updated or existing
        return TrainerProgramTemplate(**self._normalize_template_row(row))

    def _require_trainer_id(self, trainer_context: TrainerContext) -> str:
        trainer_id = str(trainer_context.trainer_id or "").strip()
        if not trainer_id:
            raise ValueError("No trainer context found")
        return trainer_id

    def _normalize_required_text(self, value: str, label: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError(f"{label} is required")
        return text

    def _normalize_optional_text(self, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _normalize_template_row(self, row: dict[str, object]) -> dict[str, object]:
        normalized = dict(row)
        if not isinstance(normalized.get("template_json"), dict):
            normalized["template_json"] = {}
        if not isinstance(normalized.get("metadata"), dict):
            normalized["metadata"] = {}
        normalized["is_archived"] = bool(normalized.get("is_archived", False))
        return normalized
