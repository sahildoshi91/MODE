from __future__ import annotations

import logging


logger = logging.getLogger(__name__)

PRICING_LAST_VERIFIED = "2026-05-16"

# Per-token rates. Keep pricing centralized so routing/orchestration code does
# not carry provider-specific price constants inline.
MODEL_PRICING: dict[str, dict[str, float]] = {
    "gemini-2.5-flash": {"input_per_token": 0.000075 / 1000, "output_per_token": 0.00030 / 1000},
    "gemini-2.5-flash-lite": {"input_per_token": 0.00008 / 1000, "output_per_token": 0.00030 / 1000},
    "gpt-5.4-mini": {"input_per_token": 0.00015 / 1000, "output_per_token": 0.00060 / 1000},
    "gpt-5.4": {"input_per_token": 0.00250 / 1000, "output_per_token": 0.01000 / 1000},
    "gpt-5.5": {"input_per_token": 0.00250 / 1000, "output_per_token": 0.01000 / 1000},
    "claude-sonnet-4.6": {"input_per_token": 0.00300 / 1000, "output_per_token": 0.01500 / 1000},
    "claude-sonnet-4-20250514": {"input_per_token": 0.00300 / 1000, "output_per_token": 0.01500 / 1000},
}


def calculate_cost_usd(model: str, tokens_in: int, tokens_out: int) -> float | None:
    rates = MODEL_PRICING.get(str(model or ""))
    if not rates:
        logger.warning("cost_calculation_missing_model model=%s", model)
        return None
    return round(
        max(int(tokens_in or 0), 0) * rates["input_per_token"]
        + max(int(tokens_out or 0), 0) * rates["output_per_token"],
        6,
    )
