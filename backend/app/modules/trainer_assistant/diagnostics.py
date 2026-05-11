from __future__ import annotations

import logging
from typing import Any

from app.db.client import get_supabase_admin_client
from app.modules.trainer_assistant.repository import TrainerAssistantRepository


logger = logging.getLogger(__name__)


def run_trainer_assistant_storage_preflight() -> dict[str, Any]:
    repository = TrainerAssistantRepository(get_supabase_admin_client())
    result = repository.storage_preflight()
    if result.get("healthy"):
        logger.info("Trainer assistant storage preflight passed.")
    else:
        logger.warning(
            "Trainer assistant storage preflight failed missing=%s errors=%s",
            result.get("missing"),
            result.get("errors"),
        )
    return result
