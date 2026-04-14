from __future__ import annotations

import logging
from typing import Any

from app.db.client import get_supabase_admin_client
from app.modules.trainer_onboarding.repository import TrainerOnboardingRepository


logger = logging.getLogger(__name__)


def run_trainer_onboarding_storage_preflight() -> dict[str, Any]:
    repository = TrainerOnboardingRepository(get_supabase_admin_client())
    result = repository.storage_preflight()
    if result.get("healthy"):
        logger.info("Trainer onboarding storage preflight passed.")
    else:
        logger.warning(
            "Trainer onboarding storage preflight failed missing_tables=%s errors=%s",
            result.get("missing_tables"),
            result.get("errors"),
        )
    return result
