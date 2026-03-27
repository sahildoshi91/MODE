from dataclasses import dataclass
from typing import Any

from supabase import Client


@dataclass
class TrainerContext:
    tenant_id: str | None
    trainer_id: str | None
    trainer_user_id: str | None
    trainer_display_name: str | None
    client_id: str | None
    persona_id: str | None = None
    persona_name: str | None = None


def resolve_trainer_context(supabase: Client, user_id: str) -> TrainerContext:
    client_response = (
        supabase
        .table("clients")
        .select("id, tenant_id, assigned_trainer_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    client_record = client_response.data[0] if client_response.data else None

    trainer_response = (
        supabase
        .table("trainers")
        .select("id, tenant_id, user_id, display_name")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    trainer_record = trainer_response.data[0] if trainer_response.data else None

    if not client_record and not trainer_record:
        return TrainerContext(None, None, None, None, None)

    if not client_record and trainer_record:
        persona_response = (
            supabase
            .table("trainer_personas")
            .select("id, persona_name")
            .eq("trainer_id", trainer_record["id"])
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        persona_record = persona_response.data[0] if persona_response.data else None
        return TrainerContext(
            tenant_id=trainer_record.get("tenant_id"),
            trainer_id=trainer_record.get("id"),
            trainer_user_id=trainer_record.get("user_id"),
            trainer_display_name=trainer_record.get("display_name"),
            client_id=None,
            persona_id=persona_record.get("id") if persona_record else None,
            persona_name=persona_record.get("persona_name") if persona_record else None,
        )

    trainer_id = client_record.get("assigned_trainer_id")
    trainer_record = None
    persona_record: dict[str, Any] | None = None

    if trainer_id:
        trainer_response = (
            supabase
            .table("trainers")
            .select("id, user_id, display_name")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        )
        trainer_record = trainer_response.data[0] if trainer_response.data else None

        persona_response = (
            supabase
            .table("trainer_personas")
            .select("id, persona_name")
            .eq("trainer_id", trainer_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        persona_record = persona_response.data[0] if persona_response.data else None

    return TrainerContext(
        tenant_id=client_record.get("tenant_id"),
        trainer_id=trainer_id,
        trainer_user_id=trainer_record.get("user_id") if trainer_record else None,
        trainer_display_name=trainer_record.get("display_name") if trainer_record else None,
        client_id=client_record.get("id"),
        persona_id=persona_record.get("id") if persona_record else None,
        persona_name=persona_record.get("persona_name") if persona_record else None,
    )
