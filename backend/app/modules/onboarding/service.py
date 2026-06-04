from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
from typing import Any

from app.core.auth import AuthenticatedUser
from app.modules.onboarding.repository import OnboardingRepository, SELF_GUIDED_TENANT_SLUG
from app.modules.onboarding.schemas import (
    OnboardingBootstrapResponse,
    OnboardingCompleteRequest,
    OnboardingRoleRequest,
    OnboardingStatePatchRequest,
)


PROFILE_FIELD_MAP = {
    "goal": "primary_goal",
    "weekly_availability": "weekly_availability",
    "training_location": "training_location",
    "equipment": "equipment_access",
    "minimum_win": "minimum_win",
}
ONBOARDING_STATUS_VALUES = {"not_started", "in_progress", "completed"}
ROLE_VALUES = {"client", "trainer"}
INVITE_CODE_PATTERN = re.compile(r"^[A-Z0-9_-]{6,64}$")


@dataclass
class OnboardingServiceError(Exception):
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


class OnboardingService:
    CLIENT_FLOW_KEY = "client_v1"
    TRAINER_STUB_FLOW_KEY = "trainer_stub_v1"
    CLIENT_FIRST_STEP = "trainer_attach"
    TRAINER_STUB_STEP = "trainer_stub"

    def __init__(self, repository: OnboardingRepository):
        self.repository = repository

    def get_bootstrap(self, user: AuthenticatedUser) -> OnboardingBootstrapResponse:
        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = self.repository.get_user_role(user_account_id=account["id"])
        if role and role not in ROLE_VALUES:
            role = None

        clients = self.repository.list_clients_for_user(user_id=user.id)
        primary_client = self._select_primary_client(clients)
        legacy_trainer = self.repository.get_trainer_for_user(user_id=user.id)

        if not role:
            inferred_role = None
            if legacy_trainer:
                inferred_role = "trainer"
            elif primary_client:
                inferred_role = "client"
            if inferred_role:
                self.repository.set_user_role(user_account_id=account["id"], role=inferred_role)
                role = inferred_role

        # Auto-provision a trainers row for trainer-role users who don't have one yet.
        # is_legacy=False so they still route to the new AI onboarding path.
        if role == "trainer" and not legacy_trainer:
            legacy_trainer = self.repository.ensure_trainer_row(
                user_id=user.id,
                display_name=user.email,
            )

        if role == "client":
            primary_client, clients = self._ensure_client_bootstrap(user_id=user.id, clients=clients)

        onboarding_state = self.repository.get_onboarding_state(user_account_id=account["id"])
        if (
            role == "client"
            and onboarding_state
            and onboarding_state.get("flow_key") != self.CLIENT_FLOW_KEY
        ):
            onboarding_state = None
        if (
            role == "trainer"
            and onboarding_state
            and onboarding_state.get("flow_key") != self.TRAINER_STUB_FLOW_KEY
        ):
            onboarding_state = None
        onboarding_status = self._normalize_onboarding_status(onboarding_state)
        onboarding_payload = onboarding_state.get("payload") if isinstance(onboarding_state, dict) else {}
        if not isinstance(onboarding_payload, dict):
            onboarding_payload = {}

        onboarding_step = onboarding_state.get("current_step") if isinstance(onboarding_state, dict) else None
        if not onboarding_step and role == "client" and onboarding_status != "completed":
            onboarding_step = self.CLIENT_FIRST_STEP
        if not onboarding_step and role == "trainer" and onboarding_status != "completed":
            onboarding_step = self.TRAINER_STUB_STEP

        assigned_trainer_id = primary_client.get("assigned_trainer_id") if primary_client else None
        assigned_trainer_display_name = None
        if assigned_trainer_id:
            trainer = self.repository.get_trainer_by_id(trainer_id=assigned_trainer_id)
            assigned_trainer_display_name = trainer.get("display_name") if trainer else None

        client_id = primary_client.get("id") if primary_client else None
        profile = self.repository.get_client_profile_snapshot(client_id=client_id) if client_id else None
        if role == "client" and not onboarding_state and isinstance(profile, dict):
            profile_status = str(profile.get("onboarding_status") or "not_started").strip().lower()
            if profile_status in ONBOARDING_STATUS_VALUES:
                onboarding_status = profile_status
            if onboarding_status == "completed":
                onboarding_step = profile.get("onboarding_last_step") or "system_ready"
        tenant_slug = None
        if primary_client and primary_client.get("tenant_id"):
            tenant_slug = self.repository.get_tenant_slug(tenant_id=primary_client["tenant_id"])

        return OnboardingBootstrapResponse(
            role=role,
            onboarding_status=onboarding_status,
            onboarding_step=onboarding_step,
            onboarding_payload=onboarding_payload,
            onboarding_complete=onboarding_status == "completed",
            user_account_id=account["id"],
            client_id=client_id,
            has_client_profile=bool(profile),
            trainer_attached=bool(assigned_trainer_id),
            assigned_trainer_id=assigned_trainer_id,
            assigned_trainer_display_name=assigned_trainer_display_name,
            is_legacy_trainer=bool(legacy_trainer and legacy_trainer.get("is_legacy")),
            is_self_guided=tenant_slug == SELF_GUIDED_TENANT_SLUG,
        )

    def set_role(
        self,
        *,
        user: AuthenticatedUser,
        request: OnboardingRoleRequest,
    ) -> OnboardingBootstrapResponse:
        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = request.role.strip().lower()
        if role not in ROLE_VALUES:
            raise OnboardingServiceError("Role must be client or trainer", status_code=422)

        self.repository.set_user_role(user_account_id=account["id"], role=role)
        existing_state = self.repository.get_onboarding_state(user_account_id=account["id"])
        if role == "client":
            existing_payload = existing_state.get("payload") if isinstance(existing_state, dict) else {}
            if not isinstance(existing_payload, dict):
                existing_payload = {}
            if existing_state and existing_state.get("flow_key") != self.CLIENT_FLOW_KEY:
                existing_payload = {}
                existing_state = None
            self._ensure_client_bootstrap(user_id=user.id)
            self.repository.upsert_onboarding_state(
                user_account_id=account["id"],
                flow_key=self.CLIENT_FLOW_KEY,
                status=self._normalize_onboarding_status(existing_state),
                current_step=(
                    existing_state.get("current_step")
                    if existing_state and existing_state.get("current_step")
                    else self.CLIENT_FIRST_STEP
                ),
                payload=existing_payload,
                completed_at=existing_state.get("completed_at") if existing_state else None,
            )
        else:
            existing_payload = existing_state.get("payload") if isinstance(existing_state, dict) else {}
            if not isinstance(existing_payload, dict):
                existing_payload = {}
            if existing_state and existing_state.get("flow_key") != self.TRAINER_STUB_FLOW_KEY:
                existing_payload = {}
                existing_state = None
            self.repository.upsert_onboarding_state(
                user_account_id=account["id"],
                flow_key=self.TRAINER_STUB_FLOW_KEY,
                status=self._normalize_onboarding_status(existing_state),
                current_step=(
                    existing_state.get("current_step")
                    if existing_state and existing_state.get("current_step")
                    else self.TRAINER_STUB_STEP
                ),
                payload=existing_payload,
                completed_at=existing_state.get("completed_at") if existing_state else None,
            )
            self.repository.ensure_trainer_row(user_id=user.id, display_name=user.email)

        return self.get_bootstrap(user)

    def patch_state(
        self,
        *,
        user: AuthenticatedUser,
        request: OnboardingStatePatchRequest,
    ) -> OnboardingBootstrapResponse:
        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = self.repository.get_user_role(user_account_id=account["id"])
        if role not in ROLE_VALUES:
            raise OnboardingServiceError("Select a role before updating onboarding state", status_code=409)

        existing = self.repository.get_onboarding_state(user_account_id=account["id"])
        existing_payload = existing.get("payload") if isinstance(existing, dict) else {}
        if not isinstance(existing_payload, dict):
            existing_payload = {}

        merged_payload = {
            **existing_payload,
            **(request.payload or {}),
        }

        status = request.status or self._normalize_onboarding_status(existing)
        if status not in ONBOARDING_STATUS_VALUES:
            status = "in_progress"
        current_step = request.current_step if request.current_step is not None else (
            existing.get("current_step") if existing else None
        )

        self.repository.upsert_onboarding_state(
            user_account_id=account["id"],
            flow_key=self.CLIENT_FLOW_KEY if role == "client" else self.TRAINER_STUB_FLOW_KEY,
            status=status,
            current_step=current_step,
            payload=merged_payload,
            completed_at=existing.get("completed_at") if existing else None,
        )

        if role == "client":
            client_row, _all_clients = self._ensure_client_bootstrap(user_id=user.id)
            profile_fields = self._extract_profile_patch(merged_payload)
            if profile_fields:
                self.repository.upsert_client_profile_fields(client_id=client_row["id"], fields=profile_fields)
            if status != "completed":
                self.repository.upsert_client_profile_fields(
                    client_id=client_row["id"],
                    fields={"onboarding_status": "in_progress", "onboarding_last_step": current_step},
                )

        return self.get_bootstrap(user)

    def complete_onboarding(
        self,
        *,
        user: AuthenticatedUser,
        request: OnboardingCompleteRequest,
    ) -> OnboardingBootstrapResponse:
        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = self.repository.get_user_role(user_account_id=account["id"])
        if role not in ROLE_VALUES:
            raise OnboardingServiceError("Select a role before completing onboarding", status_code=409)

        existing = self.repository.get_onboarding_state(user_account_id=account["id"])
        existing_payload = existing.get("payload") if isinstance(existing, dict) else {}
        if not isinstance(existing_payload, dict):
            existing_payload = {}

        merged_payload = {
            **existing_payload,
            **(request.payload or {}),
        }
        current_step = request.current_step or (
            self.CLIENT_FIRST_STEP if role == "client" else self.TRAINER_STUB_STEP
        )

        if role == "client":
            client_row, _all_clients = self._ensure_client_bootstrap(user_id=user.id)
            profile_fields = {
                **self._extract_profile_patch(merged_payload),
                "onboarding_status": "completed",
                "onboarding_last_step": current_step,
            }
            self.repository.upsert_client_profile_fields(client_id=client_row["id"], fields=profile_fields)
            self.repository.mark_client_profile_onboarding_completed(
                client_id=client_row["id"],
                current_step=current_step,
            )
        else:
            trainer_name = self._coerce_optional_text(merged_payload.get("trainer_name"))
            contact_email = self._coerce_optional_text(merged_payload.get("contact_email"))
            notes = self._coerce_optional_text(merged_payload.get("notes"))
            if trainer_name or contact_email or notes:
                self.repository.upsert_trainer_profile_core(
                    user_account_id=account["id"],
                    trainer_name=trainer_name,
                    contact_email=contact_email,
                    notes=notes,
                )

        self.repository.upsert_onboarding_state(
            user_account_id=account["id"],
            flow_key=self.CLIENT_FLOW_KEY if role == "client" else self.TRAINER_STUB_FLOW_KEY,
            status="completed",
            current_step=current_step,
            payload=merged_payload,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

        return self.get_bootstrap(user)

    def assign_by_invite(
        self,
        *,
        user: AuthenticatedUser,
        invite_code: str,
    ) -> OnboardingBootstrapResponse:
        self._last_assignment_mutation_rows = []
        normalized_code = invite_code.strip().upper()
        if not normalized_code:
            raise OnboardingServiceError("Invite code is required", status_code=422)
        if not INVITE_CODE_PATTERN.match(normalized_code):
            raise OnboardingServiceError("Invite code is invalid", status_code=404)

        invite_hash = ""
        hash_resolver = getattr(self.repository, "hash_invite_code", None)
        if callable(hash_resolver):
            invite_hash = str(hash_resolver(normalized_code) or "").strip().lower()
        if not invite_hash:
            invite_hash = self._hash_invite_code(normalized_code)

        try:
            code_row = self.repository.get_invite_code(code_hash=invite_hash)
        except TypeError:
            code_row = self.repository.get_invite_code(code=normalized_code)
        if not code_row:
            raise OnboardingServiceError("Invite code is invalid", status_code=404)
        if not code_row.get("is_active"):
            raise OnboardingServiceError("Invite code is inactive", status_code=409)
        if code_row.get("revoked_at") or code_row.get("used_at"):
            raise OnboardingServiceError("Invite code is inactive", status_code=409)

        expires_at = code_row.get("expires_at")
        if expires_at:
            try:
                expires_at_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            except ValueError:
                expires_at_dt = None
            if expires_at_dt and expires_at_dt <= datetime.now(timezone.utc):
                raise OnboardingServiceError("Invite code has expired", status_code=409)

        trainer = self.repository.get_trainer_by_id(trainer_id=code_row["trainer_id"])
        if not trainer or not trainer.get("is_active"):
            raise OnboardingServiceError("Trainer is unavailable", status_code=409)

        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = self.repository.get_user_role(user_account_id=account["id"])
        if role and role not in ROLE_VALUES:
            role = None
        if role and role != "client":
            raise OnboardingServiceError("Trainer-role accounts cannot attach to a trainer", status_code=409)

        mutation_rows = self._normalize_mutation_rows(
            self.repository.reassign_client_by_invite(
                user_id=user.id,
                invite_id=str(code_row.get("id") or ""),
                trainer_id=str(code_row.get("trainer_id") or ""),
                tenant_id=str(code_row.get("tenant_id") or ""),
            )
        )
        self._last_assignment_mutation_rows = mutation_rows
        if not mutation_rows:
            raise OnboardingServiceError("Invite code is inactive", status_code=409)

        target_client_id = self._target_client_id_from_assignment_rows(mutation_rows)
        if not target_client_id:
            raise OnboardingServiceError("Unable to attach trainer with invite code", status_code=500)

        existing_state = self.repository.get_onboarding_state(user_account_id=account["id"])
        existing_payload = existing_state.get("payload") if isinstance(existing_state, dict) else {}
        if not isinstance(existing_payload, dict):
            existing_payload = {}
        self.repository.upsert_onboarding_state(
            user_account_id=account["id"],
            flow_key=self.CLIENT_FLOW_KEY,
            status=self._normalize_onboarding_status(existing_state),
            current_step=(existing_state or {}).get("current_step") or self.CLIENT_FIRST_STEP,
            payload={
                **existing_payload,
                "trainer_invite_attached": True,
                "assigned_trainer_id": trainer["id"],
                "assigned_trainer_display_name": trainer.get("display_name"),
                "assigned_client_id": target_client_id,
            },
            completed_at=(existing_state or {}).get("completed_at"),
        )

        return self.get_bootstrap(user)

    def self_detach_current_assignment(self, *, user: AuthenticatedUser) -> list[dict[str, Any]]:
        self._last_assignment_mutation_rows = []
        account = self.repository.ensure_user_account(user_id=user.id, email=user.email)
        role = self.repository.get_user_role(user_account_id=account["id"])
        if role and role not in ROLE_VALUES:
            role = None
        if role and role != "client":
            raise OnboardingServiceError("Trainer-role accounts cannot remove a trainer assignment", status_code=409)
        mutation_rows = self._normalize_mutation_rows(
            self.repository.self_detach_trainer_assignment(user_id=user.id)
        )
        self._last_assignment_mutation_rows = mutation_rows
        return mutation_rows

    def _hash_invite_code(self, code: str) -> str:
        normalized = code.strip().lower()
        if not normalized:
            return ""
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _normalize_mutation_rows(self, value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [dict(row) for row in value if isinstance(row, dict)]
        if isinstance(value, dict):
            return [dict(value)]
        return []

    def _target_client_id_from_assignment_rows(self, rows: list[dict[str, Any]]) -> str | None:
        for row in rows:
            event_type = str(row.get("event_type") or "").strip()
            if event_type != "assigned_by_invite":
                continue
            target_client_id = self._coerce_optional_text(row.get("target_client_id") or row.get("client_id"))
            if target_client_id:
                return target_client_id
        for row in rows:
            target_client_id = self._coerce_optional_text(row.get("target_client_id") or row.get("client_id"))
            if target_client_id:
                return target_client_id
        return None

    def _normalize_onboarding_status(self, state: dict[str, Any] | None) -> str:
        status = str((state or {}).get("status") or "not_started").strip().lower()
        if status not in ONBOARDING_STATUS_VALUES:
            return "not_started"
        return status

    def _select_primary_client(self, clients: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not clients:
            return None
        assigned = [row for row in clients if row.get("assigned_trainer_id")]
        if assigned:
            return self._sort_clients_desc(assigned)[0]
        return self._sort_clients_desc(clients)[0]

    def _sort_clients_desc(self, clients: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def sort_key(item: dict[str, Any]) -> tuple[int, str]:
            created_at = item.get("created_at")
            if not created_at:
                return (0, "")
            return (1, str(created_at))

        return sorted(clients, key=sort_key, reverse=True)

    def _ensure_client_bootstrap(
        self,
        *,
        user_id: str,
        clients: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        candidate_clients = list(clients) if clients is not None else self.repository.list_clients_for_user(user_id=user_id)
        primary_client = self._select_primary_client(candidate_clients)
        if not primary_client:
            tenant_id = self.repository.ensure_self_guided_tenant()
            existing = self.repository.get_client_for_user_and_tenant(user_id=user_id, tenant_id=tenant_id)
            primary_client = existing or self.repository.create_client(tenant_id=tenant_id, user_id=user_id)
            candidate_clients = self.repository.list_clients_for_user(user_id=user_id)
        self.repository.ensure_client_profile(client_id=primary_client["id"])
        return primary_client, candidate_clients

    def _find_self_guided_client(self, clients: list[dict[str, Any]]) -> dict[str, Any] | None:
        for row in clients:
            tenant_id = row.get("tenant_id")
            if not tenant_id:
                continue
            slug = self.repository.get_tenant_slug(tenant_id=tenant_id)
            if slug == SELF_GUIDED_TENANT_SLUG:
                return row
        return None

    def _extract_profile_patch(self, payload: dict[str, Any]) -> dict[str, Any]:
        setup_payload = payload.get("lightweight_setup")
        source = setup_payload if isinstance(setup_payload, dict) else payload

        patch: dict[str, Any] = {}
        for input_key, column in PROFILE_FIELD_MAP.items():
            if input_key not in source:
                continue
            value = source.get(input_key)
            if input_key == "weekly_availability":
                coerced = self._coerce_int(value)
                if coerced is not None:
                    patch[column] = coerced
                continue
            cleaned = self._coerce_optional_text(value)
            patch[column] = cleaned

        if "equipment_access" not in patch:
            location = patch.get("training_location") or self._coerce_optional_text(
                source.get("training_location")
            )
            if location:
                location_lower = location.lower()
                if "gym" in location_lower:
                    patch["equipment_access"] = "Full gym equipment"
                elif "home" in location_lower and any(
                    w in location_lower for w in ["full", "kit", "equipment"]
                ):
                    patch["equipment_access"] = "Home gym - full equipment"
                elif "home" in location_lower or "minimal" in location_lower:
                    patch["equipment_access"] = "Home - minimal equipment"
                elif "outdoor" in location_lower or "outside" in location_lower:
                    patch["equipment_access"] = "Outdoors"

        return patch

    def _coerce_int(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _coerce_optional_text(self, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or None
        coerced = str(value).strip()
        return coerced or None
