from __future__ import annotations

import os
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from uuid import uuid4

from app.core.auth import AuthenticatedUser
from app.core.config import settings
from app.modules.account_deletion.repository import AccountDeletionRepository
from app.security.personal_data_inventory import (
    PersonalDataInventory,
    PersonalDataInventoryError,
    load_personal_data_inventory,
)

logger = logging.getLogger(__name__)


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


@dataclass(frozen=True)
class _DeletionExecutionContext:
    user_id: str
    user_account_id: str | None
    trainer_ids: tuple[str, ...]
    client_ids: tuple[str, ...]


class AccountDeletionService:
    CONFIRMATION_TOKEN = "DELETE"

    def __init__(self, repository: AccountDeletionRepository, atlas_trainer_deletion_observer=None):
        self.repository = repository
        self.atlas_trainer_deletion_observer = atlas_trainer_deletion_observer

    def delete_account(self, *, user: AuthenticatedUser, confirmation: str) -> AccountDeletionResult:
        if not settings.account_deletion_enabled:
            raise AccountDeletionServiceError("Account deletion is currently unavailable", status_code=503)

        if not settings.account_deletion_contract_enforced:
            raise AccountDeletionServiceError(
                "Account deletion contract enforcement is disabled; refusing to run in fail-closed mode",
                status_code=500,
            )

        if str(confirmation or "").strip().upper() != self.CONFIRMATION_TOKEN:
            raise AccountDeletionServiceError("Invalid deletion confirmation", status_code=422)

        deletion_request_id = str(uuid4())
        deleted_counts: dict[str, int] = {}

        try:
            inventory = self._load_inventory()
            self._assert_inventory_sink_contract(inventory)
            self._assert_live_schema_coverage(inventory)

            trainers = self.repository.list_trainers_for_user(user_id=user.id)
            clients = self.repository.list_clients_for_user(user_id=user.id)
            actor_role = self._resolve_actor_role(trainers=trainers, clients=clients)

            trainer_ids = tuple(
                str(row.get("id") or "").strip()
                for row in trainers
                if str(row.get("id") or "").strip()
            )
            client_ids = tuple(
                str(row.get("id") or "").strip()
                for row in clients
                if str(row.get("id") or "").strip()
            )

            user_account = self.repository.get_user_account(user_id=user.id)
            user_account_id = str((user_account or {}).get("id") or "").strip() or None

            if trainer_ids:
                self_guided_tenant_id = self.repository.ensure_self_guided_tenant()
                rehomed_total = 0
                for trainer_id in trainer_ids:
                    rehomed_total += self.repository.rehome_clients_assigned_to_trainer(
                        trainer_id=trainer_id,
                        target_tenant_id=self_guided_tenant_id,
                    )
                deleted_counts["rehomed_clients"] = rehomed_total

            context = _DeletionExecutionContext(
                user_id=user.id,
                user_account_id=user_account_id,
                trainer_ids=trainer_ids,
                client_ids=client_ids,
            )
            self._run_atlas_trainer_deletion_observer(
                trainer_ids=trainer_ids,
                deletion_request_id=deletion_request_id,
                deleted_counts=deleted_counts,
            )

            self._run_external_sink_cleanup(
                inventory=inventory,
                context=context,
                deleted_counts=deleted_counts,
            )
            self._execute_table_policies(
                inventory=inventory,
                context=context,
                deleted_counts=deleted_counts,
            )

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

    def _load_inventory(self) -> PersonalDataInventory:
        try:
            return load_personal_data_inventory(strict=True)
        except PersonalDataInventoryError as exc:
            raise AccountDeletionServiceError(
                f"Account deletion contract is invalid: {exc}",
                status_code=500,
            ) from exc

    def _run_atlas_trainer_deletion_observer(
        self,
        *,
        trainer_ids: tuple[str, ...],
        deletion_request_id: str,
        deleted_counts: dict[str, int],
    ) -> None:
        if not trainer_ids or not self.atlas_trainer_deletion_observer:
            return
        try:
            result = self.atlas_trainer_deletion_observer.observe_before_trainer_deletion(
                trainer_ids=list(trainer_ids),
                deletion_request_id=deletion_request_id,
            )
            for key, value in (result or {}).items():
                deleted_counts[f"atlas:{key}"] = int(value)
        except Exception:
            logger.exception("Atlas trainer deletion observer failed deletion_request_id=%s", deletion_request_id)

    def _assert_inventory_sink_contract(self, inventory: PersonalDataInventory) -> None:
        required = set(inventory.required_sink_categories)
        present = set(inventory.external_sinks.keys())
        missing = sorted(required - present)
        if missing:
            raise AccountDeletionServiceError(
                "Account deletion contract is missing required external sink policies: " + ", ".join(missing),
                status_code=500,
            )

    def _assert_live_schema_coverage(self, inventory: PersonalDataInventory) -> None:
        try:
            live_tables = set(self.repository.list_public_tables())
        except Exception as exc:
            raise AccountDeletionServiceError(
                "Account deletion is blocked: unable to enumerate live public tables. "
                "Apply the security_list_public_tables migration before enabling deletion.",
                status_code=500,
            ) from exc

        inventory_tables = inventory.table_names

        unknown_tables = sorted(live_tables - inventory_tables)
        if unknown_tables:
            raise AccountDeletionServiceError(
                "Account deletion is blocked until new public tables are classified in the personal-data inventory: "
                + ", ".join(unknown_tables),
                status_code=500,
            )

        missing_live_tables = sorted(inventory_tables - live_tables)
        if missing_live_tables:
            raise AccountDeletionServiceError(
                "Account deletion is blocked: inventory contains tables not present in live schema: "
                + ", ".join(missing_live_tables),
                status_code=500,
            )

    def _execute_table_policies(
        self,
        *,
        inventory: PersonalDataInventory,
        context: _DeletionExecutionContext,
        deleted_counts: dict[str, int],
    ) -> None:
        for table in inventory.sorted_tables_for_execution():
            policy = table.deletion_policy
            action = policy.action

            if action != "delete_rows":
                continue

            subject_values = self._subject_values_for_policy(context=context, subject=policy.subject)
            if not subject_values:
                deleted_counts[f"{table.table}:{policy.column or 'unknown'}"] = 0
                continue

            if not self.repository.table_is_accessible(table=table.table):
                raise AccountDeletionServiceError(
                    f"Account deletion is blocked: required personal-data table is not accessible ({table.table})",
                    status_code=500,
                )

            if policy.subject in {"user_id", "user_account_id"}:
                deleted_counts[f"{table.table}:{policy.column}"] = self.repository.delete_rows_by_column_value(
                    table=table.table,
                    column=str(policy.column),
                    value=subject_values[0],
                )
            else:
                deleted_counts[f"{table.table}:{policy.column}"] = self.repository.delete_rows_by_column_values(
                    table=table.table,
                    column=str(policy.column),
                    values=list(subject_values),
                )

    def _subject_values_for_policy(
        self,
        *,
        context: _DeletionExecutionContext,
        subject: str | None,
    ) -> list[str]:
        if subject == "user_id":
            return [context.user_id]
        if subject == "user_account_id":
            return [context.user_account_id] if context.user_account_id else []
        if subject == "trainer_ids":
            return list(context.trainer_ids)
        if subject == "client_ids":
            return list(context.client_ids)
        return []

    def _run_external_sink_cleanup(
        self,
        *,
        inventory: PersonalDataInventory,
        context: _DeletionExecutionContext,
        deleted_counts: dict[str, int],
    ) -> None:
        handlers: dict[str, Callable[[_DeletionExecutionContext], dict[str, int]]] = {
            "file_storage_cleanup": self._cleanup_file_storage_sink,
            "retrieval_caches_cleanup": self._cleanup_retrieval_cache_sink,
            "analytics_events_cleanup": self._cleanup_analytics_sink,
        }

        active_sinks = set(settings.account_deletion_active_sink_categories_list)
        disabled_sinks = set(settings.account_deletion_disabled_sink_categories_list)

        for category in inventory.required_sink_categories:
            sink = inventory.external_sinks.get(category)
            if sink is None:
                raise AccountDeletionServiceError(
                    f"Account deletion contract is missing sink category {category}",
                    status_code=500,
                )

            if sink.handler_policy == "active_handler":
                if category not in active_sinks:
                    raise AccountDeletionServiceError(
                        f"Account deletion sink category {category} is active in contract but not enabled in runtime config",
                        status_code=500,
                    )
                handler_name = str(sink.handler_name or "").strip()
                handler = handlers.get(handler_name)
                if handler is None:
                    raise AccountDeletionServiceError(
                        f"Account deletion sink handler is not implemented: {handler_name}",
                        status_code=500,
                    )
                sink_counts = handler(context)
                for key, value in sink_counts.items():
                    deleted_counts[f"sink:{category}:{key}"] = int(value)
                continue

            if sink.handler_policy == "assert_disabled":
                if category not in disabled_sinks:
                    raise AccountDeletionServiceError(
                        f"Account deletion sink category {category} must be explicitly marked disabled in runtime config",
                        status_code=500,
                    )
                env_key = f"MODE_EXTERNAL_SINK_{category.upper()}_ENABLED".replace("-", "_")
                if self._is_truthy(os.getenv(env_key)):
                    raise AccountDeletionServiceError(
                        f"Account deletion blocked: external sink {category} is enabled but contract policy requires disabled ({env_key})",
                        status_code=500,
                    )
                deleted_counts[f"sink:{category}:assert_disabled"] = 1
                continue

            raise AccountDeletionServiceError(
                f"Unsupported sink handler policy for {category}: {sink.handler_policy}",
                status_code=500,
            )

    def _cleanup_file_storage_sink(self, context: _DeletionExecutionContext) -> dict[str, int]:
        bucket = str(settings.storage_private_bucket or "").strip()
        if not bucket:
            raise AccountDeletionServiceError(
                "file_storage sink cleanup is active but storage_private_bucket is not configured",
                status_code=500,
            )

        candidate_prefixes = {
            f"user/{context.user_id}",
            f"users/{context.user_id}",
            f"auth/{context.user_id}",
        }
        for trainer_id in context.trainer_ids:
            candidate_prefixes.add(f"trainer/{trainer_id}")
            candidate_prefixes.add(f"trainers/{trainer_id}")
        for client_id in context.client_ids:
            candidate_prefixes.add(f"client/{client_id}")
            candidate_prefixes.add(f"clients/{client_id}")

        all_paths: list[str] = []
        for prefix in sorted(candidate_prefixes):
            all_paths.extend(
                self.repository.list_storage_paths_for_prefix(bucket=bucket, prefix=prefix)
            )

        all_paths.extend(
            self.repository.list_storage_ownership_paths_for_subjects(
                user_id=context.user_id,
                trainer_ids=list(context.trainer_ids),
                client_ids=list(context.client_ids),
            )
        )

        unique_paths = sorted({str(path).strip().strip("/") for path in all_paths if str(path).strip()})
        objects_deleted = self.repository.delete_storage_paths(bucket=bucket, paths=unique_paths)
        ownership_rows_deleted = self.repository.mark_storage_ownership_paths_deleted(paths=unique_paths)
        upload_grants_deleted = self.repository.delete_upload_grants_for_subjects(
            user_id=context.user_id,
            trainer_ids=list(context.trainer_ids),
            client_ids=list(context.client_ids),
        )
        return {
            "objects_deleted": objects_deleted,
            "ownership_rows_deleted": ownership_rows_deleted,
            "upload_grants_deleted": upload_grants_deleted,
        }

    def _cleanup_retrieval_cache_sink(self, context: _DeletionExecutionContext) -> dict[str, int]:
        if not self.repository.table_is_accessible(table="trainer_talking_points"):
            raise AccountDeletionServiceError(
                "retrieval_caches sink cleanup is active but trainer_talking_points table is unavailable",
                status_code=500,
            )

        deleted = 0
        if context.client_ids:
            deleted += self.repository.delete_rows_by_column_values(
                table="trainer_talking_points",
                column="client_id",
                values=list(context.client_ids),
            )
        if context.trainer_ids:
            deleted += self.repository.delete_rows_by_column_values(
                table="trainer_talking_points",
                column="trainer_id",
                values=list(context.trainer_ids),
            )
        return {"cache_rows_deleted": deleted}

    def _cleanup_analytics_sink(self, context: _DeletionExecutionContext) -> dict[str, int]:
        if not self.repository.table_is_accessible(table="mobile_analytics_events"):
            raise AccountDeletionServiceError(
                "analytics_events sink cleanup is active but mobile_analytics_events table is unavailable",
                status_code=500,
            )

        deleted = self.repository.delete_mobile_analytics_events(user_id=context.user_id)
        return {"events_deleted": deleted}

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

    @staticmethod
    def _is_truthy(value: str | None) -> bool:
        normalized = str(value or "").strip().lower()
        return normalized in {"1", "true", "yes", "on"}
