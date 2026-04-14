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
    client_user_id: str | None = None
    persona_id: str | None = None
    persona_name: str | None = None
    trainer_onboarding_completed: bool = False
    trainer_onboarding_status: str = "not_started"
    trainer_onboarding_completed_steps: int = 0
    trainer_onboarding_total_steps: int = 8
    trainer_onboarding_last_step: str | None = None


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _resolve_onboarding_summary(
    supabase: Client,
    trainer_id: str | None,
    *,
    fallback_completed: bool,
) -> dict[str, Any]:
    default_status = "completed" if fallback_completed else "not_started"
    default_completed_steps = 8 if fallback_completed else 0
    if not trainer_id:
        return {
            "status": "not_started",
            "completed_steps": 0,
            "total_steps": 8,
            "last_completed_step": None,
            "completed": False,
        }

    try:
        response = (
            supabase
            .table("trainer_onboarding_profiles")
            .select("onboarding_status, onboarding_progress, last_completed_step, retrain_draft, retrain_started_at")
            .eq("trainer_id", trainer_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return {
            "status": default_status,
            "completed_steps": default_completed_steps,
            "total_steps": 8,
            "last_completed_step": None,
            "completed": bool(fallback_completed),
        }
    profile = response.data[0] if response.data else None
    progress = profile.get("onboarding_progress") if isinstance(profile, dict) else None
    progress_payload = progress if isinstance(progress, dict) else {}
    retrain_draft = profile.get("retrain_draft") if isinstance(profile, dict) else None
    retrain_payload = retrain_draft if isinstance(retrain_draft, dict) else {}

    draft_status = str(retrain_payload.get("onboarding_status") or "").strip().lower()
    if retrain_payload and draft_status in {"not_started", "in_progress", "calibration_pending", "completed"}:
        draft_progress_payload = retrain_payload.get("onboarding_progress")
        draft_progress = draft_progress_payload if isinstance(draft_progress_payload, dict) else {}
        draft_total_steps = max(1, _coerce_int(draft_progress.get("total_steps"), 8))
        draft_completed_steps = min(
            draft_total_steps,
            max(0, _coerce_int(draft_progress.get("completed_steps"), 0)),
        )
        draft_last_completed_step = (
            retrain_payload.get("last_completed_step")
            or draft_progress.get("last_completed_step")
        )
        return {
            "status": "in_progress" if draft_status == "completed" else draft_status,
            "completed_steps": draft_completed_steps,
            "total_steps": draft_total_steps,
            "last_completed_step": str(draft_last_completed_step).strip() if draft_last_completed_step else None,
            "completed": False,
        }

    status = str((profile or {}).get("onboarding_status") or default_status).strip().lower()
    if status not in {"not_started", "in_progress", "calibration_pending", "completed"}:
        status = default_status
    total_steps = max(1, _coerce_int(progress_payload.get("total_steps"), 8))
    completed_steps = _coerce_int(progress_payload.get("completed_steps"), default_completed_steps)
    completed = bool(fallback_completed or status == "completed")
    if completed:
        status = "completed"
        completed_steps = max(completed_steps, total_steps)
    completed_steps = min(max(0, completed_steps), total_steps)
    last_completed_step = (profile or {}).get("last_completed_step") or progress_payload.get("last_completed_step")

    return {
        "status": status,
        "completed_steps": completed_steps,
        "total_steps": total_steps,
        "last_completed_step": str(last_completed_step).strip() if last_completed_step else None,
        "completed": completed,
    }


def resolve_trainer_context(supabase: Client, user_id: str) -> TrainerContext:
    client_response = (
        supabase
        .table("clients")
        .select("id, tenant_id, user_id, assigned_trainer_id")
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

    if not trainer_record and not client_record:
        return TrainerContext(None, None, None, None, None)

    if trainer_record:
        persona_response = (
            supabase
            .table("trainer_personas")
            .select("id, persona_name, onboarding_preferences")
            .eq("trainer_id", trainer_record["id"])
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        persona_record = persona_response.data[0] if persona_response.data else None
        onboarding_preferences = persona_record.get("onboarding_preferences") if persona_record else None
        fallback_completed = bool(
            isinstance(onboarding_preferences, dict)
            and onboarding_preferences.get("trainer_onboarding_completed")
        )
        onboarding_summary = _resolve_onboarding_summary(
            supabase,
            trainer_record.get("id"),
            fallback_completed=fallback_completed,
        )
        return TrainerContext(
            tenant_id=trainer_record.get("tenant_id"),
            trainer_id=trainer_record.get("id"),
            trainer_user_id=trainer_record.get("user_id"),
            trainer_display_name=trainer_record.get("display_name"),
            client_id=None,
            client_user_id=None,
            persona_id=persona_record.get("id") if persona_record else None,
            persona_name=persona_record.get("persona_name") if persona_record else None,
            trainer_onboarding_completed=onboarding_summary["completed"],
            trainer_onboarding_status=onboarding_summary["status"],
            trainer_onboarding_completed_steps=onboarding_summary["completed_steps"],
            trainer_onboarding_total_steps=onboarding_summary["total_steps"],
            trainer_onboarding_last_step=onboarding_summary["last_completed_step"],
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
            .select("id, persona_name, onboarding_preferences")
            .eq("trainer_id", trainer_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        persona_record = persona_response.data[0] if persona_response.data else None
        onboarding_preferences = persona_record.get("onboarding_preferences") if persona_record else None
        fallback_completed = bool(
            isinstance(onboarding_preferences, dict)
            and onboarding_preferences.get("trainer_onboarding_completed")
        )
        onboarding_summary = _resolve_onboarding_summary(
            supabase,
            trainer_id,
            fallback_completed=fallback_completed,
        )
    else:
        onboarding_summary = {
            "status": "not_started",
            "completed_steps": 0,
            "total_steps": 8,
            "last_completed_step": None,
            "completed": False,
        }

    return TrainerContext(
        tenant_id=client_record.get("tenant_id"),
        trainer_id=trainer_id,
        trainer_user_id=trainer_record.get("user_id") if trainer_record else None,
        trainer_display_name=trainer_record.get("display_name") if trainer_record else None,
        client_id=client_record.get("id"),
        client_user_id=client_record.get("user_id"),
        persona_id=persona_record.get("id") if persona_record else None,
        persona_name=persona_record.get("persona_name") if persona_record else None,
        trainer_onboarding_completed=onboarding_summary["completed"],
        trainer_onboarding_status=onboarding_summary["status"],
        trainer_onboarding_completed_steps=onboarding_summary["completed_steps"],
        trainer_onboarding_total_steps=onboarding_summary["total_steps"],
        trainer_onboarding_last_step=onboarding_summary["last_completed_step"],
    )
