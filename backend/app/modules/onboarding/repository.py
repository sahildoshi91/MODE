from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client


SELF_GUIDED_TENANT_SLUG = "mode-self-guided"
SELF_GUIDED_TENANT_NAME = "MODE Self Guided"
PROFILE_COPY_FIELDS = [
    "primary_goal",
    "is_training_for_event",
    "event_type",
    "event_name",
    "event_date",
    "injuries_present",
    "injury_notes",
    "equipment_access",
    "workout_frequency_target",
    "experience_level",
    "preferred_session_length",
    "current_mode",
    "onboarding_status",
    "training_location",
    "minimum_win",
    "weekly_availability",
    "onboarding_completed_at",
    "onboarding_last_step",
]


class OnboardingRepository:
    def __init__(self, supabase_admin: Client):
        self.supabase_admin = supabase_admin

    def ensure_user_account(self, *, user_id: str, email: str | None) -> dict[str, Any]:
        existing = (
            self.supabase_admin
            .table("user_accounts")
            .select("id, auth_user_id, email")
            .eq("auth_user_id", user_id)
            .limit(1)
            .execute()
        ).data or []
        if existing:
            account = existing[0]
            if email and account.get("email") != email:
                updated = (
                    self.supabase_admin
                    .table("user_accounts")
                    .update({
                        "email": email,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    .eq("id", account["id"])
                    .execute()
                ).data or []
                if updated:
                    return updated[0]
            return account

        inserted = (
            self.supabase_admin
            .table("user_accounts")
            .insert({
                "auth_user_id": user_id,
                "email": email,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to create user account")
        return inserted[0]

    def get_user_role(self, *, user_account_id: str) -> str | None:
        rows = (
            self.supabase_admin
            .table("user_roles")
            .select("role, is_active, selected_at")
            .eq("user_account_id", user_account_id)
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            return None
        role = rows[0].get("role")
        return str(role).strip().lower() if isinstance(role, str) and role.strip() else None

    def set_user_role(self, *, user_account_id: str, role: str) -> dict[str, Any]:
        existing = (
            self.supabase_admin
            .table("user_roles")
            .select("id")
            .eq("user_account_id", user_account_id)
            .limit(1)
            .execute()
        ).data or []
        now = datetime.now(timezone.utc).isoformat()
        if existing:
            updated = (
                self.supabase_admin
                .table("user_roles")
                .update({
                    "role": role,
                    "is_active": True,
                    "selected_at": now,
                    "updated_at": now,
                })
                .eq("id", existing[0]["id"])
                .execute()
            ).data or []
            if updated:
                return updated[0]

        inserted = (
            self.supabase_admin
            .table("user_roles")
            .insert({
                "user_account_id": user_account_id,
                "role": role,
                "is_active": True,
                "selected_at": now,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to persist user role")
        return inserted[0]

    def get_onboarding_state(self, *, user_account_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("onboarding_states")
            .select("id, flow_key, status, current_step, payload, completed_at")
            .eq("user_account_id", user_account_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def upsert_onboarding_state(
        self,
        *,
        user_account_id: str,
        flow_key: str,
        status: str,
        current_step: str | None,
        payload: dict[str, Any],
        completed_at: str | None,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        existing = self.get_onboarding_state(user_account_id=user_account_id)
        fields = {
            "flow_key": flow_key,
            "status": status,
            "current_step": current_step,
            "payload": payload,
            "completed_at": completed_at,
            "updated_at": now,
        }
        if existing:
            updated = (
                self.supabase_admin
                .table("onboarding_states")
                .update(fields)
                .eq("id", existing["id"])
                .execute()
            ).data or []
            if updated:
                return updated[0]

        inserted = (
            self.supabase_admin
            .table("onboarding_states")
            .insert({
                "user_account_id": user_account_id,
                **fields,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to persist onboarding state")
        return inserted[0]

    def upsert_trainer_profile_core(
        self,
        *,
        user_account_id: str,
        trainer_name: str | None,
        contact_email: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        existing = (
            self.supabase_admin
            .table("trainer_profile_core")
            .select("id")
            .eq("user_account_id", user_account_id)
            .limit(1)
            .execute()
        ).data or []
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "trainer_name": trainer_name,
            "contact_email": contact_email,
            "notes": notes,
            "updated_at": now,
        }
        if existing:
            updated = (
                self.supabase_admin
                .table("trainer_profile_core")
                .update(payload)
                .eq("id", existing[0]["id"])
                .execute()
            ).data or []
            if updated:
                return updated[0]

        inserted = (
            self.supabase_admin
            .table("trainer_profile_core")
            .insert({
                "user_account_id": user_account_id,
                **payload,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to persist trainer profile core")
        return inserted[0]

    def list_clients_for_user(self, *, user_id: str) -> list[dict[str, Any]]:
        return (
            self.supabase_admin
            .table("clients")
            .select("id, tenant_id, user_id, assigned_trainer_id, created_at")
            .eq("user_id", user_id)
            .execute()
        ).data or []

    def get_client_profile(self, *, client_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("user_fitness_profiles")
            .select("id, onboarding_status")
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def get_client_profile_snapshot(self, *, client_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("user_fitness_profiles")
            .select("*")
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def ensure_self_guided_tenant(self) -> str:
        rows = (
            self.supabase_admin
            .table("tenants")
            .select("id, slug")
            .eq("slug", SELF_GUIDED_TENANT_SLUG)
            .limit(1)
            .execute()
        ).data or []
        if rows:
            return rows[0]["id"]

        inserted = (
            self.supabase_admin
            .table("tenants")
            .insert({
                "name": SELF_GUIDED_TENANT_NAME,
                "slug": SELF_GUIDED_TENANT_SLUG,
            })
            .execute()
        ).data or []
        if not inserted:
            existing = (
                self.supabase_admin
                .table("tenants")
                .select("id")
                .eq("slug", SELF_GUIDED_TENANT_SLUG)
                .limit(1)
                .execute()
            ).data or []
            if existing:
                return existing[0]["id"]
            raise ValueError("Unable to ensure self guided tenant")
        return inserted[0]["id"]

    def create_client(self, *, tenant_id: str, user_id: str) -> dict[str, Any]:
        inserted = (
            self.supabase_admin
            .table("clients")
            .insert({
                "tenant_id": tenant_id,
                "user_id": user_id,
                "assigned_trainer_id": None,
            })
            .execute()
        ).data or []
        if not inserted:
            raise ValueError("Unable to create client row")
        return inserted[0]

    def get_client_by_id(self, *, client_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("clients")
            .select("id, tenant_id, user_id, assigned_trainer_id, created_at")
            .eq("id", client_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def get_client_for_user_and_tenant(self, *, user_id: str, tenant_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("clients")
            .select("id, tenant_id, user_id, assigned_trainer_id, created_at")
            .eq("user_id", user_id)
            .eq("tenant_id", tenant_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def update_client(self, *, client_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        updated = (
            self.supabase_admin
            .table("clients")
            .update(fields)
            .eq("id", client_id)
            .execute()
        ).data or []
        if not updated:
            raise ValueError("Unable to update client row")
        return updated[0]

    def ensure_client_profile(self, *, client_id: str) -> dict[str, Any]:
        existing = self.get_client_profile(client_id=client_id)
        if existing:
            return existing

        inserted = (
            self.supabase_admin
            .table("user_fitness_profiles")
            .insert({
                "client_id": client_id,
                "onboarding_status": "not_started",
            })
            .execute()
        ).data or []
        if not inserted:
            latest = self.get_client_profile(client_id=client_id)
            if latest:
                return latest
            raise ValueError("Unable to ensure client profile")
        return inserted[0]

    def upsert_client_profile_fields(self, *, client_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        if not fields:
            existing = self.get_client_profile_snapshot(client_id=client_id)
            return existing or {}
        payload = {
            **fields,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updated = (
            self.supabase_admin
            .table("user_fitness_profiles")
            .update(payload)
            .eq("client_id", client_id)
            .execute()
        ).data or []
        if updated:
            return updated[0]
        latest = self.get_client_profile_snapshot(client_id=client_id)
        if latest:
            return latest
        raise ValueError("Unable to update client profile fields")

    def mark_client_profile_onboarding_completed(self, *, client_id: str, current_step: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        (
            self.supabase_admin
            .table("user_fitness_profiles")
            .update({
                "onboarding_status": "completed",
                "onboarding_completed_at": now,
                "onboarding_last_step": current_step,
                "updated_at": now,
            })
            .eq("client_id", client_id)
            .execute()
        )

    def copy_profile_to_client_if_missing(self, *, source_client_id: str, target_client_id: str) -> None:
        if source_client_id == target_client_id:
            return
        target_profile = self.get_client_profile_snapshot(client_id=target_client_id)
        source_profile = self.get_client_profile_snapshot(client_id=source_client_id)
        if not source_profile:
            return
        if target_profile:
            return
        source_filtered = {
            key: source_profile.get(key)
            for key in PROFILE_COPY_FIELDS
            if key in source_profile
        }
        self.supabase_admin.table("user_fitness_profiles").insert(
            {
                "client_id": target_client_id,
                **source_filtered,
            }
        ).execute()

    def get_invite_code(self, *, code: str) -> dict[str, Any] | None:
        normalized = code.strip().lower()
        rows = (
            self.supabase_admin
            .table("trainer_invite_codes")
            .select("id, code, trainer_id, tenant_id, is_active, expires_at")
            .eq("code", code.strip())
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            # fallback for case-insensitive index only
            all_rows = (
                self.supabase_admin
                .table("trainer_invite_codes")
                .select("id, code, trainer_id, tenant_id, is_active, expires_at")
                .execute()
            ).data or []
            for row in all_rows:
                if str(row.get("code", "")).strip().lower() == normalized:
                    return row
            return None
        return rows[0]

    def get_trainer_by_id(self, *, trainer_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("trainers")
            .select("id, tenant_id, user_id, display_name, is_active")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def get_trainer_for_user(self, *, user_id: str) -> dict[str, Any] | None:
        rows = (
            self.supabase_admin
            .table("trainers")
            .select("id, tenant_id, user_id, display_name, is_active")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def get_tenant_slug(self, *, tenant_id: str) -> str | None:
        rows = (
            self.supabase_admin
            .table("tenants")
            .select("slug")
            .eq("id", tenant_id)
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            return None
        slug = rows[0].get("slug")
        return str(slug) if isinstance(slug, str) else None

    def insert_assignment_history(self, *, client_id: str, trainer_id: str) -> None:
        (
            self.supabase_admin
            .table("client_trainer_assignments")
            .insert({
                "client_id": client_id,
                "trainer_id": trainer_id,
            })
            .execute()
        )
