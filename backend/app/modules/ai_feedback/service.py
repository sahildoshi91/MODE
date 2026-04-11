from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.config import settings
from app.modules.ai_feedback.delta_extractor import FeedbackDeltaExtractor
from app.modules.ai_feedback.repository import AIFeedbackRepository
from app.modules.ai_feedback.schemas import (
    AIFeedbackEvent,
    AIGeneratedOutput,
    AIOutputApproveRequest,
    AIOutputDetailResponse,
    AIOutputEditRequest,
    AIOutputListResponse,
    AIOutputMutationResponse,
    AIOutputRejectRequest,
)


logger = logging.getLogger(__name__)


class AIFeedbackService:
    def __init__(
        self,
        repository: AIFeedbackRepository,
        *,
        delta_extractor: FeedbackDeltaExtractor | None = None,
    ):
        self.repository = repository
        self.delta_extractor = delta_extractor

    def log_generated_output(
        self,
        *,
        tenant_id: str,
        trainer_id: str,
        client_id: str | None,
        source_type: str,
        source_ref_id: str | None,
        output_text: str | None,
        output_json: dict[str, Any] | None = None,
        generation_metadata: dict[str, Any] | None = None,
        conversation_id: str | None = None,
        message_id: str | None = None,
    ) -> AIGeneratedOutput | None:
        if not tenant_id or not trainer_id or not source_type:
            return None
        if source_ref_id is None:
            return None

        now_iso = datetime.now(timezone.utc).isoformat()
        normalized_output_json = self._normalize_output_json(source_type, output_json or {})
        normalized_generation_metadata = self._normalize_generation_metadata(
            source_type=source_type,
            generation_metadata=generation_metadata or {},
            generated_at=now_iso,
        )
        payload = {
            "tenant_id": tenant_id,
            "trainer_id": trainer_id,
            "client_id": client_id,
            "source_type": source_type,
            "source_ref_id": source_ref_id,
            "conversation_id": conversation_id,
            "message_id": message_id,
            "output_text": output_text,
            "output_json": normalized_output_json,
            "generation_metadata": normalized_generation_metadata,
            "review_status": "open",
            "reviewed_output_text": None,
            "reviewed_output_json": None,
            "reviewed_at": None,
            "updated_at": now_iso,
        }
        row = self.repository.upsert_generated_output(payload)
        if not row:
            return None
        return AIGeneratedOutput(**row)

    def list_outputs(
        self,
        trainer_id: str,
        *,
        status: str | None = None,
        source_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AIOutputListResponse:
        rows = self.repository.list_generated_outputs(
            trainer_id,
            status=status,
            source_type=source_type,
            limit=limit,
            offset=offset,
        )
        items = [AIGeneratedOutput(**row) for row in rows]
        return AIOutputListResponse(items=items, count=len(items))

    def get_output_detail(self, trainer_id: str, output_id: str) -> AIOutputDetailResponse:
        output_row = self.repository.get_generated_output(trainer_id, output_id)
        if not output_row:
            raise ValueError("Output not found")
        event_rows = self.repository.list_feedback_events(output_id)
        return AIOutputDetailResponse(
            output=AIGeneratedOutput(**output_row),
            feedback_events=[AIFeedbackEvent(**row) for row in event_rows],
        )

    def edit_output(
        self,
        trainer_id: str,
        output_id: str,
        request: AIOutputEditRequest,
    ) -> AIOutputMutationResponse:
        output = self._require_output(trainer_id, output_id)
        effective_text = (
            request.edited_output_text.strip()
            if isinstance(request.edited_output_text, str)
            else (output.reviewed_output_text or output.output_text)
        )
        effective_json = self._resolve_effective_json(output, request.edited_output_json)
        now_iso = datetime.now(timezone.utc).isoformat()

        updated_row = self.repository.update_generated_output(
            trainer_id,
            output_id,
            {
                "review_status": "open",
                "reviewed_output_text": effective_text,
                "reviewed_output_json": effective_json,
                "reviewed_at": now_iso,
                "updated_at": now_iso,
            },
        )
        if not updated_row:
            raise ValueError("Output update failed")
        updated_output = AIGeneratedOutput(**updated_row)

        feedback_event, auto_applied_count = self._create_feedback_event(
            output=updated_output,
            event_type="edited",
            edited_output_text=effective_text,
            edited_output_json=effective_json,
            metadata={
                "notes": request.notes,
                "mutation_source": "trainer_review_edit",
            },
            auto_apply_deltas=bool(request.auto_apply_deltas),
        )
        return AIOutputMutationResponse(
            output=updated_output,
            feedback_event=feedback_event,
            auto_applied_count=auto_applied_count,
        )

    def approve_output(
        self,
        trainer_id: str,
        output_id: str,
        request: AIOutputApproveRequest,
    ) -> AIOutputMutationResponse:
        output = self._require_output(trainer_id, output_id)
        effective_text = (
            request.edited_output_text.strip()
            if isinstance(request.edited_output_text, str)
            else (output.reviewed_output_text or output.output_text)
        )
        effective_json = self._resolve_effective_json(output, request.edited_output_json)
        now_iso = datetime.now(timezone.utc).isoformat()

        updated_row = self.repository.update_generated_output(
            trainer_id,
            output_id,
            {
                "review_status": "approved",
                "reviewed_output_text": effective_text,
                "reviewed_output_json": effective_json,
                "reviewed_at": now_iso,
                "updated_at": now_iso,
            },
        )
        if not updated_row:
            raise ValueError("Output approval failed")
        updated_output = AIGeneratedOutput(**updated_row)

        feedback_event, auto_applied_count = self._create_feedback_event(
            output=updated_output,
            event_type="approved",
            edited_output_text=effective_text,
            edited_output_json=effective_json,
            metadata={
                "response_tags": request.response_tags,
                "mutation_source": "trainer_review_approve",
            },
            auto_apply_deltas=bool(request.auto_apply_deltas),
        )
        return AIOutputMutationResponse(
            output=updated_output,
            feedback_event=feedback_event,
            auto_applied_count=auto_applied_count,
        )

    def reject_output(
        self,
        trainer_id: str,
        output_id: str,
        request: AIOutputRejectRequest,
    ) -> AIOutputMutationResponse:
        output = self._require_output(trainer_id, output_id)
        effective_text = (
            request.edited_output_text.strip()
            if isinstance(request.edited_output_text, str)
            else (output.reviewed_output_text or output.output_text)
        )
        effective_json = self._resolve_effective_json(output, request.edited_output_json)
        now_iso = datetime.now(timezone.utc).isoformat()

        updated_row = self.repository.update_generated_output(
            trainer_id,
            output_id,
            {
                "review_status": "rejected",
                "reviewed_output_text": effective_text,
                "reviewed_output_json": effective_json,
                "reviewed_at": now_iso,
                "updated_at": now_iso,
            },
        )
        if not updated_row:
            raise ValueError("Output rejection failed")
        updated_output = AIGeneratedOutput(**updated_row)

        feedback_event, auto_applied_count = self._create_feedback_event(
            output=updated_output,
            event_type="rejected",
            edited_output_text=effective_text,
            edited_output_json=effective_json,
            metadata={
                "reason": request.reason,
                "mutation_source": "trainer_review_reject",
            },
            auto_apply_deltas=False,
        )
        return AIOutputMutationResponse(
            output=updated_output,
            feedback_event=feedback_event,
            auto_applied_count=auto_applied_count,
        )

    def _require_output(self, trainer_id: str, output_id: str) -> AIGeneratedOutput:
        row = self.repository.get_generated_output(trainer_id, output_id)
        if not row:
            raise ValueError("Output not found")
        return AIGeneratedOutput(**row)

    def _resolve_effective_json(
        self,
        output: AIGeneratedOutput,
        edited_output_json: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if edited_output_json is not None:
            return edited_output_json
        if output.reviewed_output_json is not None:
            return output.reviewed_output_json
        return output.output_json or {}

    def _create_feedback_event(
        self,
        *,
        output: AIGeneratedOutput,
        event_type: str,
        edited_output_text: str | None,
        edited_output_json: dict[str, Any] | None,
        metadata: dict[str, Any],
        auto_apply_deltas: bool,
    ) -> tuple[AIFeedbackEvent, int]:
        apply_status = "not_applicable"
        apply_error = None
        extracted_deltas: list[dict[str, Any]] = []
        auto_applied_count = 0
        feedback_event_id = str(uuid4())
        extraction_summary: dict[str, Any] = {
            "strategy": "skipped",
            "fallback_reason": None,
            "deltas_count": 0,
        }

        should_extract = event_type in {"edited", "approved"} and bool(output.client_id)
        auto_apply_requested = bool(auto_apply_deltas)
        auto_apply_feature_enabled = bool(settings.trainer_ai_review_auto_apply_enabled)
        auto_apply_effective = bool(auto_apply_requested and auto_apply_feature_enabled)
        auto_apply_skipped_reason: str | None = None

        if should_extract:
            extracted_deltas, extraction_summary = self._get_delta_extractor().extract(
                original_text=output.output_text,
                edited_text=edited_output_text,
            )
            if extracted_deltas:
                if auto_apply_effective and output.client_id:
                    apply_status = "pending"
                elif auto_apply_requested and not auto_apply_feature_enabled:
                    auto_apply_skipped_reason = "feature_flag_disabled"
                elif not auto_apply_requested:
                    auto_apply_skipped_reason = "request_disabled"

        if apply_status == "pending" and output.client_id:
            try:
                auto_applied_count = self._apply_deltas_to_coach_memory(
                    output=output,
                    feedback_event_id=feedback_event_id,
                    deltas=extracted_deltas,
                )
                apply_status = "applied"
            except Exception as exc:
                logger.exception("Auto-apply delta failed output_id=%s event_type=%s", output.id, event_type)
                apply_status = "failed"
                apply_error = str(exc)

        now_iso = datetime.now(timezone.utc).isoformat()
        event_metadata = {
            **metadata,
            "auto_apply_requested": auto_apply_requested,
            "auto_apply_feature_enabled": auto_apply_feature_enabled,
            "auto_apply_effective": auto_apply_effective,
            "auto_applied_count": auto_applied_count,
            "auto_apply_skipped_reason": auto_apply_skipped_reason,
            "extraction_summary": extraction_summary,
            "event_schema_version": "v1",
            "created_at": now_iso,
        }
        event_row = self.repository.insert_feedback_event(
            {
                "id": feedback_event_id,
                "tenant_id": output.tenant_id,
                "trainer_id": output.trainer_id,
                "client_id": output.client_id,
                "output_id": output.id,
                "event_type": event_type,
                "original_output_text": output.output_text,
                "edited_output_text": edited_output_text,
                "original_output_json": output.output_json or {},
                "edited_output_json": edited_output_json or {},
                "extracted_deltas": extracted_deltas,
                "apply_status": apply_status,
                "apply_error": apply_error,
                "metadata": event_metadata,
            }
        )
        if not event_row:
            raise ValueError("Could not create feedback event")
        feedback_event = AIFeedbackEvent(**event_row)
        return feedback_event, auto_applied_count

    def _apply_deltas_to_coach_memory(
        self,
        *,
        output: AIGeneratedOutput,
        feedback_event_id: str,
        deltas: list[dict[str, Any]],
    ) -> int:
        trainer_id = output.trainer_id
        client_id = output.client_id
        if not trainer_id or not client_id:
            return 0

        applied_count = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        for delta in deltas:
            memory_type = str(delta.get("memory_type") or "note").strip().lower()
            if memory_type not in {"note", "preference", "constraint"}:
                memory_type = "note"
            memory_key = str(delta.get("memory_key") or "").strip()
            text = str(delta.get("text") or "").strip()
            if not memory_key or not text:
                continue

            tags = self._normalize_tags(delta.get("tags"))
            provenance = {
                "version": "v1",
                "source": "ai_review_auto_delta",
                "source_type": "trainer_review_feedback",
                "output_id": output.id,
                "feedback_event_id": feedback_event_id,
                "applied_at": now_iso,
                "policy": "client_local_only",
            }

            existing = self.repository.find_memory_by_key(trainer_id, client_id, memory_key)
            if existing:
                value_json = existing.get("value_json")
                existing_value = value_json if isinstance(value_json, dict) else {}
                existing_tags = self._normalize_tags(existing_value.get("tags"))
                merged_tags = self._merge_tags(existing_tags, tags)
                structured_data = existing_value.get("structured_data")
                if not isinstance(structured_data, dict):
                    structured_data = {}

                updated = self.repository.update_memory(
                    trainer_id,
                    client_id,
                    str(existing.get("id")),
                    {
                        "memory_type": memory_type,
                        "value_json": {
                            **existing_value,
                            "visibility": "ai_usable",
                            "is_archived": False,
                            "text": text,
                            "tags": merged_tags,
                            "structured_data": structured_data,
                            "provenance": provenance,
                        },
                        "updated_at": now_iso,
                    },
                )
                if updated:
                    applied_count += 1
                continue

            created = self.repository.insert_memory(
                {
                    "trainer_id": trainer_id,
                    "client_id": client_id,
                    "memory_type": memory_type,
                    "memory_key": memory_key,
                    "value_json": {
                        "visibility": "ai_usable",
                        "is_archived": False,
                        "text": text,
                        "tags": tags,
                        "structured_data": {},
                        "provenance": provenance,
                    },
                    "updated_at": now_iso,
                }
            )
            if created:
                applied_count += 1

        return applied_count

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        seen: set[str] = set()
        for tag in value:
            text = str(tag or "").strip().lower()
            if not text or text in seen:
                continue
            seen.add(text)
            tags.append(text[:40])
        return tags[:8]

    def _merge_tags(self, left: list[str], right: list[str]) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for tag in [*left, *right]:
            normalized = str(tag or "").strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(normalized[:40])
            if len(merged) >= 8:
                break
        return merged

    def _normalize_output_json(self, source_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": "ai_output_payload.v1",
            "source_type": source_type,
            **(payload or {}),
        }

    def _normalize_generation_metadata(
        self,
        *,
        source_type: str,
        generation_metadata: dict[str, Any],
        generated_at: str,
    ) -> dict[str, Any]:
        producer = str(generation_metadata.get("producer") or "unknown").strip().lower() or "unknown"
        strategy = str(generation_metadata.get("generation_strategy") or "unspecified").strip().lower()
        return {
            "schema_version": "ai_output_generation_metadata.v1",
            "source_type": source_type,
            "producer": producer,
            "generation_strategy": strategy,
            "generated_at": generation_metadata.get("generated_at") or generated_at,
            **(generation_metadata or {}),
        }

    def _get_delta_extractor(self) -> FeedbackDeltaExtractor:
        if self.delta_extractor is None:
            self.delta_extractor = FeedbackDeltaExtractor()
        return self.delta_extractor
