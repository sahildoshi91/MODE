from __future__ import annotations

from app.core.tenancy import TrainerContext
from app.modules.trainer_settings.repository import TrainerSettingsRepository
from app.modules.trainer_settings.schemas import TrainerSettingsPatchRequest, TrainerSettingsResponse


ASSISTANT_DISPLAY_NAME_MAX_LENGTH = 30


class TrainerSettingsService:
    def __init__(self, repository: TrainerSettingsRepository):
        self.repository = repository

    def get_settings(self, trainer_context: TrainerContext) -> TrainerSettingsResponse:
        trainer_id = trainer_context.trainer_id or ""
        if not trainer_id:
            raise ValueError("No trainer context found")

        row = self.repository.get_trainer_settings(trainer_id)
        if not row:
            raise ValueError("Trainer not found")

        return TrainerSettingsResponse(
            trainer_id=trainer_id,
            default_meeting_location=self._normalize_meeting_location(row.get("default_meeting_location")),
            auto_fill_meeting_location=bool(row.get("auto_fill_meeting_location", True)),
            assistant_display_name=self._normalize_assistant_display_name_for_read(row.get("assistant_display_name")),
        )

    def patch_settings(
        self,
        trainer_context: TrainerContext,
        request: TrainerSettingsPatchRequest,
    ) -> TrainerSettingsResponse:
        trainer_id = trainer_context.trainer_id or ""
        if not trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_trainer_settings(trainer_id)
        if not existing:
            raise ValueError("Trainer not found")

        provided_fields = set(getattr(request, "model_fields_set", set()))
        updates: dict[str, object] = {}
        if "default_meeting_location" in provided_fields:
            updates["default_meeting_location"] = self._normalize_meeting_location_for_write(request.default_meeting_location)
        if "auto_fill_meeting_location" in provided_fields:
            updates["auto_fill_meeting_location"] = bool(request.auto_fill_meeting_location)
        if "assistant_display_name" in provided_fields:
            updates["assistant_display_name"] = self._normalize_assistant_display_name_for_write(
                request.assistant_display_name,
            )

        if updates:
            updated = self.repository.update_trainer_settings(trainer_id, updates)
            row = updated or existing
        else:
            row = existing

        return TrainerSettingsResponse(
            trainer_id=trainer_id,
            default_meeting_location=self._normalize_meeting_location(row.get("default_meeting_location")),
            auto_fill_meeting_location=bool(row.get("auto_fill_meeting_location", True)),
            assistant_display_name=self._normalize_assistant_display_name_for_read(row.get("assistant_display_name")),
        )

    def _normalize_meeting_location(self, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _normalize_meeting_location_for_write(self, value: object) -> str | None:
        normalized = self._normalize_meeting_location(value)
        if normalized is not None and len(normalized) > 160:
            raise ValueError("Meeting location must be 160 characters or fewer")
        return normalized

    def _normalize_assistant_display_name_for_read(self, value: object) -> str | None:
        normalized = self._coerce_assistant_display_name(value)
        if normalized is None:
            return None
        if len(normalized) > ASSISTANT_DISPLAY_NAME_MAX_LENGTH:
            return None
        return normalized

    def _normalize_assistant_display_name_for_write(self, value: object) -> str | None:
        normalized = self._coerce_assistant_display_name(value)
        if normalized is not None and len(normalized) > ASSISTANT_DISPLAY_NAME_MAX_LENGTH:
            raise ValueError(
                f"Assistant display name must be {ASSISTANT_DISPLAY_NAME_MAX_LENGTH} characters or fewer",
            )
        return normalized

    def _coerce_assistant_display_name(self, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None
