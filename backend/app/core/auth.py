from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import logging
import threading
import time
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status
import jwt
from jwt import InvalidTokenError, PyJWKClient

from app.core.config import settings
from app.db.client import get_supabase_user_client


logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None = None
    access_token: str | None = None
    claims: dict[str, Any] = field(default_factory=dict)


_auth_user_cache: dict[str, tuple[float, AuthenticatedUser]] = {}
_auth_user_cache_lock = threading.Lock()
_auth_token_locks: dict[str, threading.Lock] = {}
_auth_token_locks_guard = threading.Lock()
_jwks_client: PyJWKClient | None = None
_jwks_client_url: str | None = None
_jwks_client_lock = threading.Lock()


class _LocalJWTUnavailable(Exception):
    pass


def _auth_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _configured_cache_ttl_seconds(user: AuthenticatedUser | None = None) -> int:
    ttl_seconds = max(1, min(int(settings.auth_context_cache_ttl_seconds), 120))
    exp = user.claims.get("exp") if user is not None and isinstance(user.claims, dict) else None
    try:
        seconds_until_expiry = int(float(exp) - time.time()) if exp is not None else ttl_seconds
    except (TypeError, ValueError):
        seconds_until_expiry = ttl_seconds
    return max(1, min(ttl_seconds, seconds_until_expiry))


def _get_token_lock(token_key: str) -> threading.Lock:
    with _auth_token_locks_guard:
        lock = _auth_token_locks.get(token_key)
        if lock is None:
            lock = threading.Lock()
            _auth_token_locks[token_key] = lock
        return lock


def _get_cached_user(token: str) -> AuthenticatedUser | None:
    token_key = _auth_cache_key(token)
    with _auth_user_cache_lock:
        cached = _auth_user_cache.get(token_key)
        if not cached:
            return None
        expires_at, user = cached
        if expires_at <= time.monotonic():
            _auth_user_cache.pop(token_key, None)
            return None
        return user


def _set_cached_user(token: str, user: AuthenticatedUser) -> None:
    with _auth_user_cache_lock:
        _auth_user_cache[_auth_cache_key(token)] = (
            time.monotonic() + _configured_cache_ttl_seconds(user),
            user,
        )


def _shared_auth_cache_key(token: str) -> str:
    return f"mode:auth_context:{_auth_cache_key(token)}"


def _cacheable_claims(claims: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "sub",
        "email",
        "aud",
        "iss",
        "exp",
        "app_metadata",
        "user_metadata",
        "deleted_at",
        "banned_until",
    }
    return {key: value for key, value in claims.items() if key in allowed_keys}


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
    claims = cached.get("claims") if isinstance(cached.get("claims"), dict) else {}
    return AuthenticatedUser(
        id=user_id,
        email=str(cached.get("email") or "").strip() or None,
        access_token=token,
        claims=dict(claims),
    )


def _set_shared_cached_user(token: str, user: AuthenticatedUser) -> None:
    try:
        from app.modules.conversation.cache import get_chat_cache

        get_chat_cache().set_json(
            _shared_auth_cache_key(token),
            {
                "id": user.id,
                "email": user.email,
                "claims": _cacheable_claims(user.claims),
            },
            _configured_cache_ttl_seconds(user),
        )
    except Exception:
        logger.debug("auth_shared_cache_set_failed", exc_info=True)


def clear_auth_user_cache() -> None:
    with _auth_user_cache_lock:
        _auth_user_cache.clear()
    with _auth_token_locks_guard:
        _auth_token_locks.clear()
    global _jwks_client, _jwks_client_url
    with _jwks_client_lock:
        _jwks_client = None
        _jwks_client_url = None


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


def _is_disabled_claims(claims: dict[str, Any]) -> bool:
    deleted_at = _coerce_datetime(claims.get("deleted_at"))
    if deleted_at is not None:
        return True

    banned_until = _coerce_datetime(claims.get("banned_until"))
    if banned_until and banned_until >= datetime.now(timezone.utc):
        return True

    app_metadata = claims.get("app_metadata")
    if isinstance(app_metadata, dict) and bool(app_metadata.get("disabled")):
        return True

    user_metadata = claims.get("user_metadata")
    if isinstance(user_metadata, dict) and bool(user_metadata.get("account_deleted")):
        return True

    return False


