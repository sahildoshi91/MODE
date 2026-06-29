from __future__ import annotations

from collections import Counter
import hashlib
import hmac
import logging
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.tenancy import TrainerContext
from app.modules.checkin_signals import build_checkin_question_summaries
from app.modules.motivation import resolve_motivation_baseline
from app.modules.trainer_clients.repository import TrainerClientRepository
from app.modules.trainer_clients.schemas import (
    ClientTrainerScheduleResponse,
    ConnectionRequestStatus,
    TrainerAIContextMemoryItem,
    TrainerAIContextResponse,
    TrainerClientActivitySummary,
    TrainerClientConnectionRequestDecisionRequest,
    TrainerClientConnectionRequestListResponse,
    TrainerClientConnectionRequestRecord,
    TrainerClientDetailResponse,
    TrainerClientIdentity,
    TrainerClientInviteCodeCreateRequest,
    TrainerClientInviteCodeCreateResponse,
    TrainerClientInviteCodeListResponse,
    TrainerClientInviteCodeRecord,
    TrainerClientListResponse,
    TrainerClientUpdateRequest,
    TrainerScheduleExceptionCreateRequest,
    TrainerScheduleExceptionRecord,
    TrainerSchedulePreferencesRecord,
    TrainerSchedulePreferencesUpdateRequest,
    TrainerMeetingLocationRecord,
    TrainerMeetingLocationUpdateRequest,
    TrainerMemoryCounts,
    TrainerMemoryCreateRequest,
    TrainerMemoryRecord,
    TrainerMemoryUpdateRequest,
    TrainerRuleSummaryItem,
)

LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}


