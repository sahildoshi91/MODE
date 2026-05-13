from __future__ import annotations

import logging
import re
import secrets
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.v1.trainer_auth import require_client_actor, require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_trainer_client_repository, get_trainer_context
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.db.client import get_supabase_admin_client
from app.modules.trainer_clients.repository import TrainerClientRepository
from app.modules.storage_lifecycle.repository import StorageLifecycleRepository
from app.modules.storage_lifecycle.service import StorageLifecycleError, StorageLifecycleService


router = APIRouter()
logger = logging.getLogger(__name__)

_SAFE_PATH_RE = re.compile(r"^[A-Za-z0-9/_\-.]+$")
_RANDOM_BASENAME_RE = re.compile(r"[A-Za-z0-9_-]{24,}")
_FORBIDDEN_EXTENSIONS = {
    "exe",
    "dll",
    "bat",
    "cmd",
    "com",
    "msi",
    "apk",
    "ipa",
    "dmg",
    "pkg",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "js",
    "jar",
    "php",
    "py",
}
_FORBIDDEN_MIME_PREFIXES = (
    "application/x-msdownload",
    "application/x-dosexec",
    "application/x-sh",
    "application/x-shellscript",
    "application/x-bat",
    "text/x-shellscript",
)


class PrivateUploadUrlRequest(BaseModel):
    scope: Literal["client_self", "trainer_workspace", "trainer_client"]
    filename: str = Field(min_length=1, max_length=180)
    mime_type: str = Field(min_length=3, max_length=180)
    size_bytes: int = Field(gt=0, le=1024 * 1024 * 512)
    client_id: str | None = Field(default=None, max_length=64)


class PrivateUploadUrlResponse(BaseModel):
    bucket: str
    object_path: str
    signed_upload_url: str
    upload_token: str
    expires_in: int


class PrivateDownloadUrlRequest(BaseModel):
    object_path: str = Field(min_length=3, max_length=512)


class PrivateDownloadUrlResponse(BaseModel):
    bucket: str
    object_path: str
    signed_url: str
    expires_in: int


class PrivateUploadCompleteRequest(BaseModel):
    upload_token: str = Field(min_length=1, max_length=256)
    object_path: str = Field(min_length=3, max_length=512)
    bucket: str | None = Field(default=None, min_length=3, max_length=120)


class PrivateUploadCompleteResponse(BaseModel):
    bucket: str
    object_path: str
    status: Literal["verified"]
    verified: bool = True


def _normalized_extension(filename: str) -> str:
    value = str(filename or "").strip().lower()
    suffix = PurePosixPath(value).suffix
    return suffix.lstrip(".")


def _validate_file_type(*, filename: str, mime_type: str, size_bytes: int) -> str:
    extension = _normalized_extension(filename)
    if not extension:
        raise HTTPException(status_code=422, detail="File extension is required")

    allowed_extensions = set(settings.storage_allowed_extensions_list)
    if extension not in allowed_extensions:
        raise HTTPException(status_code=415, detail="Unsupported file extension")
    if extension in _FORBIDDEN_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Executable files are not allowed")

    normalized_mime = str(mime_type or "").strip().lower()
    if not normalized_mime:
        raise HTTPException(status_code=422, detail="MIME type is required")
    allowed_mime_types = set(settings.storage_allowed_mime_types_list)
    if normalized_mime not in allowed_mime_types:
        raise HTTPException(status_code=415, detail="Unsupported MIME type")
    if any(normalized_mime.startswith(prefix) for prefix in _FORBIDDEN_MIME_PREFIXES):
        raise HTTPException(status_code=415, detail="Executable files are not allowed")

    max_size = int(settings.storage_max_file_size_bytes)
    if int(size_bytes) > max_size:
        raise HTTPException(status_code=413, detail="File exceeds maximum allowed size")

    return extension


