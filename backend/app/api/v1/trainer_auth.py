from fastapi import HTTPException, status

from app.core.auth import AuthenticatedUser
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
    if not is_trainer_actor(user, trainer_context):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Trainer-only endpoint",
        )
    return trainer_context.trainer_id
