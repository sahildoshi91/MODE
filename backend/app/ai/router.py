from app.ai.models import ModelTier, QueryKind


class AIRequestRouter:
    def route_workout_generation(self, duration: int, goals: list[str], injuries: list[str]) -> tuple[QueryKind, ModelTier]:
        complexity_score = 0

        if duration >= 45:
            complexity_score += 1
        if len(goals) >= 2:
            complexity_score += 1
        if len(injuries) >= 1:
            complexity_score += 1

        if complexity_score >= 2:
            return QueryKind.DEEP, ModelTier.LARGE

        return QueryKind.LIGHT, ModelTier.SMALL

    def resolve_model_name(self, tier: ModelTier) -> str:
        if tier == ModelTier.LARGE:
            return "gpt-4"
        return "gpt-4o-mini"
