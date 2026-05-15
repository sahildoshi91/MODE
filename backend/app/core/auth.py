from datetime import datetime, timezone
from dataclasses import dataclass
import hashlib
import logging
import time

from fastapi import Depends, Header, HTTPException, Request, status

from app.db.client import get_supabase_user_client


logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None = None
    access_token: str | None = None


_AUTH_USER_CACHE_TTL_SECONDS = 60
_auth_user_cache: dict[str, tuple[float, AuthenticatedUser]] = {}


def _auth_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_cached_user(token: str) -> AuthenticatedUser | None:
    cached = _auth_user_cache.get(_auth_cache_key(token))
    if not cached:
        return None
    expires_at, user = cached
    if expires_at <= time.monotonic():
        _auth_user_cache.pop(_auth_cache_key(token), None)
        return None
    return user


def _set_cached_user(token: str, user: AuthenticatedUser) -> None:
    _auth_user_cache[_auth_cache_key(token)] = (
        time.monotonic() + _AUTH_USER_CACHE_TTL_SECONDS,
        user,
    )


def _shared_auth_cache_key(token: str) -> str:
    return f"mode:auth_user:{_auth_cache_key(token)}"


def _get_shared_cached_user(token: str) -> AuthenticatedUser | None:
    try:
        from app.modules.conversation.cache import get_chat_cache

        cached = get_chat_cache().get_json(_shared_auth_cache_key(token))
    except Exception:
        logger.debug("auth_shared_cache_get_failed", exc_info=True)
        return None
    if not isinstance(cached, dict):
        return None
    user_id = str(cached.get("id") or "").strip()
    if not user_id:
        return None
    return AuthenticatedUser(
        id=user_id,
        email=str(cached.get("email") or "").strip() or None,
        access_token=token,
    )


def _set_shared_cached_user(token: str, user: AuthenticatedUser) -> None:
    try:
        from app.modules.conversation.cache import get_chat_cache

        get_chat_cache().set_json(
            _shared_auth_cache_key(token),
            {"id": user.id, "email": user.email},
            _AUTH_USER_CACHE_TTL_SECONDS,
        )
    except Exception:
        logger.debug("auth_shared_cache_set_failed", exc_info=True)


def clear_auth_user_cache() -> None:
    _auth_user_cache.clear()


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


def require_user(
    request: Request = None,
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    request_obj = request if isinstance(request, Request) else None
    authorization_value = request if isinstance(request, str) else authorization
    token = _extract_bearer_token(authorization_value)
    cached_user = _get_cached_user(token)
    if cached_user is not None:
        if request_obj is not None:
            request_obj.state.auth_get_user_ms = 0
            request_obj.state.auth_cache_hit = True
        return cached_user
    shared_cached_user = _get_shared_cached_user(token)
    if shared_cached_user is not None:
        _set_cached_user(token, shared_cached_user)
        if request_obj is not None:
            request_obj.state.auth_get_user_ms = 0
            request_obj.state.auth_cache_hit = True
        return shared_cached_user
    auth_client = get_supabase_user_client(token).auth

    try:
        auth_started_at = time.perf_counter()
        user_response = auth_client.get_user(token)
        if request_obj is not None:
            request_obj.state.auth_get_user_ms = max(int((time.perf_counter() - auth_started_at) * 1000), 0)
            request_obj.state.auth_cache_hit = False
    except Exception as exc:
        if request_obj is not None:
            request_obj.state.auth_get_user_ms = max(int((time.perf_counter() - auth_started_at) * 1000), 0)
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

    authenticated_user = AuthenticatedUser(
        id=user.id,
        email=getattr(user, "email", None),
        access_token=token,
    )
    _set_cached_user(token, authenticated_user)
    _set_shared_cached_user(token, authenticated_user)
    return authenticated_user


CurrentUser = Depends(require_user)