class TrainerClientService:
    def __init__(self, repository: TrainerClientRepository):
        self.repository = repository

    def list_clients(
        self,
        trainer_context: TrainerContext,
        *,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> TrainerClientListResponse:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        normalized_search = self._normalize_search_term(search)
        paged_loader = getattr(self.repository, "list_clients_for_trainer_page", None)
        if callable(paged_loader):
            page = paged_loader(
                trainer_id,
                tenant_id,
                search=normalized_search,
                limit=limit,
                offset=offset,
            )
            paginated_rows = [
                row
                for row in (page.get("items") if isinstance(page, dict) else []) or []
                if self._client_belongs_to_tenant(row, tenant_id)
            ]
            filtered_count = int(page.get("count") or 0) if isinstance(page, dict) else len(paginated_rows)
        else:
            rows = self.repository.list_clients_for_trainer(trainer_id)
            filtered_rows = [
                row
                for row in rows
                if self._client_belongs_to_tenant(row, tenant_id)
                and self._client_matches_search(row, normalized_search)
            ]
            paginated_rows = filtered_rows[offset:offset + limit]
            filtered_count = len(filtered_rows)
        client_ids = [
            str(row.get("id") or "").strip()
            for row in paginated_rows
            if str(row.get("id") or "").strip()
        ]
        profile_status_by_client_id = self.repository.list_profile_onboarding_status_for_clients(client_ids)
        return TrainerClientListResponse(
            items=[
                self._to_client_identity(
                    row,
                    is_pending_user=self._is_pending_user(
                        profile_status_by_client_id.get(str(row.get("id") or "").strip()),
                    ),
                )
                for row in paginated_rows
            ],
            count=filtered_count,
            limit=limit,
            offset=offset,
            search=normalized_search,
        )

    def list_connection_requests(
        self,
        trainer_context: TrainerContext,
        *,
        status: ConnectionRequestStatus | None = "pending",
    ) -> TrainerClientConnectionRequestListResponse:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        rows = self.repository.list_connection_requests_for_trainer(
            trainer_id=trainer_id,
            status=status,
        )
        records: list[TrainerClientConnectionRequestRecord] = []
        for row in rows:
            client_row = self.repository.get_client_by_id(str(row.get("client_id") or ""))
            if not client_row or not self._client_belongs_to_tenant(client_row, tenant_id):
                continue
            records.append(self._to_connection_request_record(row, client_row=client_row))
        return TrainerClientConnectionRequestListResponse(
            items=records,
            count=len(records),
            status=status,
        )

    def approve_connection_request(
        self,
        trainer_context: TrainerContext,
        request_id: str,
        request: TrainerClientConnectionRequestDecisionRequest,
    ) -> TrainerClientConnectionRequestRecord:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        row = self._require_connection_request(trainer_id, request_id)
        if not self._connection_request_belongs_to_tenant(row, tenant_id):
            raise ValueError("Connection request not found")
        if row.get("status") != "pending":
            raise ValueError("Connection request is already resolved")
        client = self.repository.get_client_by_id(str(row.get("client_id") or ""))
        if not client or not self._client_belongs_to_tenant(client, tenant_id):
            raise ValueError("Connection request client not found")
        existing_trainer = client.get("assigned_trainer_id")
        if existing_trainer and existing_trainer != trainer_id:
            raise ValueError("Client is already assigned to another trainer")

        updated_client = self.repository.update_client_assignment(
            client_id=str(client["id"]),
            tenant_id=tenant_id,
            trainer_id=trainer_id,
        )
        if not updated_client:
            raise ValueError("Connection request approval failed")
        if not existing_trainer:
            self.repository.insert_assignment_history(
                client_id=str(client["id"]),
                trainer_id=trainer_id,
            )
        updated = self.repository.update_connection_request(
            request_id=request_id,
            trainer_id=trainer_id,
            fields={
                "status": "approved",
                "trainer_response_note": request.trainer_response_note,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if not updated:
            raise ValueError("Connection request approval failed")
        return self._to_connection_request_record(updated, client_row=updated_client)

    def reject_connection_request(
        self,
        trainer_context: TrainerContext,
        request_id: str,
        request: TrainerClientConnectionRequestDecisionRequest,
    ) -> TrainerClientConnectionRequestRecord:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        row = self._require_connection_request(trainer_id, request_id)
        if not self._connection_request_belongs_to_tenant(row, tenant_id):
            raise ValueError("Connection request not found")
        if row.get("status") != "pending":
            raise ValueError("Connection request is already resolved")
        updated = self.repository.update_connection_request(
            request_id=request_id,
            trainer_id=trainer_id,
            fields={
                "status": "rejected",
                "trainer_response_note": request.trainer_response_note,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if not updated:
            raise ValueError("Connection request reject failed")
        return self._to_connection_request_record(updated)

    def update_client(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerClientUpdateRequest,
    ) -> TrainerClientIdentity:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        existing = self._require_client_assignment(trainer_context, client_id)
        if not self._client_belongs_to_tenant(existing, tenant_id):
            raise ValueError("Client not found for trainer")
        client_name = self._normalize_client_name_for_write(request.client_name)
        updated = self.repository.update_client_for_trainer(
            trainer_id,
            client_id,
            {"client_name": client_name},
        )
        if not updated:
            raise ValueError("Client not found for trainer")
        return self._to_client_identity(updated)

    def remove_client(
        self,
        trainer_context: TrainerContext,
        client_id: str,
    ) -> TrainerClientIdentity:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        client_row = self._require_client_assignment(trainer_context, client_id)
        if not self._client_belongs_to_tenant(client_row, tenant_id):
            raise ValueError("Client not found for trainer")
        updated = self.repository.update_client_for_trainer(
            trainer_id,
            client_id,
            {"assigned_trainer_id": None},
        )
        if not updated:
            raise ValueError("Client remove failed")

        active_assignment = self.repository.get_latest_active_assignment(trainer_id, client_id)
        if active_assignment and active_assignment.get("id"):
            unassigned = self.repository.mark_assignment_unassigned(
                str(active_assignment["id"]),
                unassigned_at=datetime.now(timezone.utc).isoformat(),
            )
            if not unassigned:
                raise ValueError("Client remove failed")

        detached = dict(client_row)
        detached["assigned_trainer_id"] = None
        detached["created_at"] = updated.get("created_at", client_row.get("created_at"))
        return self._to_client_identity(detached)

    HMAC_PEPPER_ID = "v1"
    INVITE_CODE_EXPIRY_HOURS = 12
    _MAX_CODE_COLLISION_RETRIES = 5

    def list_invite_codes(
        self,
        trainer_context: TrainerContext,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> TrainerClientInviteCodeListResponse:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        rows = self.repository.list_invite_codes_for_trainer(trainer_id, tenant_id)
        paginated_rows = rows[offset:offset + limit]
        return TrainerClientInviteCodeListResponse(
            items=[self._to_invite_code_metadata_record(row) for row in paginated_rows],
            count=len(rows),
            limit=limit,
            offset=offset,
        )

    def create_invite_code(
        self,
        trainer_context: TrainerContext,
        request: TrainerClientInviteCodeCreateRequest,  # noqa: ARG002
    ) -> TrainerClientInviteCodeCreateResponse:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        pepper = settings.invite_code_hmac_pepper
        if not pepper:
            raise ValueError("Invite code service is not configured")

        expires_at = datetime.now(timezone.utc) + timedelta(hours=self.INVITE_CODE_EXPIRY_HOURS)

        for _attempt in range(self._MAX_CODE_COLLISION_RETRIES):
            plaintext = secrets.token_urlsafe(16)
            code_hash = hmac.new(
                pepper.encode("utf-8"),
                plaintext.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not self.repository.get_invite_code_by_hash(code_hash=code_hash):
                break
        else:
            logger.error("invite_code_create_collision_limit_reached trainer=%s", trainer_id)
            raise ValueError("Invite code create failed")

        created = self.repository.create_invite_code({
            "trainer_id": trainer_id,
            "tenant_id": tenant_id,
            "code_hash": code_hash,
            "hmac_pepper_id": self.HMAC_PEPPER_ID,
            "is_active": True,
            "expires_at": expires_at.isoformat(),
        })
        if not created:
            raise ValueError("Invite code create failed")

        return TrainerClientInviteCodeCreateResponse(
            id=str(created.get("id") or ""),
            code=plaintext,
            trainer_id=str(created.get("trainer_id") or ""),
            tenant_id=str(created.get("tenant_id") or ""),
            expires_at=self._coerce_datetime(created.get("expires_at")),
            created_at=self._coerce_datetime(created.get("created_at")),
        )

    def revoke_invite_code(
        self,
        trainer_context: TrainerContext,
        invite_id: str,
    ) -> TrainerClientInviteCodeRecord:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        existing = self.repository.get_invite_code_for_trainer(trainer_id, tenant_id, invite_id)
        if not existing:
            raise ValueError("Invite code not found")
        updated = self.repository.revoke_invite_code_for_trainer(trainer_id, tenant_id, invite_id)
        if not updated:
            raise ValueError("Invite code not found")
        return self._to_invite_code_metadata_record(updated)

    def get_client_detail(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        target_date: date | None = None,
    ) -> TrainerClientDetailResponse:
        client_row = self._require_client_assignment(trainer_context, client_id)
        trainer_id = trainer_context.trainer_id or ""
        resolved_date = target_date or datetime.now(timezone.utc).date()
        trainer_settings = self.repository.get_trainer_settings(trainer_id) if trainer_id else None
        schedule_preferences = self._build_schedule_preferences(
            trainer_id=trainer_id,
            client_id=client_id,
            trainer_settings=trainer_settings,
            selected_date=resolved_date,
            include_upcoming_exceptions=True,
        )
        profile_snapshot = self._get_or_create_profile(client_id)
        activity_summary = self._build_activity_summary(
            trainer_id=trainer_id,
            client_row=client_row,
            target_date=resolved_date,
            trainer_settings=trainer_settings,
            schedule_preferences=schedule_preferences,
        )
        memory_rows = self.repository.list_memory(
            trainer_id,
            client_id,
            include_archived=True,
        )
        memory_counts = self._memory_counts(memory_rows)

        return TrainerClientDetailResponse(
            client=TrainerClientIdentity(
                client_id=client_row["id"],
                client_name=self._client_name(client_row),
                tenant_id=client_row.get("tenant_id"),
                user_id=client_row.get("user_id"),
            ),
            profile_snapshot=profile_snapshot,
            activity_summary=activity_summary,
            memory_counts=memory_counts,
            schedule_preferences=schedule_preferences,
        )

    def list_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        include_archived: bool = False,
    ) -> list[TrainerMemoryRecord]:
        self._require_client_assignment(trainer_context, client_id)
        rows = self.repository.list_memory(
            trainer_context.trainer_id or "",
            client_id,
            include_archived=include_archived,
        )
        return [self._to_memory_record(row) for row in rows]

    def create_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerMemoryCreateRequest,
    ) -> TrainerMemoryRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)

        memory_key = request.memory_key.strip() if isinstance(request.memory_key, str) else ""
        if not memory_key:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            memory_key = f"{request.memory_type}_{timestamp}"

        text = request.text.strip() if isinstance(request.text, str) else None
        if not text and not request.structured_data:
            raise ValueError("Memory entry requires text or structured_data")

        payload = {
            "trainer_id": trainer_id,
            "client_id": client_id,
            "memory_type": request.memory_type,
            "memory_key": memory_key,
            "value_json": {
                "source": "trainer",
                "created_by": "trainer",
                "client_visible": False,
                "ai_usable": request.visibility == "ai_usable",
                "visibility": request.visibility,
                "is_archived": False,
                "text": text,
                "category": request.memory_type,
                "tags": self._normalize_tags(request.tags),
                "structured_data": request.structured_data or {},
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        created = self.repository.insert_memory(payload)
        if not created:
            raise ValueError("Memory create failed")
        return self._to_memory_record(created)

    def update_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        memory_id: str,
        request: TrainerMemoryUpdateRequest,
    ) -> TrainerMemoryRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)
        existing = self.repository.get_memory(trainer_id, client_id, memory_id)
        if not existing:
            raise ValueError("Memory not found")

        value_json = existing.get("value_json")
        value = value_json if isinstance(value_json, dict) else {}
        next_value = dict(value)

        if request.visibility is not None:
            next_value["visibility"] = request.visibility
            next_value["ai_usable"] = request.visibility == "ai_usable"
        if request.text is not None:
            text = request.text.strip()
            next_value["text"] = text or None
        if request.tags is not None:
            next_value["tags"] = self._normalize_tags(request.tags)
        if request.structured_data is not None:
            next_value["structured_data"] = request.structured_data
        if request.is_archived is not None:
            next_value["is_archived"] = bool(request.is_archived)

        updates: dict[str, Any] = {
            "value_json": next_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if request.memory_type is not None:
            updates["memory_type"] = request.memory_type
        if request.memory_key is not None:
            memory_key = request.memory_key.strip()
            if not memory_key:
                raise ValueError("Memory key cannot be empty")
            updates["memory_key"] = memory_key

        updated = self.repository.update_memory(trainer_id, client_id, memory_id, updates)
        if not updated:
            raise ValueError("Memory update failed")
        return self._to_memory_record(updated)

    def archive_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        memory_id: str,
    ) -> TrainerMemoryRecord:
        return self.update_memory(
            trainer_context,
            client_id,
            memory_id,
            TrainerMemoryUpdateRequest(is_archived=True),
        )

    def get_ai_context(
        self,
        trainer_context: TrainerContext,
        client_id: str,
    ) -> TrainerAIContextResponse:
        client_row = self._require_client_assignment(trainer_context, client_id)
        profile_snapshot = self._get_or_create_profile(client_id)
        memory_rows = self.repository.list_memory(
            trainer_context.trainer_id or "",
            client_id,
            include_archived=False,
        )
        records = [self._to_memory_record(row) for row in memory_rows]
        ai_usable = [row for row in records if row.visibility == "ai_usable" and not row.is_archived]
        internal_only_count = sum(
            1
            for row in records
            if row.visibility == "internal_only" and not row.is_archived
        )

        rule_rows = self.repository.list_active_trainer_rules(trainer_context.trainer_id or "")
        category_counts: Counter[str] = Counter()
        for rule_row in rule_rows:
            category = str(rule_row.get("category") or "general_coaching").strip().lower()
            category_counts[category] += 1

        summary_items = [
            TrainerRuleSummaryItem(category=category, rule_count=count)
            for category, count in category_counts.most_common(6)
        ]
        context_preview_text = self._build_context_preview_text(
            client_name=self._client_name(client_row),
            profile_snapshot=profile_snapshot,
            ai_usable=ai_usable,
            internal_only_count=internal_only_count,
            summary_items=summary_items,
        )

        return TrainerAIContextResponse(
            client_id=client_id,
            applied_ai_usable_memory=[
                TrainerAIContextMemoryItem(
                    id=record.id,
                    memory_type=record.memory_type,
                    memory_key=record.memory_key,
                    text=record.text,
                    tags=record.tags,
                    structured_data=record.structured_data,
                )
                for record in ai_usable
            ],
            internal_only_memory_count=internal_only_count,
            profile_snapshot=profile_snapshot,
            trainer_rule_summary=summary_items,
            context_preview_text=context_preview_text,
        )

    def update_meeting_location(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerMeetingLocationUpdateRequest,
    ) -> TrainerMeetingLocationRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)

        schedule_row = self.repository.get_schedule_for_day(trainer_id, client_id, request.session_date)
        if not schedule_row:
            raise ValueError("No scheduled session found for client on requested date")

        schedule_id = str(schedule_row.get("id") or "").strip()
        if not schedule_id:
            raise ValueError("No scheduled session found for client on requested date")

        meeting_location = self._normalize_meeting_location_for_write(request.meeting_location)
        updated = self.repository.update_schedule_meeting_location(
            schedule_id,
            meeting_location=meeting_location,
        )
        if not updated:
            raise ValueError("Meeting location update failed")

        return TrainerMeetingLocationRecord(
            schedule_id=str(updated.get("id") or schedule_id),
            client_id=str(updated.get("client_id") or client_id),
            session_date=self._coerce_date(updated.get("session_date"), request.session_date) or request.session_date,
            meeting_location=self._normalize_meeting_location(updated.get("meeting_location")),
        )

    def get_schedule_preferences(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        selected_date: date | None = None,
    ) -> TrainerSchedulePreferencesRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)
        trainer_settings = self.repository.get_trainer_settings(trainer_id) if trainer_id else None
        return self._build_schedule_preferences(
            trainer_id=trainer_id,
            client_id=client_id,
            trainer_settings=trainer_settings,
            selected_date=selected_date,
            include_upcoming_exceptions=True,
        )

    def update_schedule_preferences(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerSchedulePreferencesUpdateRequest,
    ) -> TrainerSchedulePreferencesRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)

        existing = self.repository.get_schedule_preferences(trainer_id, client_id) or {}
        provided_fields = set(getattr(request, "model_fields_set", set()))

        recurring_weekdays = self._normalize_weekdays(existing.get("recurring_weekdays"))
        if "recurring_weekdays" in provided_fields:
            recurring_weekdays = self._normalize_weekdays(request.recurring_weekdays)

        preferred_meeting_location = self._normalize_meeting_location(existing.get("preferred_meeting_location"))
        if "preferred_meeting_location" in provided_fields:
            preferred_meeting_location = self._normalize_meeting_location_for_write(request.preferred_meeting_location)

        auto_use_default = bool(existing.get("auto_use_trainer_default_location", True))
        if "auto_use_trainer_default_location" in provided_fields:
            auto_use_default = bool(request.auto_use_trainer_default_location)

        payload = {
            "trainer_id": trainer_id,
            "client_id": client_id,
            "recurring_weekdays": recurring_weekdays,
            "preferred_meeting_location": preferred_meeting_location,
            "auto_use_trainer_default_location": auto_use_default,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updated = self.repository.upsert_schedule_preferences(payload)
        if not updated:
            raise ValueError("Schedule preferences update failed")

        trainer_settings = self.repository.get_trainer_settings(trainer_id) if trainer_id else None
        return self._build_schedule_preferences(
            trainer_id=trainer_id,
            client_id=client_id,
            trainer_settings=trainer_settings,
            include_upcoming_exceptions=True,
        )

    def create_schedule_exception(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerScheduleExceptionCreateRequest,
    ) -> TrainerScheduleExceptionRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)
        meeting_location_override = self._normalize_meeting_location_for_write(request.meeting_location_override)
        payload = {
            "trainer_id": trainer_id,
            "client_id": client_id,
            "session_date": request.session_date.isoformat(),
            "exception_type": request.exception_type,
            "meeting_location_override": meeting_location_override,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        upserted = self.repository.upsert_schedule_exception(payload)
        if not upserted:
            raise ValueError("Schedule exception save failed")
        return self._to_schedule_exception_record(upserted, fallback_client_id=client_id)

    def delete_schedule_exception(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        session_date: date,
    ) -> TrainerScheduleExceptionRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)
        deleted = self.repository.delete_schedule_exception_for_day(trainer_id, client_id, session_date)
        if not deleted:
            raise ValueError("Schedule exception not found")
        return self._to_schedule_exception_record(
            deleted,
            fallback_client_id=client_id,
            fallback_session_date=session_date,
        )

    def get_client_visible_schedule(
        self,
        trainer_context: TrainerContext,
    ) -> ClientTrainerScheduleResponse:
        client_id = trainer_context.client_id
        trainer_id = trainer_context.trainer_id
        if not client_id:
            raise ValueError("No client context found")
        if not trainer_id:
            return ClientTrainerScheduleResponse(client_id=client_id)

        client_row = self.repository.get_client_for_trainer(trainer_id, client_id)
        if not client_row:
            return ClientTrainerScheduleResponse(client_id=client_id)

        trainer_settings = self.repository.get_trainer_settings(trainer_id) if trainer_id else None
        schedule_preferences = self._build_schedule_preferences(
            trainer_id=trainer_id,
            client_id=client_id,
            trainer_settings=trainer_settings,
            include_upcoming_exceptions=True,
        )
        resolved_default_location = self._resolve_default_meeting_location(
            preferred_meeting_location=schedule_preferences.preferred_meeting_location,
            auto_use_trainer_default_location=schedule_preferences.auto_use_trainer_default_location,
            trainer_default_meeting_location=schedule_preferences.trainer_default_meeting_location,
            trainer_auto_fill_meeting_location=schedule_preferences.trainer_auto_fill_meeting_location,
        )
        trainer_display_name = self._normalize_display_name((trainer_settings or {}).get("display_name"))
        return ClientTrainerScheduleResponse(
            client_id=client_id,
            trainer_id=trainer_id,
            trainer_display_name=trainer_display_name,
            recurring_weekdays=schedule_preferences.recurring_weekdays,
            upcoming_exceptions=schedule_preferences.upcoming_exceptions,
            resolved_default_meeting_location=resolved_default_location,
        )

    def _require_trainer_context(self, trainer_context: TrainerContext) -> tuple[str, str]:
        trainer_id = str(trainer_context.trainer_id or "").strip()
        tenant_id = str(trainer_context.tenant_id or "").strip()
        if not trainer_id:
            raise ValueError("No trainer context found")
        if not tenant_id:
            raise ValueError("No tenant context found")
        return trainer_id, tenant_id

    def _require_client_assignment(self, trainer_context: TrainerContext, client_id: str) -> dict[str, Any]:
        trainer_id, tenant_id = self._require_trainer_context(trainer_context)
        client_row = self.repository.get_client_for_trainer(trainer_id, client_id)
        if not client_row:
            raise ValueError("Client not found for trainer")
        if not self._client_belongs_to_tenant(client_row, tenant_id):
            raise ValueError("Client not found for trainer")
        return client_row

    def _require_connection_request(self, trainer_id: str, request_id: str) -> dict[str, Any]:
        row = self.repository.get_connection_request_for_trainer(
            trainer_id=trainer_id,
            request_id=request_id,
        )
        if not row:
            raise ValueError("Connection request not found")
        return row

    def _connection_request_belongs_to_tenant(self, row: dict[str, Any], tenant_id: str) -> bool:
        client_id = str(row.get("client_id") or "").strip()
        if not client_id:
            return False
        client_row = self.repository.get_client_by_id(client_id)
        return bool(client_row and self._client_belongs_to_tenant(client_row, tenant_id))

    def _client_matches_search(
        self,
        client_row: dict[str, Any],
        normalized_search: str | None,
    ) -> bool:
        if not normalized_search:
            return True
        haystacks = [
            self._client_name(client_row).lower(),
            str(client_row.get("id") or "").strip().lower(),
            str(client_row.get("user_id") or "").strip().lower(),
        ]
        return any(normalized_search in haystack for haystack in haystacks if haystack)

    def _client_belongs_to_tenant(self, client_row: dict[str, Any], tenant_id: str) -> bool:
        row_tenant_id = str(client_row.get("tenant_id") or "").strip()
        return row_tenant_id == tenant_id

    def _get_or_create_profile(self, client_id: str) -> dict[str, Any]:
        profile = self.repository.get_profile(client_id)
        if profile:
            return profile
        return self.repository.create_empty_profile(client_id)

    def _build_activity_summary(
        self,
        *,
        trainer_id: str,
        client_row: dict[str, Any],
        target_date: date,
        trainer_settings: dict[str, Any] | None,
        schedule_preferences: TrainerSchedulePreferencesRecord | None,
    ) -> TrainerClientActivitySummary:
        client_id = str(client_row.get("id"))
        week_start = target_date - timedelta(days=6)
        checkins = self.repository.list_checkins_between(client_id, week_start, target_date)
        latest_checkin = self.repository.get_latest_checkin(client_id)

        score_values: list[float] = []
        mode_values: list[str] = []
        for checkin in checkins:
            score = checkin.get("total_score")
            if score is not None:
                try:
                    score_values.append(float(score))
                except (TypeError, ValueError):
                    pass
            mode = self._normalize_mode(checkin.get("assigned_mode"))
            if mode:
                mode_values.append(mode)

        avg_score = round(sum(score_values) / len(score_values), 2) if score_values else None
        avg_mode = Counter(mode_values).most_common(1)[0][0] if mode_values else None
        question_summaries = build_checkin_question_summaries(checkins, target_date)
        latest_date = self._coerce_date((latest_checkin or {}).get("date"), None)
        latest_mode = self._normalize_mode((latest_checkin or {}).get("assigned_mode"))
        days_since_last = (target_date - latest_date).days if latest_date else None

        workouts_completed_7d = 0
        user_id = client_row.get("user_id")
        if user_id:
            workouts = self.repository.list_completed_workouts_between(
                user_id,
                datetime.combine(week_start, time.min, tzinfo=timezone.utc),
                datetime.combine(target_date, time.max, tzinfo=timezone.utc),
            )
            workouts_completed_7d = len(workouts)

        today_schedule = self.repository.get_schedule_for_day(trainer_id, client_id, target_date)
        selected_date_exception_type = (
            schedule_preferences.selected_date_exception_type
            if schedule_preferences
            else None
        )
        selected_date_exception_location = (
            schedule_preferences.selected_date_meeting_location_override
            if schedule_preferences
            else None
        )
        recurring_weekdays = (
            schedule_preferences.recurring_weekdays
            if schedule_preferences
            else []
        )
        preferred_meeting_location = (
            schedule_preferences.preferred_meeting_location
            if schedule_preferences
            else None
        )
        auto_use_trainer_default_location = (
            schedule_preferences.auto_use_trainer_default_location
            if schedule_preferences
            else True
        )
        trainer_default_meeting_location = self._normalize_meeting_location((trainer_settings or {}).get("default_meeting_location"))
        trainer_auto_fill_meeting_location = bool((trainer_settings or {}).get("auto_fill_meeting_location", True))

        resolved_schedule = self._resolve_schedule_for_day(
            target_date=target_date,
            concrete_schedule=today_schedule,
            recurring_weekdays=recurring_weekdays,
            selected_date_exception_type=selected_date_exception_type,
            selected_date_exception_location=selected_date_exception_location,
            preferred_meeting_location=preferred_meeting_location,
            auto_use_trainer_default_location=auto_use_trainer_default_location,
            trainer_default_meeting_location=trainer_default_meeting_location,
            trainer_auto_fill_meeting_location=trainer_auto_fill_meeting_location,
        )
        return TrainerClientActivitySummary(
            checkins_completed_7d=len(checkins),
            workouts_completed_7d=workouts_completed_7d,
            avg_score_7d=avg_score,
            avg_mode_7d=avg_mode,
            latest_checkin_date=latest_date,
            latest_mode=latest_mode,
            days_since_last_checkin=days_since_last,
            question_summaries=question_summaries,
            scheduled_today=bool(resolved_schedule["scheduled"]),
            session_status=resolved_schedule["session_status"],
            session_type=resolved_schedule["session_type"],
            session_start_at=resolved_schedule["session_start_at"],
            session_end_at=resolved_schedule["session_end_at"],
            meeting_location=resolved_schedule["meeting_location"],
        )

    def _memory_counts(self, rows: list[dict[str, Any]]) -> TrainerMemoryCounts:
        counts = TrainerMemoryCounts(total=len(rows))
        for row in rows:
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            visibility = str(value.get("visibility") or "internal_only").strip().lower()
            is_archived = bool(value.get("is_archived"))
            if is_archived:
                counts.archived += 1
            if visibility == "ai_usable":
                counts.ai_usable += 1
            else:
                counts.internal_only += 1
        return counts

    def _build_schedule_preferences(
        self,
        *,
        trainer_id: str,
        client_id: str,
        trainer_settings: dict[str, Any] | None,
        selected_date: date | None = None,
        include_upcoming_exceptions: bool = True,
    ) -> TrainerSchedulePreferencesRecord:
        schedule_row = self.repository.get_schedule_preferences(trainer_id, client_id)
        recurring_weekdays = self._normalize_weekdays((schedule_row or {}).get("recurring_weekdays"))
        preferred_meeting_location = self._normalize_meeting_location((schedule_row or {}).get("preferred_meeting_location"))
        auto_use_default = bool((schedule_row or {}).get("auto_use_trainer_default_location", True))
        trainer_default_meeting_location = self._normalize_meeting_location((trainer_settings or {}).get("default_meeting_location"))
        trainer_auto_fill = bool((trainer_settings or {}).get("auto_fill_meeting_location", True))

        selected_exception = (
            self.repository.get_schedule_exception_for_day(trainer_id, client_id, selected_date)
            if selected_date
            else None
        )
        if include_upcoming_exceptions:
            start_date = selected_date or datetime.now(timezone.utc).date()
            end_date = start_date + timedelta(days=45)
            exception_rows = self.repository.list_schedule_exceptions_between(
                trainer_id,
                start_date=start_date,
                end_date=end_date,
                client_ids=[client_id],
            )
        else:
            exception_rows = []

        return TrainerSchedulePreferencesRecord(
            trainer_id=trainer_id,
            client_id=client_id,
            recurring_weekdays=recurring_weekdays,
            preferred_meeting_location=preferred_meeting_location,
            auto_use_trainer_default_location=auto_use_default,
            trainer_default_meeting_location=trainer_default_meeting_location,
            trainer_auto_fill_meeting_location=trainer_auto_fill,
            selected_date=selected_date,
            selected_date_exception_type=(
                self._normalize_exception_type((selected_exception or {}).get("exception_type"))
                if selected_exception
                else None
            ),
            selected_date_meeting_location_override=self._normalize_meeting_location((selected_exception or {}).get("meeting_location_override")),
            upcoming_exceptions=[
                self._to_schedule_exception_record(row, fallback_client_id=client_id)
                for row in exception_rows
            ],
        )

    def _resolve_schedule_for_day(
        self,
        *,
        target_date: date,
        concrete_schedule: dict[str, Any] | None,
        recurring_weekdays: list[int],
        selected_date_exception_type: str | None,
        selected_date_exception_location: str | None,
        preferred_meeting_location: str | None,
        auto_use_trainer_default_location: bool,
        trainer_default_meeting_location: str | None,
        trainer_auto_fill_meeting_location: bool,
    ) -> dict[str, Any]:
        if concrete_schedule:
            return {
                "scheduled": True,
                "session_status": (concrete_schedule or {}).get("status"),
                "session_type": (concrete_schedule or {}).get("session_type"),
                "session_start_at": self._coerce_datetime((concrete_schedule or {}).get("session_start_at")),
                "session_end_at": self._coerce_datetime((concrete_schedule or {}).get("session_end_at")),
                "meeting_location": self._normalize_meeting_location((concrete_schedule or {}).get("meeting_location")),
            }

        scheduled_from_recurring = target_date.isoweekday() in set(recurring_weekdays)
        normalized_exception_type = str(selected_date_exception_type or "").strip().lower()
        if normalized_exception_type == "skip":
            scheduled = False
        elif normalized_exception_type == "add":
            scheduled = True
        else:
            scheduled = scheduled_from_recurring

        resolved_meeting_location = None
        if scheduled:
            if self._normalize_meeting_location(selected_date_exception_location):
                resolved_meeting_location = self._normalize_meeting_location(selected_date_exception_location)
            elif preferred_meeting_location:
                resolved_meeting_location = preferred_meeting_location
            elif auto_use_trainer_default_location and trainer_auto_fill_meeting_location:
                resolved_meeting_location = trainer_default_meeting_location

        return {
            "scheduled": scheduled,
            "session_status": "scheduled" if scheduled else None,
            "session_type": None,
            "session_start_at": None,
            "session_end_at": None,
            "meeting_location": resolved_meeting_location,
        }

    def _resolve_default_meeting_location(
        self,
        *,
        preferred_meeting_location: str | None,
        auto_use_trainer_default_location: bool,
        trainer_default_meeting_location: str | None,
        trainer_auto_fill_meeting_location: bool,
    ) -> str | None:
        if preferred_meeting_location:
            return preferred_meeting_location
        if auto_use_trainer_default_location and trainer_auto_fill_meeting_location:
            return trainer_default_meeting_location
        return None

    def _to_schedule_exception_record(
        self,
        row: dict[str, Any],
        *,
        fallback_client_id: str,
        fallback_session_date: date | None = None,
    ) -> TrainerScheduleExceptionRecord:
        return TrainerScheduleExceptionRecord(
            id=str(row.get("id")) if row.get("id") else None,
            trainer_id=str(row.get("trainer_id")) if row.get("trainer_id") else None,
            client_id=str(row.get("client_id") or fallback_client_id),
            session_date=self._coerce_date(row.get("session_date"), fallback_session_date or datetime.now(timezone.utc).date()) or datetime.now(timezone.utc).date(),
            exception_type=self._normalize_exception_type(row.get("exception_type")),
            meeting_location_override=self._normalize_meeting_location(row.get("meeting_location_override")),
            created_at=self._coerce_datetime(row.get("created_at")),
            updated_at=self._coerce_datetime(row.get("updated_at")),
        )

    def _to_client_identity(
        self,
        row: dict[str, Any],
        *,
        is_pending_user: bool = False,
    ) -> TrainerClientIdentity:
        return TrainerClientIdentity(
            client_id=str(row.get("id") or ""),
            client_name=self._client_name(row),
            tenant_id=str(row.get("tenant_id")) if row.get("tenant_id") else None,
            user_id=str(row.get("user_id")) if row.get("user_id") else None,
            created_at=self._coerce_datetime(row.get("created_at")),
            is_assigned_to_trainer=bool(row.get("assigned_trainer_id")),
            is_pending_user=bool(is_pending_user),
        )

    def _to_connection_request_record(
        self,
        row: dict[str, Any],
        *,
        client_row: dict[str, Any] | None = None,
    ) -> TrainerClientConnectionRequestRecord:
        resolved_client = client_row
        if resolved_client is None:
            resolved_client = self.repository.get_client_by_id(str(row.get("client_id") or ""))
        metadata = row.get("metadata")
        return TrainerClientConnectionRequestRecord(
            id=str(row.get("id") or ""),
            client_id=str(row.get("client_id") or ""),
            client_name=self._client_name(resolved_client) if resolved_client else None,
            trainer_id=str(row.get("trainer_id") or ""),
            requested_by_user_id=str(row.get("requested_by_user_id") or ""),
            request_text=str(row.get("request_text") or ""),
            status=row.get("status") or "pending",  # type: ignore[arg-type]
            trainer_response_note=row.get("trainer_response_note"),
            metadata=metadata if isinstance(metadata, dict) else {},
            created_at=self._coerce_datetime(row.get("created_at")),
            updated_at=self._coerce_datetime(row.get("updated_at")),
            resolved_at=self._coerce_datetime(row.get("resolved_at")),
        )

    def _to_invite_code_metadata_record(self, row: dict[str, Any]) -> TrainerClientInviteCodeRecord:
        is_active = bool(row.get("is_active", False))
        used_at = self._coerce_datetime(row.get("used_at"))
        revoked_at = self._coerce_datetime(row.get("revoked_at"))
        expires_at = self._coerce_datetime(row.get("expires_at"))
        now = datetime.now(timezone.utc)
        if used_at:
            status = "used"
        elif revoked_at:
            status = "revoked"
        elif expires_at and expires_at <= now:
            status = "expired"
        elif is_active:
            status = "active"
        else:
            status = "revoked"
        return TrainerClientInviteCodeRecord(
            id=str(row.get("id") or ""),
            trainer_id=str(row.get("trainer_id") or ""),
            tenant_id=str(row.get("tenant_id") or ""),
            status=status,
            is_active=is_active,
            expires_at=expires_at,
            used_at=used_at,
            revoked_at=revoked_at,
            created_at=self._coerce_datetime(row.get("created_at")),
        )

    def _to_memory_record(self, row: dict[str, Any]) -> TrainerMemoryRecord:
        value_json = row.get("value_json")
        value = value_json if isinstance(value_json, dict) else {}
        visibility = str(value.get("visibility") or "internal_only").strip().lower()
        if visibility not in {"internal_only", "ai_usable"}:
            visibility = "internal_only"
        text = value.get("text")
        normalized_text = text.strip() if isinstance(text, str) and text.strip() else None
        return TrainerMemoryRecord(
            id=str(row.get("id")),
            trainer_id=str(row.get("trainer_id")),
            client_id=str(row.get("client_id")),
            memory_type=self._normalize_memory_type(row.get("memory_type")),
            memory_key=str(row.get("memory_key") or ""),
            visibility=visibility,  # type: ignore[arg-type]
            is_archived=bool(value.get("is_archived")),
            text=normalized_text,
            tags=self._normalize_tags(value.get("tags")),
            structured_data=self._normalize_structured_data(value.get("structured_data")),
            value_json=value,
            created_at=self._coerce_datetime(row.get("created_at")),
            updated_at=self._coerce_datetime(row.get("updated_at")),
        )

    def _build_context_preview_text(
        self,
        *,
        client_name: str,
        profile_snapshot: dict[str, Any],
        ai_usable: list[TrainerMemoryRecord],
        internal_only_count: int,
        summary_items: list[TrainerRuleSummaryItem],
    ) -> str:
        goal = str(profile_snapshot.get("primary_goal") or "unspecified").strip()
        motivation_baseline = resolve_motivation_baseline(
            profile_snapshot,
            fallback=goal if goal and goal != "unspecified" else "general fitness",
        )
        onboarding_status = str(profile_snapshot.get("onboarding_status") or "unknown").strip()
        top_rule_categories = ", ".join(item.category for item in summary_items[:3]) or "general_coaching"
        ai_memory_snippet = "; ".join(
            item.text.strip()
            for item in ai_usable
            if isinstance(item.text, str) and item.text.strip()
        )
        if len(ai_memory_snippet) > 240:
            ai_memory_snippet = f"{ai_memory_snippet[:240].rstrip()}..."
        if not ai_memory_snippet:
            ai_memory_snippet = "No AI-usable trainer memory has been captured yet."

        return (
            f"{client_name} context uses primary goal '{goal}' with onboarding status '{onboarding_status}'. "
            f"Motivation baseline: {motivation_baseline}. "
            f"Applied trainer rule categories: {top_rule_categories}. "
            f"AI-usable memory highlights: {ai_memory_snippet} "
            f"(internal-only memories excluded: {internal_only_count})."
        )

    def _normalize_memory_type(self, value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"note", "preference", "constraint"}:
            return text
        return "note"

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text:
                tags.append(text)
        return tags

    def _normalize_structured_data(self, value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    def _normalize_weekdays(self, value: Any) -> list[int]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("Recurring weekdays must be a list")

        normalized: list[int] = []
        for item in value:
            try:
                day = int(item)
            except (TypeError, ValueError) as exc:
                raise ValueError("Recurring weekdays must contain integers 1 through 7") from exc
            if day < 1 or day > 7:
                raise ValueError("Recurring weekdays must contain integers 1 through 7")
            if day not in normalized:
                normalized.append(day)
        normalized.sort()
        return normalized

    def _normalize_meeting_location(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _normalize_meeting_location_for_write(self, value: Any) -> str | None:
        normalized = self._normalize_meeting_location(value)
        if normalized is not None and len(normalized) > 160:
            raise ValueError("Meeting location must be 160 characters or fewer")
        return normalized

    def _normalize_exception_type(self, value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"skip", "add"}:
            return "skip"
        return normalized

    def _normalize_display_name(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    def _normalize_client_name_for_write(self, value: Any) -> str:
        normalized = self._normalize_display_name(value)
        if not normalized:
            raise ValueError("Client name cannot be empty")
        if len(normalized) > 160:
            raise ValueError("Client name must be 160 characters or fewer")
        return normalized

    def _normalize_search_term(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip().lower()
        return normalized or None

    def _is_pending_user(self, onboarding_status: str | None) -> bool:
        normalized_status = str(onboarding_status or "").strip().lower()
        return normalized_status != "completed"


    def _normalize_mode(self, mode: Any) -> str | None:
        if not mode:
            return None
        text = str(mode).strip().upper()
        return LEGACY_TO_CANONICAL_MODE.get(text, text)

    def _client_name(self, client_row: dict[str, Any]) -> str:
        name = client_row.get("client_name") if isinstance(client_row, dict) else None
        if isinstance(name, str) and name.strip():
            return name.strip()
        client_id = str(client_row.get("id") or "")
        if client_id:
            return f"Client {client_id[:6]}"
        return "Client"

    def _coerce_date(self, value: Any, fallback: date | None) -> date | None:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                return fallback
        return fallback

    def _coerce_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None
