from __future__ import annotations

import hashlib
import json
import logging
import re
from functools import lru_cache
from typing import Any

from app.core.config import settings


logger = logging.getLogger(__name__)

CHAT_CONTEXT_TTL_SECONDS = 60
USER_DIGEST_TTL_SECONDS = 300
TRAINER_PERSONA_TTL_SECONDS = 600
SEMANTIC_CACHE_TTL_SECONDS = 3600


def chat_context_key(trainer_id: str, client_id: str) -> str:
    return f"mode:chat_ctx:{trainer_id}:{client_id}"


def user_digest_key(trainer_id: str, client_id: str) -> str:
    return f"mode:user_digest:{trainer_id}:{client_id}"


def trainer_persona_key(trainer_id: str) -> str:
    return f"mode:trainer_persona:{trainer_id}"


def semantic_cache_key(trainer_id: str, query: str) -> str:
    return f"mode:semantic:{trainer_id}:{semantic_query_hash(query)}"


def semantic_query_hash(query: str) -> str:
    normalized = normalize_semantic_query(query)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_semantic_query(query: str) -> str:
    text = re.sub(r"[^a-z0-9\s]", " ", str(query or "").lower())
    filler = {"a", "an", "the", "please", "can", "you", "me", "my", "i", "to", "for", "about"}
    words = [word for word in text.split() if word and word not in filler]
    return " ".join(words)


class ChatCache:
    def __init__(self, redis_url: str | None, *, enabled: bool = True, timeout_ms: int = 25):
        self.enabled = bool(enabled and redis_url)
        self.redis_url = redis_url
        self.timeout_ms = max(1, int(timeout_ms or 25))
        self._client: Any | None = None

    @property
    def available(self) -> bool:
        return bool(self.enabled and self._get_client())

    def get_json(self, key: str) -> dict[str, Any] | list[Any] | None:
        client = self._get_client()
        if not client:
            return None
        try:
            raw = client.get(key)
            if raw is None:
                return None
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            parsed = json.loads(str(raw))
            return parsed if isinstance(parsed, (dict, list)) else None
        except Exception:
            logger.warning("chat_cache_get_failed key=%s", key, exc_info=True)
            return None

    def set_json(self, key: str, value: dict[str, Any] | list[Any], ttl_seconds: int) -> None:
        client = self._get_client()
        if not client:
            return
        try:
            client.setex(key, max(1, int(ttl_seconds)), json.dumps(value, default=str))
        except Exception:
            logger.warning("chat_cache_set_failed key=%s", key, exc_info=True)

    def delete(self, *keys: str) -> None:
        clean_keys = [key for key in keys if key]
        if not clean_keys:
            return
        client = self._get_client()
        if not client:
            return
        try:
            client.delete(*clean_keys)
        except Exception:
            logger.warning("chat_cache_delete_failed keys=%s", clean_keys, exc_info=True)

    def _get_client(self) -> Any | None:
        if not self.enabled:
            return None
        if self._client is not None:
            return self._client
        try:
            import redis  # type: ignore[import-not-found]

            self._client = redis.Redis.from_url(
                str(self.redis_url),
                socket_timeout=self.timeout_ms / 1000,
                socket_connect_timeout=self.timeout_ms / 1000,
                decode_responses=True,
            )
            return self._client
        except Exception:
            logger.warning("chat_cache_unavailable", exc_info=True)
            self.enabled = False
            return None


@lru_cache(maxsize=1)
def get_chat_cache() -> ChatCache:
    return ChatCache(
        settings.redis_url,
        enabled=settings.chat_cache_enabled,
        timeout_ms=settings.chat_cache_timeout_ms,
    )


def invalidate_chat_context(trainer_id: str, client_id: str, *, reason: str | None = None) -> None:
    get_chat_cache().delete(
        chat_context_key(trainer_id, client_id),
        user_digest_key(trainer_id, client_id),
    )
    logger.info(
        "chat_cache_invalidated trainer_id=%s client_id=%s reason=%s",
        trainer_id,
        client_id,
        reason or "unspecified",
    )
