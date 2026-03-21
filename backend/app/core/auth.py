from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.db.client import get_supabase_admin_client


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None = None
    access_token: str | None = None


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header",
        )

    return token


def require_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    token = _extract_bearer_token(authorization)
    auth_client = get_supabase_admin_client().auth

    try:
        user_response = auth_client.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        ) from exc

    user = getattr(user_response, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )

    return AuthenticatedUser(
        id=user.id,
        email=getattr(user, "email", None),
        access_token=token,
    )


CurrentUser = Depends(require_user)
