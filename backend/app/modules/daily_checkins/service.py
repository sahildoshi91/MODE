from datetime import date, datetime, timezone

from app.modules.daily_checkins.repository import DailyCheckinRepository
from app.modules.daily_checkins.schemas import (
    DailyCheckinInputs,
    DailyCheckinResult,
    DailyCheckinStatusResponse,
    MindsetRecommendation,
    NutritionRecommendation,
    TrainingRecommendation,
)


MODE_BUNDLES = {
    "GREEN": {
        "training": TrainingRecommendation(
            type="Strength or HIIT",
            duration="45-60 min",
            intensity="High",
        ),
        "nutrition": NutritionRecommendation(rule="Prioritize protein + carbs."),
        "mindset": MindsetRecommendation(cue="Push limits. Build capacity."),
    },
    "YELLOW": {
        "training": TrainingRecommendation(
            type="Moderate cardio or controlled strength",
            duration="30-45 min",
            intensity="Moderate",
        ),
        "nutrition": NutritionRecommendation(rule="Eat balanced meals."),
        "mindset": MindsetRecommendation(cue="Stay consistent."),
    },
    "BLUE": {
        "training": TrainingRecommendation(
            type="Light movement or recovery",
            duration="20-30 min",
            intensity="Low",
        ),
        "nutrition": NutritionRecommendation(rule="Hydrate + whole foods."),
        "mindset": MindsetRecommendation(cue="Win by showing up."),
    },
    "RED": {
        "training": TrainingRecommendation(
            type="Mobility, walking, or full restorative movement",
            duration="10-20 min",
            intensity="Very low",
        ),
        "nutrition": NutritionRecommendation(rule="Focus on micronutrients."),
        "mindset": MindsetRecommendation(cue="Recovery is progress."),
    },
}


class DailyCheckinService:
    def __init__(self, repository: DailyCheckinRepository):
        self.repository = repository

    def get_status(self, client_id: str, checkin_date: date) -> DailyCheckinStatusResponse:
        record = self.repository.get_by_client_and_date(client_id, checkin_date)
        if not record:
            return DailyCheckinStatusResponse(date=checkin_date, completed=False)

        return DailyCheckinStatusResponse(
            date=checkin_date,
            completed=True,
            checkin=self._build_result(record),
        )

    def submit_checkin(
        self,
        client_id: str,
        checkin_date: date,
        inputs: DailyCheckinInputs,
        time_to_complete: int | None = None,
    ) -> DailyCheckinResult:
        score = self._calculate_total_score(inputs)
        mode = self._assign_mode(score)
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "client_id": client_id,
            "date": checkin_date.isoformat(),
            "inputs": inputs.model_dump(),
            "total_score": score,
            "assigned_mode": mode,
            "time_to_complete": time_to_complete,
            "completion_timestamp": now,
            "updated_at": now,
        }
        record = self.repository.upsert_checkin(payload)
        return self._build_result(record)

    def _calculate_total_score(self, inputs: DailyCheckinInputs) -> int:
        return (
            inputs.sleep
            + inputs.stress
            + inputs.soreness
            + inputs.nutrition
            + inputs.motivation
        )

    def _assign_mode(self, score: int) -> str:
        if score >= 21:
            return "GREEN"
        if score >= 16:
            return "YELLOW"
        if score >= 11:
            return "BLUE"
        return "RED"

    def _build_result(self, record: dict) -> DailyCheckinResult:
        mode = record["assigned_mode"]
        bundle = MODE_BUNDLES[mode]
        record_date = record["date"]
        if isinstance(record_date, str):
            parsed_date = date.fromisoformat(record_date)
        else:
            parsed_date = record_date

        completion_timestamp = record.get("completion_timestamp")
        if isinstance(completion_timestamp, str):
            parsed_completion_timestamp = datetime.fromisoformat(
                completion_timestamp.replace("Z", "+00:00")
            )
        else:
            parsed_completion_timestamp = completion_timestamp

        return DailyCheckinResult(
            id=record["id"],
            date=parsed_date,
            score=record["total_score"],
            mode=mode,
            inputs=DailyCheckinInputs(**record["inputs"]),
            training=bundle["training"],
            nutrition=bundle["nutrition"],
            mindset=bundle["mindset"],
            time_to_complete=record.get("time_to_complete"),
            completion_timestamp=parsed_completion_timestamp,
        )