def _supabase_issuer() -> str:
    supabase_url = str(settings.supabase_url or "").strip().rstrip("/")
    if not supabase_url:
        raise _LocalJWTUnavailable("missing_supabase_url")
    return f"{supabase_url}/auth/v1"


def _jwks_url() -> str:
    return f"{_supabase_issuer()}/.well-known/jwks.json"


def _get_jwks_signing_key(token: str) -> object:
    global _jwks_client, _jwks_client_url
    url = _jwks_url()
    with _jwks_client_lock:
        if _jwks_client is None or _jwks_client_url != url:
            _jwks_client = PyJWKClient(url)
            _jwks_client_url = url
        client = _jwks_client
    return client.get_signing_key_from_jwt(token).key


def _verify_jwt_locally(token: str) -> dict[str, Any]:
    if not settings.auth_local_jwt_verify_enabled:
        raise _LocalJWTUnavailable("disabled")
    if token.count(".") != 2:
        raise _LocalJWTUnavailable("not_jwt")
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise _LocalJWTUnavailable("invalid_header") from exc
    algorithm = str(header.get("alg") or "").strip()
    key_id = str(header.get("kid") or "").strip()
    if algorithm != "ES256" or not key_id:
        raise _LocalJWTUnavailable("non_jwks_token")

    signing_key = _get_jwks_signing_key(token)
    claims = jwt.decode(
        token,
        signing_key,
        algorithms=["ES256"],
        audience="authenticated",
        issuer=_supabase_issuer(),
        options={"require": ["exp", "sub", "aud", "iss"]},
    )
    subject = str(claims.get("sub") or "").strip()
    if not subject:
        raise InvalidTokenError("missing subject")
    return dict(claims)


def _remote_auth_fallback_allowed() -> bool:
    app_env = str(settings.app_env or "").strip().lower()
    return app_env not in {"staging", "prod", "production"}


def _set_request_auth_state(
    request_obj: Request | None,
    *,
    auth_decode_ms: int | None = None,
    supabase_user_lookup_ms: int | None = None,
    cache_hit: bool = False,
    in_process_cache_hit: bool = False,
    shared_cache_hit: bool = False,
    local_jwt: bool = False,
    singleflight_wait_ms: int | None = None,
    error_category: str | None = None,
) -> None:
    if request_obj is None:
        return
    request_obj.state.auth_decode_ms = 0 if auth_decode_ms is None and cache_hit else auth_decode_ms
    request_obj.state.supabase_user_lookup_ms = (
        0 if supabase_user_lookup_ms is None and (cache_hit or local_jwt) else supabase_user_lookup_ms
    )
    request_obj.state.auth_get_user_ms = request_obj.state.supabase_user_lookup_ms
    request_obj.state.auth_cache_hit = cache_hit
    request_obj.state.auth_in_process_cache_hit = in_process_cache_hit
    request_obj.state.auth_shared_cache_hit = shared_cache_hit
    request_obj.state.auth_local_jwt = local_jwt
    request_obj.state.auth_singleflight_wait_ms = singleflight_wait_ms
    request_obj.state.auth_error_category = error_category


def _user_from_claims(token: str, claims: dict[str, Any]) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=str(claims.get("sub") or ""),
        email=str(claims.get("email") or "").strip() or None,
        access_token=token,
        claims=_cacheable_claims(claims),
    )


def _remote_get_user(token: str) -> AuthenticatedUser:
    auth_client = get_supabase_user_client(token).auth
    user_response = auth_client.get_user(token)
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