def _build_object_path(
    *,
    scope: str,
    trainer_context: TrainerContext,
    trainer_client_repository: TrainerClientRepository,
    user: AuthenticatedUser,
    extension: str,
    requested_client_id: str | None,
) -> tuple[str, str | None, str | None]:
    if scope == "client_self":
        client_id = require_client_actor(user, trainer_context)
        prefix = f"client/{client_id}"
        owner_trainer_id = trainer_context.trainer_id or None
        owner_client_id = client_id
    elif scope == "trainer_workspace":
        trainer_id = require_trainer_actor(user, trainer_context)
        prefix = f"trainer/{trainer_id}/workspace"
        owner_trainer_id = trainer_id
        owner_client_id = None
    elif scope == "trainer_client":
        trainer_id = require_trainer_actor(user, trainer_context)
        client_id = str(requested_client_id or "").strip()
        if not client_id:
            raise HTTPException(status_code=422, detail="client_id is required for trainer_client scope")
        assigned_client = trainer_client_repository.get_client_for_trainer(trainer_id, client_id)
        if not assigned_client:
            raise HTTPException(status_code=403, detail="Client is not assigned to this trainer")
        prefix = f"trainer/{trainer_id}/clients/{client_id}"
        owner_trainer_id = trainer_id
        owner_client_id = client_id
    else:
        raise HTTPException(status_code=422, detail="Invalid storage scope")

    random_basename = f"{uuid4().hex}_{secrets.token_urlsafe(18)}"
    return f"{prefix}/{random_basename}.{extension}", owner_trainer_id, owner_client_id


def _normalize_object_path(path_value: str) -> str:
    normalized = str(path_value or "").strip().strip("/")
    if not normalized:
        raise HTTPException(status_code=422, detail="object_path is required")
    if ".." in normalized or "\\" in normalized:
        raise HTTPException(status_code=400, detail="Invalid object path")
    if not _SAFE_PATH_RE.match(normalized):
        raise HTTPException(status_code=400, detail="Invalid object path")

    basename = PurePosixPath(normalized).stem
    if not _RANDOM_BASENAME_RE.search(basename):
        raise HTTPException(status_code=403, detail="Object path is not eligible for signed access")

    return normalized


def _authorize_download_path(
    *,
    path: str,
    user: AuthenticatedUser,
    trainer_context: TrainerContext,
    trainer_client_repository: TrainerClientRepository,
) -> None:
    normalized = _normalize_object_path(path)

    if trainer_context.client_id and normalized.startswith(f"client/{trainer_context.client_id}/"):
        require_client_actor(user, trainer_context)
        return

    if normalized.startswith("trainer/"):
        trainer_id = require_trainer_actor(user, trainer_context)
        workspace_prefix = f"trainer/{trainer_id}/workspace/"
        if normalized.startswith(workspace_prefix):
            return

        client_prefix = f"trainer/{trainer_id}/clients/"
        if normalized.startswith(client_prefix):
            remainder = normalized[len(client_prefix):]
            target_client_id = remainder.split("/", 1)[0]
            if not target_client_id:
                raise HTTPException(status_code=403, detail="Forbidden file path")
            assigned_client = trainer_client_repository.get_client_for_trainer(trainer_id, target_client_id)
            if not assigned_client:
                logger.warning(
                    "legacy_storage_access_denied reason=trainer_client_not_assigned user_id=%s trainer_id=%s target_client_id=%s path=%s",
                    user.id,
                    trainer_context.trainer_id,
                    target_client_id,
                    normalized,
                )
                raise HTTPException(status_code=403, detail="Forbidden file path")
            return

    logger.warning(
        "legacy_storage_access_denied reason=path_not_authorized user_id=%s trainer_id=%s client_id=%s path=%s",
        user.id,
        trainer_context.trainer_id,
        trainer_context.client_id,
        normalized,
    )
    raise HTTPException(status_code=403, detail="Forbidden file path")


