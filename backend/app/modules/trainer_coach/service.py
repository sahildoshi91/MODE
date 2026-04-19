from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.tenancy import TrainerContext
from app.modules.ai_feedback.schemas import AIOutputApproveRequest, AIOutputEditRequest, AIOutputRejectRequest
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.trainer_coach.repository import TrainerCoachRepository
from app.modules.trainer_coach.schemas import (
    CoachCreateEventRequest,
    CoachEventsResponse,
    CoachQueueApproveRequest,
    CoachQueueEditRequest,
    CoachQueueItem,
    CoachQueueMutationResponse,
    CoachQueueRejectRequest,
    CoachQueueResponse,
    CoachSummaryAction,
    CoachSummaryState,
    CoachSystemEventRecord,
    CoachSyncState,
    CoachWorkspaceResponse,
)
from app.modules.trainer_home.service import TrainerHomeService


logger = logging.getLogger(__name__)


class TrainerCoachService:
    def __init__(
        self,
        repository: TrainerCoachRepository,
        ai_feedback_service: AIFeedbackService,
        trainer_home_service: TrainerHomeService,
    ):
        self.repository = repository
        self.ai_feedback_service = ai_feedback_service
        self.trainer_home_service = trainer_home_service

    def build_workspace(
        self,
        trainer_context: TrainerContext,
        *,
        target_date: date | None = None,
    ) -> CoachWorkspaceResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        resolved_date = target_date or datetime.now(timezone.utc).date()
        queue_rows = self.repository.list_queue(trainer_id, limit=100)
        command_center = self._try_build_command_center(trainer_context, resolved_date)
        client_name_by_id = {
            item.client_id: item.client_name
            for item in command_center.clients
            if item.client_id
        } if command_center else {}
        if not client_name_by_id:
            client_name_by_id = self.repository.list_client_names(
                trainer_id,
                [str(row.get("client_id")) for row in queue_rows if row.get("client_id")],
            )
        queue_items = [
            self._to_queue_item(row, client_name_by_id=client_name_by_id)
            for row in queue_rows
        ]
        event_rows = self.repository.list_system_events(trainer_id, limit=80)
        pending_ops, failed_ops = self.repository.count_sync_operations(trainer_id)
        critical_clients = (
            int(command_center.totals.critical_priority_clients)
            if command_center else 0
        )
        high_priority_clients = (
            int(command_center.totals.high_priority_clients)
            if command_center else 0
        )
        summary = self._build_summary_state(
            trainer_context=trainer_context,
            queue_count=len(queue_items),
            critical_clients=critical_clients,
            high_priority_clients=high_priority_clients,
            pending_ops=pending_ops,
            failed_ops=failed_ops,
        )
        return CoachWorkspaceResponse(
            generated_at=datetime.now(timezone.utc),
            summary=summary,
            queue=queue_items,
            events=[self._to_system_event(row) for row in event_rows],
            sync=CoachSyncState(
                pending_operation_count=pending_ops,
                failed_operation_count=failed_ops,
            ),
        )

    def list_queue(
        self,
        trainer_context: TrainerContext,
        *,
        target_date: date | None = None,
        limit: int = 100,
    ) -> CoachQueueResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        resolved_date = target_date or datetime.now(timezone.utc).date()
        rows = self.repository.list_queue(trainer_id, limit=limit)
        command_center = self._try_build_command_center(trainer_context, resolved_date)
        client_name_by_id = {
            item.client_id: item.client_name
            for item in command_center.clients
            if item.client_id
        } if command_center else {}
        if not client_name_by_id:
            client_name_by_id = self.repository.list_client_names(
                trainer_id,
                [str(row.get("client_id")) for row in rows if row.get("client_id")],
            )
        items = [self._to_queue_item(row, client_name_by_id=client_name_by_id) for row in rows]
        return CoachQueueResponse(
            generated_at=datetime.now(timezone.utc),
            count=len(items),
            items=items,
        )

    def list_events(
        self,
        trainer_context: TrainerContext,
        *,
        limit: int = 80,
    ) -> CoachEventsResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        rows = self.repository.list_system_events(trainer_id, limit=limit)
        items = [self._to_system_event(row) for row in rows]
        return CoachEventsResponse(
            generated_at=datetime.now(timezone.utc),
            count=len(items),
            items=items,
        )

    def create_event(
        self,
        trainer_context: TrainerContext,
        request: CoachCreateEventRequest,
    ) -> CoachSystemEventRecord:
        trainer_id = self._require_trainer_id(trainer_context)
        tenant_id = str(trainer_context.tenant_id or "").strip()
        if not tenant_id:
            raise ValueError("No tenant context found")

        event_key = request.event_key.strip()
        existing = self.repository.get_system_event_by_key(trainer_id, event_key)
        if existing:
            return self._to_system_event(existing)

        if request.client_id and not self.repository.client_exists_for_trainer(trainer_id, request.client_id):
            raise ValueError("Client not found for trainer")
        if request.output_id and not self.repository.output_exists_for_trainer(trainer_id, request.output_id):
            raise ValueError("Output not found")

        now_iso = datetime.now(timezone.utc).isoformat()
        inserted = self.repository.insert_system_event(
            {
                "tenant_id": tenant_id,
                "trainer_id": trainer_id,
                "client_id": request.client_id,
                "output_id": request.output_id,
                "event_key": event_key,
                "event_type": request.event_type.strip(),
                "message": request.message.strip(),
                "severity": request.severity,
                "visibility": request.visibility,
                "status": request.status,
                "payload": request.payload or {},
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        if inserted:
            return self._to_system_event(inserted)

        # Insert may no-op under concurrent create; fallback to lookup for idempotency.
        fallback = self.repository.get_system_event_by_key(trainer_id, event_key)
        if fallback:
            return self._to_system_event(fallback)
        raise ValueError("Unable to persist system event")

    def approve_queue_item(
        self,
        trainer_context: TrainerContext,
        output_id: str,
        request: CoachQueueApproveRequest,
    ) -> CoachQueueMutationResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        transaction_payload = self.repository.approve_output_transaction(
            output_id=output_id,
            idempotency_key=request.idempotency_key,
            edited_output_text=request.edited_output_text,
            edited_output_json=request.edited_output_json,
            apply_bundle=request.apply_bundle,
        )
        detail = self.ai_feedback_service.get_output_detail(trainer_id, output_id)
        output = detail.output
        feedback_event = next(
            (event for event in detail.feedback_events if event.event_type == "approved"),
            detail.feedback_events[0] if detail.feedback_events else None,
        )

        event_rows = transaction_payload.get("events")
        events = [
            self._to_system_event(row)
            for row in (event_rows if isinstance(event_rows, list) else [])
            if isinstance(row, dict)
        ]
        return CoachQueueMutationResponse(
            output=output,
            feedback_event=feedback_event,
            events=events,
            memory_applied_count=int(transaction_payload.get("memory_applied_count") or 0),
            delivery=transaction_payload.get("delivery") if isinstance(transaction_payload.get("delivery"), dict) else {},
            program_template=(
                transaction_payload.get("program_template")
                if isinstance(transaction_payload.get("program_template"), dict)
                else {}
            ),
            queue_count=self.repository.count_open_queue(trainer_id),
        )

    def edit_queue_item(
        self,
        trainer_context: TrainerContext,
        output_id: str,
        request: CoachQueueEditRequest,
    ) -> CoachQueueMutationResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        mutation = self.ai_feedback_service.edit_output(
            trainer_id,
            output_id,
            AIOutputEditRequest(
                edited_output_text=request.edited_output_text,
                edited_output_json=request.edited_output_json,
                notes=request.notes,
                auto_apply_deltas=False,
            ),
        )
        event = self._emit_system_event(
            output=mutation.output,
            event_type="draft_edited",
            message="Draft edits saved",
            severity="success",
            visibility="system",
            payload={
                "output_id": mutation.output.id,
                "feedback_event_id": mutation.feedback_event.id,
            },
        )
        return CoachQueueMutationResponse(
            output=mutation.output,
            feedback_event=mutation.feedback_event,
            events=[event],
            memory_applied_count=0,
            delivery={},
            program_template={},
            queue_count=self.repository.count_open_queue(trainer_id),
        )

    def reject_queue_item(
        self,
        trainer_context: TrainerContext,
        output_id: str,
        request: CoachQueueRejectRequest,
    ) -> CoachQueueMutationResponse:
        trainer_id = self._require_trainer_id(trainer_context)
        mutation = self.ai_feedback_service.reject_output(
            trainer_id,
            output_id,
            AIOutputRejectRequest(
                reason=request.reason,
                edited_output_text=request.edited_output_text,
                edited_output_json=request.edited_output_json,
            ),
        )
        event = self._emit_system_event(
            output=mutation.output,
            event_type="draft_rejected",
            message="Draft rejected",
            severity="warning",
            visibility="system",
            payload={
                "output_id": mutation.output.id,
                "feedback_event_id": mutation.feedback_event.id,
                "reason": request.reason,
            },
        )
        return CoachQueueMutationResponse(
            output=mutation.output,
            feedback_event=mutation.feedback_event,
            events=[event],
            memory_applied_count=0,
            delivery={},
            program_template={},
            queue_count=self.repository.count_open_queue(trainer_id),
        )

    def _require_trainer_id(self, trainer_context: TrainerContext) -> str:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            raise ValueError("No trainer context found")
        return trainer_id

    def _build_summary_state(
        self,
        *,
        trainer_context: TrainerContext,
        queue_count: int,
        critical_clients: int,
        high_priority_clients: int,
        pending_ops: int,
        failed_ops: int,
    ) -> CoachSummaryState:
        if pending_ops > 0 or failed_ops > 0:
            return CoachSummaryState(
                state="sync_pending",
                title=f"{pending_ops + failed_ops} sync actions pending",
                subtitle="Some local operations still need cloud confirmation.",
                actions=[
                    CoachSummaryAction(id="retry_sync", label="Retry sync", target="sync"),
                    CoachSummaryAction(id="view_pending_ops", label="View pending ops", target="sync"),
                ],
                counts={
                    "pending_ops": pending_ops,
                    "failed_ops": failed_ops,
                },
            )

        if not trainer_context.trainer_onboarding_completed:
            return CoachSummaryState(
                state="calibration_incomplete",
                title="Calibration incomplete",
                subtitle="Finish coach setup so drafts and rules stay in your voice.",
                actions=[
                    CoachSummaryAction(
                        id="resume_calibration",
                        label="Resume calibration",
                        target="coach_training",
                        payload={"onboarding_action": "resume"},
                    ),
                    CoachSummaryAction(
                        id="open_rules",
                        label="Open rules",
                        target="panel_rules",
                    ),
                ],
                counts={},
            )

        if queue_count > 0:
            return CoachSummaryState(
                state="drafts_pending",
                title=f"{queue_count} drafts pending review",
                subtitle="Resolve pending drafts to keep client delivery on track.",
                actions=[
                    CoachSummaryAction(id="open_queue", label="Open queue", target="queue"),
                    CoachSummaryAction(id="review_priority", label="Review highest priority", target="queue"),
                ],
                counts={"drafts_pending": queue_count},
            )

        clients_need_attention = max(critical_clients, high_priority_clients)
        if clients_need_attention > 0:
            return CoachSummaryState(
                state="clients_need_attention",
                title=f"{clients_need_attention} clients need attention",
                subtitle="High-risk clients should get a proactive touchpoint today.",
                actions=[
                    CoachSummaryAction(
                        id="open_clients_filtered",
                        label="Open Clients filtered",
                        target="clients",
                        payload={"filter": "high_priority"},
                    ),
                    CoachSummaryAction(
                        id="generate_outreach_drafts",
                        label="Generate outreach drafts",
                        target="command",
                        payload={"command": "/drafts"},
                    ),
                ],
                counts={
                    "critical_clients": critical_clients,
                    "high_priority_clients": high_priority_clients,
                },
            )

        return CoachSummaryState(
            state="all_on_track",
            title="All clients are on track",
            subtitle="No blockers are open. You can run a proactive sweep.",
            actions=[
                CoachSummaryAction(id="run_scan", label="Run proactive scan", target="command", payload={"command": "/drafts"}),
                CoachSummaryAction(id="create_followup", label="Create follow-up draft", target="command", payload={"command": "/program"}),
            ],
            counts={},
        )

    def _to_queue_item(
        self,
        row: dict[str, Any],
        *,
        client_name_by_id: dict[str, str],
    ) -> CoachQueueItem:
        output_json = row.get("reviewed_output_json")
        if not isinstance(output_json, dict):
            output_json = row.get("output_json") if isinstance(row.get("output_json"), dict) else {}
        summary = output_json.get("summary") if isinstance(output_json.get("summary"), str) else None
        if not summary:
            summary = row.get("reviewed_output_text") or row.get("output_text")
        action_type = output_json.get("action_type") if isinstance(output_json.get("action_type"), str) else None
        headline = output_json.get("headline") if isinstance(output_json.get("headline"), str) else None
        client_id = row.get("client_id")
        return CoachQueueItem(
            output_id=str(row.get("id")),
            trainer_id=str(row.get("trainer_id")),
            client_id=str(client_id) if client_id else None,
            client_name=client_name_by_id.get(str(client_id)) if client_id else None,
            source_type=str(row.get("source_type") or "unknown"),
            review_status=str(row.get("review_status") or "open"),
            queue_state=str(row.get("queue_state") or "pending"),
            priority_tier=str(row.get("priority_tier") or "normal"),
            queue_priority=int(row.get("queue_priority") or 0),
            delivery_state=str(row.get("delivery_state") or "draft"),
            action_type=action_type,
            headline=headline,
            summary=summary,
            output_text=row.get("output_text"),
            output_json=row.get("output_json") if isinstance(row.get("output_json"), dict) else {},
            reviewed_output_text=row.get("reviewed_output_text"),
            reviewed_output_json=row.get("reviewed_output_json") if isinstance(row.get("reviewed_output_json"), dict) else None,
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def _to_system_event(self, row: dict[str, Any]) -> CoachSystemEventRecord:
        return CoachSystemEventRecord(
            id=str(row.get("id")),
            event_type=str(row.get("event_type") or "system_event"),
            message=str(row.get("message") or "System event"),
            severity=str(row.get("severity") or "info"),  # type: ignore[arg-type]
            visibility=str(row.get("visibility") or "system"),  # type: ignore[arg-type]
            status=str(row.get("status") or "confirmed"),  # type: ignore[arg-type]
            output_id=str(row.get("output_id")) if row.get("output_id") else None,
            client_id=str(row.get("client_id")) if row.get("client_id") else None,
            payload=row.get("payload") if isinstance(row.get("payload"), dict) else {},
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def _emit_system_event(
        self,
        *,
        output: Any,
        event_type: str,
        message: str,
        severity: str,
        visibility: str,
        payload: dict[str, Any],
    ) -> CoachSystemEventRecord:
        now_iso = datetime.now(timezone.utc).isoformat()
        row = self.repository.insert_system_event(
            {
                "tenant_id": output.tenant_id,
                "trainer_id": output.trainer_id,
                "client_id": output.client_id,
                "output_id": output.id,
                "event_key": f"{event_type}:{output.id}:{uuid4()}",
                "event_type": event_type,
                "message": message,
                "severity": severity,
                "visibility": visibility,
                "status": "confirmed",
                "payload": payload,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        return self._to_system_event(row or {})

    def _try_build_command_center(
        self,
        trainer_context: TrainerContext,
        target_date: date,
    ) -> Any | None:
        try:
            return self.trainer_home_service.build_command_center(trainer_context, target_date)
        except Exception:
            logger.exception(
                "Trainer coach command-center enrichment unavailable trainer_id=%s date=%s",
                trainer_context.trainer_id,
                target_date,
            )
            return None
