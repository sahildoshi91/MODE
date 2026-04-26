from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status

from app.core.auth import AuthenticatedUser


@dataclass
class ResourceOwner:
    tenant_id: str | None = None
    trainer_id: str | None = None
    trainer_user_id: str | None = None
    client_id: str | None = None
    client_user_id: str | None = None


def _as_resource_owner(resource_owner: ResourceOwner | dict[str, Any] | None) -> ResourceOwner:
    if isinstance(resource_owner, ResourceOwner):
        return resource_owner
    if isinstance(resource_owner, dict):
        return ResourceOwner(
            tenant_id=str(resource_owner.get("tenant_id") or "").strip() or None,
            trainer_id=str(resource_owner.get("trainer_id") or "").strip() or None,
            trainer_user_id=str(resource_owner.get("trainer_user_id") or "").strip() or None,
            client_id=str(resource_owner.get("client_id") or "").strip() or None,
            client_user_id=str(resource_owner.get("client_user_id") or "").strip() or None,
        )
    return ResourceOwner()


def authorize_actor_access(
    actor: AuthenticatedUser,
    trainer_id: str | None,
    client_id: str | None,
    resource_owner: ResourceOwner | dict[str, Any] | None,
    *,
    require_trainer_owner: bool = False,
    require_client_owner: bool = False,
    expected_tenant_id: str | None = None,
) -> None:
    owner = _as_resource_owner(resource_owner)

    normalized_trainer_id = str(trainer_id or "").strip() or None
    normalized_client_id = str(client_id or "").strip() or None
    normalized_expected_tenant_id = str(expected_tenant_id or "").strip() or None

    if normalized_expected_tenant_id and owner.tenant_id and owner.tenant_id != normalized_expected_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant scope mismatch",
        )
    if normalized_trainer_id and owner.trainer_id and owner.trainer_id != normalized_trainer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Trainer scope mismatch",
        )
    if normalized_client_id and owner.client_id and owner.client_id != normalized_client_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Client scope mismatch",
        )
    if require_trainer_owner:
        if not owner.trainer_user_id or owner.trainer_user_id != actor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Trainer-only endpoint",
            )
    if require_client_owner:
        if not owner.client_user_id or owner.client_user_id != actor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authenticated user does not own the resolved client record for this check-in",
            )