def require_user(
    request: Request = None,
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    request_obj = request if isinstance(request, Request) else None
    authorization_value = request if isinstance(request, str) else authorization
    token = _extract_bearer_token(authorization_value)

    cached_user = _get_cached_user(token)
    if cached_user is not None:
        _set_request_auth_state(
            request_obj,
            cache_hit=True,
            in_process_cache_hit=True,
            local_jwt=bool(cached_user.claims),
        )
        return cached_user

    shared_cached_user = _get_shared_cached_user(token)
    if shared_cached_user is not None:
        _set_cached_user(token, shared_cached_user)
        _set_request_auth_state(
            request_obj,
            cache_hit=True,
            shared_cache_hit=True,
            local_jwt=bool(shared_cached_user.claims),
        )
        return shared_cached_user

    token_key = _auth_cache_key(token)
    token_lock = _get_token_lock(token_key)
    wait_started_at = time.perf_counter()
    with token_lock:
        singleflight_wait_ms = max(int((time.perf_counter() - wait_started_at) * 1000), 0)
        cached_user = _get_cached_user(token)
        if cached_user is not None:
            _set_request_auth_state(
                request_obj,
                cache_hit=True,
                in_process_cache_hit=True,
                local_jwt=bool(cached_user.claims),
                singleflight_wait_ms=singleflight_wait_ms,
            )
            return cached_user

        shared_cached_user = _get_shared_cached_user(token)
        if shared_cached_user is not None:
            _set_cached_user(token, shared_cached_user)
            _set_request_auth_state(
                request_obj,
                cache_hit=True,
                shared_cache_hit=True,
                local_jwt=bool(shared_cached_user.claims),
                singleflight_wait_ms=singleflight_wait_ms,
            )
            return shared_cached_user

        decode_started_at = time.perf_counter()
        try:
            claims = _verify_jwt_locally(token)
            auth_decode_ms = max(int((time.perf_counter() - decode_started_at) * 1000), 0)
            if _is_disabled_claims(claims):
                _set_request_auth_state(
                    request_obj,
                    auth_decode_ms=auth_decode_ms,
                    local_jwt=True,
                    singleflight_wait_ms=singleflight_wait_ms,
                    error_category="disabled_claims",
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account is disabled",
                )
            authenticated_user = _user_from_claims(token, claims)
            _set_cached_user(token, authenticated_user)
            _set_shared_cached_user(token, authenticated_user)
            _set_request_auth_state(
                request_obj,
                auth_decode_ms=auth_decode_ms,
                supabase_user_lookup_ms=0,
                cache_hit=False,
                local_jwt=True,
                singleflight_wait_ms=singleflight_wait_ms,
            )
            return authenticated_user
        except _LocalJWTUnavailable:
            auth_decode_ms = max(int((time.perf_counter() - decode_started_at) * 1000), 0)
            if not _remote_auth_fallback_allowed():
                _set_request_auth_state(
                    request_obj,
                    auth_decode_ms=auth_decode_ms,
                    singleflight_wait_ms=singleflight_wait_ms,
                    error_category="local_jwt_unavailable",
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired session",
                )
        except HTTPException:
            raise
        except Exception as exc:
            auth_decode_ms = max(int((time.perf_counter() - decode_started_at) * 1000), 0)
            _set_request_auth_state(
                request_obj,
                auth_decode_ms=auth_decode_ms,
                singleflight_wait_ms=singleflight_wait_ms,
                error_category="local_jwt_rejected",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session",
            ) from exc

        try:
            remote_started_at = time.perf_counter()
            authenticated_user = _remote_get_user(token)
            supabase_user_lookup_ms = max(int((time.perf_counter() - remote_started_at) * 1000), 0)
        except HTTPException:
            raise
        except Exception as exc:
            supabase_user_lookup_ms = max(int((time.perf_counter() - remote_started_at) * 1000), 0)
            _set_request_auth_state(
                request_obj,
                auth_decode_ms=auth_decode_ms,
                supabase_user_lookup_ms=supabase_user_lookup_ms,
                singleflight_wait_ms=singleflight_wait_ms,
                error_category="remote_auth_rejected",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session",
            ) from exc

        _set_cached_user(token, authenticated_user)
        _set_shared_cached_user(token, authenticated_user)
        _set_request_auth_state(
            request_obj,
            auth_decode_ms=auth_decode_ms,
            supabase_user_lookup_ms=supabase_user_lookup_ms,
            cache_hit=False,
            local_jwt=False,
            singleflight_wait_ms=singleflight_wait_ms,
        )
        return authenticated_user


CurrentUser = Depends(require_user)
