from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import settings


REQUIRED_SINK_CATEGORIES = (
    "vector_indexes",
    "embedding_stores",
    "retrieval_caches",
    "analytics_events",
    "logs",
    "file_storage",
    "notification_providers",
    "email_providers",
    "ai_memory_retrieval_systems",
)

ALLOWED_CLASSIFICATIONS = {"personal", "derived", "non_personal"}
ALLOWED_POLICY_ACTIONS = {
    "delete_rows",
    "sink_handler",
    "keep",
    "retention_ttl",
    "fk_cascade",
    "anonymize_rows",
}

ALLOWED_SINK_POLICIES = {"active_handler", "assert_disabled"}


class PersonalDataInventoryError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeletionPolicy:
    action: str
    subject: str | None
    column: str | None
    sink_category: str | None
    execution_order: int
    description: str


@dataclass(frozen=True)
class PersonalDataTable:
    schema: str
    table: str
    classification: str
    deletion_policy: DeletionPolicy

    @property
    def fq_name(self) -> str:
        return f"{self.schema}.{self.table}"


@dataclass(frozen=True)
class ExternalSinkPolicy:
    category: str
    handler_policy: str
    handler_name: str | None
    description: str


@dataclass(frozen=True)
class PersonalDataInventory:
    version: str
    required_sink_categories: tuple[str, ...]
    tables: tuple[PersonalDataTable, ...]
    external_sinks: dict[str, ExternalSinkPolicy]

    @property
    def table_names(self) -> set[str]:
        return {row.table for row in self.tables if row.schema == "public"}

    @property
    def table_names_fq(self) -> set[str]:
        return {row.fq_name for row in self.tables}

    @property
    def personal_or_derived_tables(self) -> tuple[PersonalDataTable, ...]:
        return tuple(row for row in self.tables if row.classification in {"personal", "derived"})

    def sorted_tables_for_execution(self) -> list[PersonalDataTable]:
        return sorted(self.tables, key=lambda row: row.deletion_policy.execution_order, reverse=True)


def _resolve_inventory_path(path_override: str | None = None) -> Path:
    configured = str(path_override or settings.personal_data_inventory_path).strip()
    if not configured:
        raise PersonalDataInventoryError("personal_data_inventory_path is not configured")

    path = Path(configured)
    if path.is_absolute():
        return path

    backend_root = Path(__file__).resolve().parents[2]
    return (backend_root / path).resolve()