def _ownership_from_authorized_path(
    *,
    object_path: str,
    trainer_context: TrainerContext,
    user: AuthenticatedUser,
) -> tuple[str | None, str | None]:
    normalized = _normalize_object_path(object_path)
    if normalized.startswith("client/"):
        client_id = require_client_actor(user, trainer_context)
        if not normalized.startswith(f"client/{client_id}/"):
            raise HTTPException(status_code=403, detail="Forbidden file path")
        return trainer_context.trainer_id or None, client_id

    trainer_id = require_trainer_actor(user, trainer_context)
    if normalized.startswith(f"trainer/{trainer_id}/workspace/"):
        return trainer_id, None
    client_prefix = f"trainer/{trainer_id}/clients/"
    if normalized.startswith(client_prefix):
        remainder = normalized[len(client_prefix):]
        target_client_id = remainder.split("/", 1)[0]
        if not target_client_id:
            raise HTTPException(status_code=403, detail="Forbidden file path")
        return trainer_id, target_client_id
    raise HTTPException(status_code=403, detail="Forbidden file path")


def _signed_upload_value(signed_upload: object, *keys: str) -> str:
    for key in keys:
        if isinstance(signed_upload, dict):
            value = signed_upload.get(key)
        else:
            value = getattr(signed_upload, key, None)
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return ""


@router.post("/private/upload-url", response_model=PrivateUploadUrlResponse)
async def issue_private_upload_url(
    request: PrivateUploadUrlRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    trainer_client_repository: TrainerClientRepository = Depends(get_trainer_client_repository),
):
    enforce_rate_limit(
        group="file_upload",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
            "scope": request.scope,
        },
    )

    extension = _validate_file_type(
        filename=request.filename,
        mime_type=request.mime_type,
        size_bytes=request.size_bytes,
    )
    object_path, owner_trainer_id, owner_client_id = _build_object_path(
        scope=request.scope,
        trainer_context=trainer_context,
        trainer_client_repository=trainer_client_repository,
        user=user,
        extension=extension,
        requested_client_id=request.client_id,
    )

    bucket_name = str(settings.storage_private_bucket).strip()
    if not bucket_name:
        logger.error(
            "storage_upload_url_config_missing scope=%s tenant_id=%s trainer_id=%s client_id=%s",
            request.scope,
            trainer_context.tenant_id,
            trainer_context.trainer_id,
            trainer_context.client_id,
        )
        raise HTTPException(status_code=500, detail="Storage bucket is not configured")

    signed_ttl = max(30, min(int(settings.storage_signed_url_ttl_seconds), 900))
    upload_window = max(30, min(int(settings.storage_upload_window_seconds), 300))
    admin_client = get_supabase_admin_client()
    try:
        signed_upload = admin_client.storage.from_(bucket_name).create_signed_upload_url(object_path)
    except Exception as exc:
        logger.exception(
            "storage_signed_upload_url_failed error_category=%s bucket=%s scope=%s tenant_id=%s trainer_id=%s client_id=%s",
            exc.__class__.__name__,
            bucket_name,
            request.scope,
            trainer_context.tenant_id,
            owner_trainer_id,
            owner_client_id,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to issue upload URL") from exc

    signed_url = _signed_upload_value(signed_upload, "signed_url", "signedUrl", "signedURL")
    token = _signed_upload_value(signed_upload, "token")
    if not signed_url or not token:
        logger.warning(
            "storage_signed_upload_url_incomplete bucket=%s scope=%s tenant_id=%s trainer_id=%s client_id=%s",
            bucket_name,
            request.scope,
            trainer_context.tenant_id,
            owner_trainer_id,
            owner_client_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to issue upload URL",
        )

    lifecycle_service = StorageLifecycleService(StorageLifecycleRepository(admin_client))
    try:
        lifecycle_service.record_upload_grant(
            upload_token=token,
            bucket=bucket_name,
            object_path=object_path,
            scope=request.scope,
            owner_user_id=user.id,
            owner_trainer_id=owner_trainer_id,
            owner_client_id=owner_client_id,
            expires_in_seconds=upload_window,
        )
    except Exception as exc:
        logger.exception(
            "Unable to persist upload grant user_id=%s scope=%s object_path=%s",
            user.id,
            request.scope,
            object_path,
            exc_info=exc,
        )
        raise HTTPException(status_code=500, detail="Upload lifecycle storage unavailable")

    return PrivateUploadUrlResponse(
        bucket=bucket_name,
        object_path=object_path,
        signed_upload_url=signed_url,
        upload_token=token,
        expires_in=min(signed_ttl, upload_window),
    )


@router.post("/private/download-url", response_model=PrivateDownloadUrlResponse)
async def issue_private_download_url(
    request: PrivateDownloadUrlRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    trainer_client_repository: TrainerClientRepository = Depends(get_trainer_client_repository),
):
    enforce_rate_limit(
        group="file_upload",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
            "scope": "download",
        },
    )

    object_path = _normalize_object_path(request.object_path)
    _authorize_download_path(
        path=object_path,
        user=user,
        trainer_context=trainer_context,
        trainer_client_repository=trainer_client_repository,
    )

    bucket_name = str(settings.storage_private_bucket).strip()
    expires_in = max(30, min(int(settings.storage_signed_url_ttl_seconds), 900))
    admin_client = get_supabase_admin_client()
    signed_result = admin_client.storage.from_(bucket_name).create_signed_url(
        object_path,
        expires_in,
    )
    signed_url = (
        str(getattr(signed_result, "signedURL", "") or "").strip()
        or str(getattr(signed_result, "signedUrl", "") or "").strip()
    )
    if not signed_url:
        raise HTTPException(status_code=502, detail="Unable to issue download URL")

    return PrivateDownloadUrlResponse(
        bucket=bucket_name,
        object_path=object_path,
        signed_url=signed_url,
        expires_in=expires_in,
    )


