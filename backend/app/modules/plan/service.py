from app.modules.plan.repository import PlanRepository
from app.modules.plan.schemas import PlanSummary
from app.modules.profile.service import ProfileService


class PlanService:
    def __init__(self, repository: PlanRepository, profile_service: ProfileService):
        self.repository = repository
        self.profile_service = profile_service

    def build_plan_summary(self, trainer_id: str | None, client_id: str | None) -> PlanSummary:
        if not trainer_id or not client_id:
            raise ValueError("Missing trainer or client context for plan generation")

        profile = self.profile_service.get_or_create_profile(client_id)
        frequency = profile.get("workout_frequency_target")
        goal_type = profile.get("primary_goal")
        templates = self.repository.find_templates(trainer_id, frequency, goal_type)

        split = "full_body"
        if frequency and frequency >= 4:
            split = "upper_lower"
        elif frequency and frequency >= 5:
            split = "performance_split"

        rationale = "Generated from client profile signals."
        if templates:
            rationale = f"Aligned to trainer template '{templates[0]['name']}'."

        return PlanSummary(
            trainer_id=trainer_id,
            client_id=client_id,
            status="ready" if frequency and goal_type else "needs_more_profile_data",
            rationale=rationale,
            recommended_split=split,
            next_step="Generate the first workout block once onboarding reaches plan_ready.",
            source_template_ids=[template["id"] for template in templates],
        )