def _as_text(value: Any, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise PersonalDataInventoryError(f"Inventory field {field_name} is required")
    return text


def _as_int(value: Any, *, field_name: str, default: int = 0) -> int:
    if value is None:
        return int(default)
    try:
        return int(value)
    except Exception as exc:  # pragma: no cover - defensive
        raise PersonalDataInventoryError(f"Inventory field {field_name} must be an integer") from exc


def _parse_table_row(raw: dict[str, Any]) -> PersonalDataTable:
    schema = _as_text(raw.get("schema"), field_name="schema").lower()
    table = _as_text(raw.get("table"), field_name="table").lower()
    classification = _as_text(raw.get("classification"), field_name=f"{schema}.{table}.classification").lower()
    if classification not in ALLOWED_CLASSIFICATIONS:
        raise PersonalDataInventoryError(
            f"Inventory table {schema}.{table} has unsupported classification {classification}"
        )

    policy_raw = raw.get("deletion_policy")
    if not isinstance(policy_raw, dict):
        raise PersonalDataInventoryError(f"Inventory table {schema}.{table} is missing deletion_policy")

    action = _as_text(policy_raw.get("action"), field_name=f"{schema}.{table}.deletion_policy.action").lower()
    if action not in ALLOWED_POLICY_ACTIONS:
        raise PersonalDataInventoryError(
            f"Inventory table {schema}.{table} has unsupported deletion policy action {action}"
        )

    subject = str(policy_raw.get("subject") or "").strip() or None
    column = str(policy_raw.get("column") or "").strip() or None
    sink_category = str(policy_raw.get("sink_category") or "").strip() or None

    if action == "delete_rows" and (not subject or not column):
        raise PersonalDataInventoryError(
            f"Inventory table {schema}.{table} requires subject and column for delete_rows action"
        )

    if action == "sink_handler" and not sink_category:
        raise PersonalDataInventoryError(
            f"Inventory table {schema}.{table} requires sink_category for sink_handler action"
        )

    description = str(policy_raw.get("description") or "").strip()
    execution_order = _as_int(
        policy_raw.get("execution_order"),
        field_name=f"{schema}.{table}.deletion_policy.execution_order",
        default=0,
    )

    return PersonalDataTable(
        schema=schema,
        table=table,
        classification=classification,
        deletion_policy=DeletionPolicy(
            action=action,
            subject=subject,
            column=column,
            sink_category=sink_category,
            execution_order=execution_order,
            description=description,
        ),
    )


def _parse_sink_policies(raw: dict[str, Any]) -> dict[str, ExternalSinkPolicy]:
    sinks: dict[str, ExternalSinkPolicy] = {}
    for category, row in raw.items():
        normalized_category = str(category or "").strip()
        if not normalized_category:
            raise PersonalDataInventoryError("Inventory external_sinks contains an empty category name")
        if not isinstance(row, dict):
            raise PersonalDataInventoryError(f"Inventory external_sinks.{normalized_category} must be an object")

        handler_policy = _as_text(
            row.get("handler_policy"),
            field_name=f"external_sinks.{normalized_category}.handler_policy",
        ).lower()
        if handler_policy not in ALLOWED_SINK_POLICIES:
            raise PersonalDataInventoryError(
                f"Inventory external_sinks.{normalized_category} has unsupported handler_policy {handler_policy}"
            )

        handler_name = str(row.get("handler_name") or "").strip() or None
        if handler_policy == "active_handler" and not handler_name:
            raise PersonalDataInventoryError(
                f"Inventory external_sinks.{normalized_category} requires handler_name for active_handler policy"
            )

        sinks[normalized_category] = ExternalSinkPolicy(
            category=normalized_category,
            handler_policy=handler_policy,
            handler_name=handler_name,
            description=str(row.get("description") or "").strip(),
        )
    return sinks


def _validate_inventory(inventory: PersonalDataInventory) -> list[str]:
    failures: list[str] = []

    required_category_set = set(REQUIRED_SINK_CATEGORIES)
    declared_category_set = set(inventory.required_sink_categories)

    missing_required_categories = sorted(required_category_set - declared_category_set)
    if missing_required_categories:
        failures.append(
            "required_sink_categories is missing categories: " + ", ".join(missing_required_categories)
        )

    for category in REQUIRED_SINK_CATEGORIES:
        if category not in inventory.external_sinks:
            failures.append(f"external_sinks is missing required category: {category}")

    table_names: set[str] = set()
    for table in inventory.tables:
        key = table.fq_name
        if key in table_names:
            failures.append(f"duplicate table entry in inventory: {key}")
        table_names.add(key)

        if table.classification in {"personal", "derived"} and table.deletion_policy.action == "keep":
            failures.append(
                f"table {key} is {table.classification} but deletion policy is keep; use explicit delete/sink/ttl policy"
            )

        if table.deletion_policy.action == "sink_handler":
            sink_category = table.deletion_policy.sink_category
            if not sink_category:
                failures.append(f"table {key} is sink_handler but sink_category is missing")
            elif sink_category not in inventory.external_sinks:
                failures.append(f"table {key} references missing sink category {sink_category}")

    for category, sink in inventory.external_sinks.items():
        if sink.handler_policy == "active_handler" and not sink.handler_name:
            failures.append(f"external_sinks.{category} is active_handler but handler_name is missing")

    return failures


def load_personal_data_inventory(
    *,
    path_override: str | None = None,
    strict: bool = True,
) -> PersonalDataInventory:
    inventory_path = _resolve_inventory_path(path_override)
    if not inventory_path.exists():
        raise PersonalDataInventoryError(f"Personal data inventory file was not found: {inventory_path}")

    try:
        payload = json.loads(inventory_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PersonalDataInventoryError(f"Personal data inventory JSON is invalid: {exc}") from exc

    if not isinstance(payload, dict):
        raise PersonalDataInventoryError("Personal data inventory root must be an object")

    required_sink_categories = payload.get("required_sink_categories") or []
    if not isinstance(required_sink_categories, list):
        raise PersonalDataInventoryError("required_sink_categories must be a list")

    table_rows = payload.get("tables")
    if not isinstance(table_rows, list):
        raise PersonalDataInventoryError("tables must be a list")

    sink_rows = payload.get("external_sinks")
    if not isinstance(sink_rows, dict):
        raise PersonalDataInventoryError("external_sinks must be an object")

    tables = tuple(_parse_table_row(raw) for raw in table_rows)
    sinks = _parse_sink_policies(sink_rows)

    inventory = PersonalDataInventory(
        version=str(payload.get("version") or "").strip() or "unknown",
        required_sink_categories=tuple(str(item).strip() for item in required_sink_categories if str(item).strip()),
        tables=tables,
        external_sinks=sinks,
    )

    failures = _validate_inventory(inventory)
    if failures and strict:
        raise PersonalDataInventoryError("Personal data inventory validation failed: " + " | ".join(failures))

    return inventory


def validate_personal_data_inventory(
    *,
    path_override: str | None = None,
) -> list[str]:
    try:
        inventory = load_personal_data_inventory(path_override=path_override, strict=False)
    except PersonalDataInventoryError as exc:
        return [str(exc)]
    return _validate_inventory(inventory)
