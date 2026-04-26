from fastapi import HTTPException

from app.core.auth import AuthenticatedUser
from app.core.authorization import authorize_actor_access
from app.core.tenancy import TrainerContext


def is_trainer_actor(user: AuthenticatedUser, trainer_context: TrainerContext) -> bool:
    return bool(
        trainer_context.trainer_id
        and trainer_context.trainer_user_id
        and trainer_context.trainer_user_id == user.id
    )


def require_trainer_actor(user: AuthenticatedUser, trainer_context: TrainerContext) -> str:
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    authorize_actor_access(
        actor=user,
        trainer_id=trainer_context.trainer_id,
        client_id=trainer_context.client_id,
        resource_owner={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "trainer_user_id": trainer_context.trainer_user_id,
            "client_id": trainer_context.client_id,
            "client_user_id": trainer_context.client_user_id,
        },
        require_trainer_owner=True,
        expected_tenant_id=trainer_context.tenant_id,
    )
    return trainer_context.trainer_id


def require_client_actor(user: AuthenticatedUser, trainer_context: TrainerContext) -> str:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client context found")
    if not trainer_context.client_user_id:
        raise HTTPException(status_code=400, detail="Client account is missing an owning user")
    authorize_actor_access(
        actor=user,
        trainer_id=trainer_context.trainer_id,
        client_id=trainer_context.client_id,
        resource_owner={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "trainer_user_id": trainer_context.trainer_user_id,
            "client_id": trainer_context.client_id,
            "client_user_id": trainer_context.client_user_id,
        },
        expected_tenant_id=trainer_context.tenant_id,
    )
    if trainer_context.client_user_id != user.id:
        raise HTTPException(status_code=403, detail="Client-only endpoint")
    return trainer_context.client_id


def require_client_or_trainer_actor(user: AuthenticatedUser, trainer_context: TrainerContext) -> str:
    if trainer_context.client_id:
        return require_client_actor(user, trainer_context)
    return require_trainer_actor(user, trainer_context)
