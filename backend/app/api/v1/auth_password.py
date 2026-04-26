from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.auth import AuthenticatedUser
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.db.client import get_supabase_public_client


router = APIRouter()


class PasswordSignInRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=512)


class PasswordSignUpRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=512)


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    redirect_to: str | None = Field(default=None, max_length=1024)


class AuthSessionEnvelope(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str | None = None
    expires_in: int | None = None
    user_id: str | None = None
    email: str | None = None
    requires_email_verification: bool = False


class PasswordResetResponse(BaseModel):
    success: bool = True


def _normalized_email(value: str) -> str:
    return str(value or "").strip().lower()


def _auth_rate_limit_actor(request: Request) -> AuthenticatedUser:
    # No authenticated principal exists yet; rate limit by IP only.
    return AuthenticatedUser(id="", email=None, access_token=None)


def _to_session_envelope(payload: Any) -> AuthSessionEnvelope:
    session = getattr(payload, "session", None)
    user = getattr(payload, "user", None)
    return AuthSessionEnvelope(
        access_token=getattr(session, "access_token", None),
        refresh_token=getattr(session, "refresh_token", None),
        token_type=getattr(session, "token_type", None),
        expires_in=getattr(session, "expires_in", None),
        user_id=getattr(user, "id", None),
        email=getattr(user, "email", None),
        requires_email_verification=session is None,
    )


@router.post("/sign-in", response_model=AuthSessionEnvelope)
async def sign_in_with_password(request: PasswordSignInRequest, http_request: Request):
    if not settings.auth_password_proxy_enabled:
        raise HTTPException(status_code=503, detail="Password auth proxy is disabled")

    enforce_rate_limit(
        group="login",
        user=_auth_rate_limit_actor(http_request),
        request=http_request,
        context={"email": _normalized_email(request.email)},
    )

    client = get_supabase_public_client()
    try:
        payload = client.auth.sign_in_with_password(
            {
                "email": _normalized_email(request.email),
                "password": request.password,
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials") from exc

    envelope = _to_session_envelope(payload)
    if not envelope.access_token or not envelope.refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return envelope


@router.post("/sign-up", response_model=AuthSessionEnvelope)
async def sign_up_with_password(request: PasswordSignUpRequest, http_request: Request):
    if not settings.auth_password_proxy_enabled:
        raise HTTPException(status_code=503, detail="Password auth proxy is disabled")

    enforce_rate_limit(
        group="signup",
        user=_auth_rate_limit_actor(http_request),
        request=http_request,
        context={"email": _normalized_email(request.email)},
    )

    client = get_supabase_public_client()
    try:
        payload = client.auth.sign_up(
            {
                "email": _normalized_email(request.email),
                "password": request.password,
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create account") from exc

    return _to_session_envelope(payload)


@router.post("/reset", response_model=PasswordResetResponse)
async def reset_password(request: PasswordResetRequest, http_request: Request):
    if not settings.auth_password_proxy_enabled:
        raise HTTPException(status_code=503, detail="Password auth proxy is disabled")

    enforce_rate_limit(
        group="password_reset",
        user=_auth_rate_limit_actor(http_request),
        request=http_request,
        context={"email": _normalized_email(request.email)},
    )

    client = get_supabase_public_client()
    redirect_to = request.redirect_to.strip() if isinstance(request.redirect_to, str) else None
    try:
        if redirect_to:
            try:
                client.auth.reset_password_email(_normalized_email(request.email), {"redirect_to": redirect_to})
            except AttributeError:
                client.auth.reset_password_for_email(_normalized_email(request.email), {"redirect_to": redirect_to})
        else:
            try:
                client.auth.reset_password_email(_normalized_email(request.email))
            except AttributeError:
                client.auth.reset_password_for_email(_normalized_email(request.email))
    except Exception:
        # Respond success-equivalent to avoid account enumeration.
        return PasswordResetResponse(success=True)

    return PasswordResetResponse(success=True)