@router.post("/private/upload-complete", response_model=PrivateUploadCompleteResponse)
async def complete_private_upload(
    request: PrivateUploadCompleteRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    trainer_client_repository: TrainerClientRepository = Depends(get_trainer_client_repository),
):
    enforce_rate_limit(
        group="file_upload",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
            "scope": "upload_complete",
        },
    )

    object_path = _normalize_object_path(request.object_path)
    _authorize_download_path(
        path=object_path,
        user=user,
        trainer_context=trainer_context,
        trainer_client_repository=trainer_client_repository,
    )
    owner_trainer_id, owner_client_id = _ownership_from_authorized_path(
        object_path=object_path,
        trainer_context=trainer_context,
        user=user,
    )

    bucket_name = str(request.bucket or settings.storage_private_bucket or "").strip()
    if not bucket_name:
        raise HTTPException(status_code=500, detail="Storage bucket is not configured")

    admin_client = get_supabase_admin_client()
    lifecycle_service = StorageLifecycleService(StorageLifecycleRepository(admin_client))
    try:
        result = lifecycle_service.verify_upload_completion(
            upload_token=request.upload_token,
            bucket=bucket_name,
            object_path=object_path,
            owner_user_id=user.id,
            owner_trainer_id=owner_trainer_id,
            owner_client_id=owner_client_id,
        )
    except StorageLifecycleError as exc:
        logger.warning(
            "legacy_storage_access_denied reason=upload_complete_validation_failed user_id=%s status=%s path=%s",
            user.id,
            exc.status_code,
            object_path,
        )
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception as exc:
        logger.exception("Unexpected upload completion failure user_id=%s path=%s", user.id, object_path, exc_info=exc)
        raise HTTPException(status_code=500, detail="Unable to finalize upload") from exc

    return PrivateUploadCompleteResponse(
        bucket=result.bucket,
        object_path=result.object_path,
        status=result.status,
        verified=result.verified,
    )
