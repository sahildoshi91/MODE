from datetime import datetime, timezone
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.db.client import get_supabase_user_client


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


def _coerce_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _is_disabled_user(user: object) -> bool:
    deleted_at = _coerce_datetime(getattr(user, "deleted_at", None))
    if deleted_at is not None:
        return True

    banned_until = _coerce_datetime(getattr(user, "banned_until", None))
    if banned_until and banned_until >= datetime.now(timezone.utc):
        return True

    app_metadata = getattr(user, "app_metadata", None)
    if isinstance(app_metadata, dict) and bool(app_metadata.get("disabled")):
        return True

    user_metadata = getattr(user, "user_metadata", None)
    if isinstance(user_metadata, dict) and bool(user_metadata.get("account_deleted")):
        return True

    return False


def require_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    token = _extract_bearer_token(authorization)
    auth_client = get_supabase_user_client(token).auth

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
    if _is_disabled_user(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
        )

    return AuthenticatedUser(
        id=user.id,
        email=getattr(user, "email", None),
        access_token=token,
    )


CurrentUser = Depends(require_user)
