from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from app.core.auth import AuthenticatedUser
from app.core.config import settings
from app.modules.account_deletion.repository import AccountDeletionRepository


class AccountDeletionServiceError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = int(status_code)
        self.message = message


@dataclass
class AccountDeletionResult:
    deletion_request_id: str
    outcome: str
    actor_role: str
    deleted_record_counts: dict[str, int]


class AccountDeletionService:
    CONFIRMATION_TOKEN = "DELETE"
    _REQUIRED_TABLES = [
        "user_accounts",
        "user_roles",
        "onboarding_states",
        "clients",
        "trainers",
        "conversations",
        "conversation_messages",
        "coach_memory",
        "trainer_invite_codes",
    ]

    _USER_TABLES = [
        ("mobile_analytics_events", "user_id"),
        ("workout_plans", "user_id"),
        ("workouts", "user_id"),
        ("profiles", "id"),
    ]

    _CLIENT_TABLES = [
        ("generated_checkin_plans", "client_id"),
        ("daily_checkins", "client_id"),
        ("onboarding_answers", "client_id"),
        ("user_fitness_profiles", "client_id"),
        ("coach_memory", "client_id"),
        ("client_trainer_assignments", "client_id"),
        ("trainer_daily_schedule", "client_id"),
        ("trainer_client_schedule_preferences", "client_id"),
        ("trainer_client_schedule_exceptions", "client_id"),
        ("trainer_talking_points", "client_id"),
        ("ai_generated_outputs", "client_id"),
        ("ai_feedback_events", "client_id"),
        ("trainer_knowledge_entries", "client_id"),
        ("trainer_knowledge_usage_logs", "client_id"),
        ("trainer_assistant_router_events", "client_id"),
        ("trainer_system_events", "client_id"),
        ("trainer_mutation_operations", "client_id"),
        ("conversation_ai_requests", "client_id"),
        ("conversations", "client_id"),
    ]

    _TRAINER_TABLES = [
        ("trainer_invite_codes", "trainer_id"),
        ("trainer_personas", "trainer_id"),
        ("trainer_faq_examples", "trainer_id"),
        ("trainer_knowledge_documents", "trainer_id"),
        ("trainer_knowledge_entries", "trainer_id"),
        ("trainer_knowledge_versions", "trainer_id"),
        ("trainer_knowledge_usage_logs", "trainer_id"),
        ("trainer_program_templates", "trainer_id"),
        ("trainer_rules", "trainer_id"),
        ("trainer_rule_versions", "trainer_id"),
        ("trainer_response_approvals", "trainer_id"),
        ("trainer_talking_points", "trainer_id"),
        ("unanswered_question_queue", "trainer_id"),
        ("ai_generated_outputs", "trainer_id"),
        ("ai_feedback_events", "trainer_id"),
        ("trainer_daily_schedule", "trainer_id"),
        ("trainer_client_schedule_preferences", "trainer_id"),
        ("trainer_client_schedule_exceptions", "trainer_id"),
        ("trainer_assistant_router_events", "trainer_id"),
        ("trainer_system_events", "trainer_id"),
        ("trainer_mutation_operations", "trainer_id"),
        ("conversation_ai_requests", "trainer_id"),
        ("trainer_onboarding_profiles", "trainer_id"),
        ("trainer_onboarding_events", "trainer_id"),
        ("client_trainer_assignments", "trainer_id"),
        ("conversations", "trainer_id"),
    ]

    def __init__(self, repository: AccountDeletionRepository):
        self.repository = repository

    def delete_account(self, *, user: AuthenticatedUser, confirmation: str) -> AccountDeletionResult:
        if not settings.account_deletion_enabled:
            raise AccountDeletionServiceError("Account deletion is currently unavailable", status_code=503)

        if str(confirmation or "").strip().upper() != self.CONFIRMATION_TOKEN:
            raise AccountDeletionServiceError("Invalid deletion confirmation", status_code=422)

        deletion_request_id = str(uuid4())
        deleted_counts: dict[str, int] = {}

        try:
            self._assert_required_tables()

            trainers = self.repository.list_trainers_for_user(user_id=user.id)
            clients = self.repository.list_clients_for_user(user_id=user.id)
            actor_role = self._resolve_actor_role(trainers=trainers, clients=clients)

            trainer_ids = [str(row.get("id") or "").strip() for row in trainers if str(row.get("id") or "").strip()]
            client_ids = [str(row.get("id") or "").strip() for row in clients if str(row.get("id") or "").strip()]

            if trainer_ids:
                self_guided_tenant_id = self.repository.ensure_self_guided_tenant()
                rehomed_total = 0
                for trainer_id in trainer_ids:
                    rehomed_total += self.repository.rehome_clients_assigned_to_trainer(
                        trainer_id=trainer_id,
                        target_tenant_id=self_guided_tenant_id,
                    )
                deleted_counts["rehomed_clients"] = rehomed_total

            self._delete_storage_objects(
                user_id=user.id,
                trainer_ids=trainer_ids,
                client_ids=client_ids,
                deleted_counts=deleted_counts,
            )

            for table_name, column_name in self._USER_TABLES:
                deleted_counts[f"{table_name}:{column_name}"] = self._safe_delete_single(
                    table=table_name,
                    column=column_name,
                    value=user.id,
                )

            for table_name, column_name in self._CLIENT_TABLES:
                deleted_counts[f"{table_name}:{column_name}"] = self._safe_delete_many(
                    table=table_name,
                    column=column_name,
                    values=client_ids,
                )

            for table_name, column_name in self._TRAINER_TABLES:
                deleted_counts[f"{table_name}:{column_name}"] = self._safe_delete_many(
                    table=table_name,
                    column=column_name,
                    values=trainer_ids,
                )

            deleted_counts["clients:user_id"] = self.repository.delete_clients_for_user(user_id=user.id)
            deleted_counts["trainers:user_id"] = self.repository.delete_trainers_for_user(user_id=user.id)
            deleted_counts["user_accounts:auth_user_id"] = self.repository.delete_user_account_rows(user_id=user.id)

            self.repository.delete_auth_user(user_id=user.id)
            deleted_counts["auth.users"] = 1

            self.repository.write_deletion_audit(
                deletion_request_id=deletion_request_id,
                outcome="succeeded",
                actor_role=actor_role,
                deleted_record_counts=deleted_counts,
                metadata={"completed_at": datetime.now(timezone.utc).isoformat()},
            )
            return AccountDeletionResult(
                deletion_request_id=deletion_request_id,
                outcome="succeeded",
                actor_role=actor_role,
                deleted_record_counts=deleted_counts,
            )
        except AccountDeletionServiceError:
            raise
        except Exception as exc:
            actor_role = "unassigned"
            try:
                trainers = self.repository.list_trainers_for_user(user_id=user.id)
                clients = self.repository.list_clients_for_user(user_id=user.id)
                actor_role = self._resolve_actor_role(trainers=trainers, clients=clients)
            except Exception:
                actor_role = "unassigned"

            try:
                self.repository.write_deletion_audit(
                    deletion_request_id=deletion_request_id,
                    outcome="failed",
                    actor_role=actor_role,
                    deleted_record_counts=deleted_counts,
                    metadata={"error_type": exc.__class__.__name__},
                )
            except Exception:
                pass

            raise AccountDeletionServiceError("Unable to delete account", status_code=500) from exc

    def _assert_required_tables(self) -> None:
        missing = [
            table
            for table in self._REQUIRED_TABLES
            if not self.repository.table_is_accessible(table=table)
        ]
        if missing:
            raise AccountDeletionServiceError(
                f"Account deletion is blocked until required tables are present: {', '.join(missing)}",
                status_code=500,
            )

    def _safe_delete_single(self, *, table: str, column: str, value: str) -> int:
        if not self.repository.table_is_accessible(table=table):
            return 0
        return self.repository.delete_rows_by_column_value(table=table, column=column, value=value)

    def _safe_delete_many(self, *, table: str, column: str, values: list[str]) -> int:
        if not values:
            return 0
        if not self.repository.table_is_accessible(table=table):
            return 0
        return self.repository.delete_rows_by_column_values(table=table, column=column, values=values)

    def _delete_storage_objects(
        self,
        *,
        user_id: str,
        trainer_ids: list[str],
        client_ids: list[str],
        deleted_counts: dict[str, int],
    ) -> None:
        bucket = str(settings.storage_private_bucket or "").strip()
        if not bucket:
            return

        candidate_prefixes = {
            f"user/{user_id}",
            f"users/{user_id}",
            f"auth/{user_id}",
        }
        for trainer_id in trainer_ids:
            candidate_prefixes.add(f"trainer/{trainer_id}")
            candidate_prefixes.add(f"trainers/{trainer_id}")
        for client_id in client_ids:
            candidate_prefixes.add(f"client/{client_id}")
            candidate_prefixes.add(f"clients/{client_id}")

        all_paths: list[str] = []
        for prefix in sorted(candidate_prefixes):
            all_paths.extend(
                self.repository.list_storage_paths_for_prefix(bucket=bucket, prefix=prefix)
            )

        unique_paths = sorted({path for path in all_paths if path})
        deleted_counts["storage_objects"] = self.repository.delete_storage_paths(
            bucket=bucket,
            paths=unique_paths,
        )

    def _resolve_actor_role(self, *, trainers: list[dict], clients: list[dict]) -> str:
        has_trainers = bool(trainers)
        has_clients = bool(clients)
        if has_trainers and has_clients:
            return "mixed"
        if has_trainers:
            return "trainer"
        if has_clients:
            return "client"
        return "unassigned"
