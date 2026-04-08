import json
import logging
from datetime import date, datetime, timezone

from app.modules.daily_checkins.repository import DailyCheckinRepository, DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
    DailyCheckinInputs,
    DailyCheckinResult,
    DailyCheckinStatusResponse,
    Environment,
    GenerateCheckinPlanRequest,
    GenerateCheckinPlanResponse,
    LogGeneratedWorkoutResponse,
    MindsetRecommendation,
    NutritionRecommendation,
    PlanType,
    StructuredNutritionPlan,
    StructuredTrainingPlan,
    TrainingRecommendation,
    YesterdayCheckinSummary,
)
from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient


logger = logging.getLogger(__name__)


MODE_BUNDLES = {
    "BEAST": {
        "training": TrainingRecommendation(
            type="Strength or HIIT",
            duration="45-60 min",
            intensity="High",
        ),
        "nutrition": NutritionRecommendation(rule="Fuel hard with protein and performance carbs."),
        "mindset": MindsetRecommendation(cue="Attack the day. You are cleared to push."),
        "tagline": "Full-send readiness with permission to push the pace.",
        "quote": "Discipline feels lighter when your body and mind are both ready to move.",
        "coach": "Rex",
    },
    "BUILD": {
        "training": TrainingRecommendation(
            type="Moderate cardio or controlled strength",
            duration="30-45 min",
            intensity="Moderate",
        ),
        "nutrition": NutritionRecommendation(rule="Keep meals balanced and steady all day."),
        "mindset": MindsetRecommendation(cue="Build momentum with disciplined reps."),
        "tagline": "Stable readiness for strong, intentional work.",
        "quote": "Consistency compounds when you keep showing up with control.",
        "coach": "Alex",
    },
    "RECOVER": {
        "training": TrainingRecommendation(
            type="Light movement or recovery",
            duration="20-30 min",
            intensity="Low",
        ),
        "nutrition": NutritionRecommendation(rule="Hydrate well and lean on whole foods."),
        "mindset": MindsetRecommendation(cue="Recovery done well is progress."),
        "tagline": "A recovery-leaning day that still rewards smart action.",
        "quote": "Listening to your body is not backing off. It is how you stay in the game.",
        "coach": "Maya",
    },
    "REST": {
        "training": TrainingRecommendation(
            type="Mobility, walking, or full restorative movement",
            duration="10-20 min",
            intensity="Very low",
        ),
        "nutrition": NutritionRecommendation(rule="Keep it simple: fluids, protein, and micronutrients."),
        "mindset": MindsetRecommendation(cue="Rest with intent so you can return stronger."),
        "tagline": "Restore the system and protect tomorrow's ceiling.",
        "quote": "Restraint is a form of discipline when recovery is what your body is asking for.",
        "coach": "Zen",
    },
}

LOWEST_DIMENSION_TIPS = {
    "sleep": "Protect recovery today with steady hydration, protein at each meal, and an earlier wind-down tonight.",
    "stress": "Keep meals simple and regular so stress does not push you into under-fueling or random snacking.",
    "soreness": "Prioritize protein, fluids, and colorful whole foods to support tissue recovery while soreness settles down.",
    "nutrition": "Hit the basics first today: anchor meals around protein, produce, and enough carbs to support your energy.",
    "motivation": "Lower the friction today with one easy win: a balanced first meal and one training block you can complete cleanly.",
}
GOAL_LABELS = {
    "fat_loss": "fat loss",
    "strength": "strength",
    "muscle_gain": "muscle gain",
    "performance": "performance",
    "general_fitness": "general fitness",
}
CANONICAL_TO_LEGACY_MODE = {
    "BEAST": "GREEN",
    "BUILD": "YELLOW",
    "RECOVER": "BLUE",
    "REST": "RED",
}
LEGACY_TO_CANONICAL_MODE = {legacy: canonical for canonical, legacy in CANONICAL_TO_LEGACY_MODE.items()}


class DailyCheckinService:
    def __init__(self, repository: DailyCheckinRepository, profile_service=None, llm_client=None):
        self.repository = repository
        self.profile_service = profile_service
        self.llm_client = llm_client or OpenAIClient()

    def get_status(self, client_id: str, checkin_date: date) -> DailyCheckinStatusResponse:
        record = self.repository.get_by_client_and_date(client_id, checkin_date)
        if not record:
            return DailyCheckinStatusResponse(date=checkin_date, completed=False)

        return DailyCheckinStatusResponse(
            date=checkin_date,
            completed=True,
            checkin=self._build_result(record),
        )

    def get_previous_checkin_summary(self, client_id: str, before_date: date):
        record = self.repository.get_previous_checkin(client_id, before_date)
        return self._build_yesterday_summary(record)

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
        try:
            record = self.repository.upsert_checkin(payload)
        except DailyCheckinRepositoryError as exc:
            if not self._is_mode_constraint_error(exc):
                raise
            legacy_mode = CANONICAL_TO_LEGACY_MODE.get(mode)
            if not legacy_mode:
                raise
            logger.warning(
                "Retrying daily check-in save with legacy assigned_mode=%s after mode check-constraint rejection for mode=%s",
                legacy_mode,
                mode,
            )
            payload["assigned_mode"] = legacy_mode
            record = self.repository.upsert_checkin(payload)
        return self._build_result(record)

    def generate_plan(
        self,
        client_id: str,
        user_id: str,
        request: GenerateCheckinPlanRequest,
    ) -> GenerateCheckinPlanResponse:
        checkin = self.repository.get_by_client_and_id(client_id, request.checkin_id)
        if not checkin:
            raise ValueError("Check-in not found")
        normalized_mode = self._normalize_mode(checkin["assigned_mode"])

        profile = {}
        if self.profile_service:
            try:
                profile = self.profile_service.get_or_create_profile(client_id) or {}
            except Exception as exc:
                logger.warning(
                    "Generate-plan profile lookup failed for client_id=%s checkin_id=%s: %s",
                    client_id,
                    request.checkin_id,
                    exc,
                )
        yesterday = None
        if request.include_yesterday_context:
            yesterday = self.repository.get_previous_checkin(client_id, self._coerce_date(checkin["date"]))
        last_workout = self.repository.get_latest_workout_session(user_id)

        if request.plan_type == PlanType.TRAINING and request.environment is None:
            raise ValueError("Training plan generation requires an environment")
        if request.plan_type == PlanType.NUTRITION and request.nutrition_day_note is not None and not request.nutrition_day_note.strip():
            raise ValueError("Nutrition day note must not be empty")

        generated = self._generate_structured_plan(
            checkin=checkin,
            profile=profile or {},
            request=request,
            yesterday=yesterday,
            last_workout=last_workout,
        )
        structured_model = generated["structured_model"]
        structured_payload = structured_model.model_dump()
        raw_content = json.dumps(structured_payload)
        saved = self.repository.upsert_generated_plan(
            {
                "client_id": client_id,
                "checkin_id": request.checkin_id,
                "plan_type": request.plan_type.value,
                "assigned_mode": normalized_mode,
                "environment": request.environment.value if request.environment else None,
                "time_available": request.time_available,
                "nutrition_day_note": request.nutrition_day_note.strip() if request.nutrition_day_note else None,
                "used_yesterday_context": bool(request.include_yesterday_context and yesterday),
                "raw_content": raw_content,
                "structured_content": structured_payload,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        return GenerateCheckinPlanResponse(
            plan_id=saved["id"],
            plan_type=request.plan_type,
            content=raw_content,
            structured=structured_payload,
        )

    def log_generated_workout(
        self,
        user_id: str,
        request,
    ) -> LogGeneratedWorkoutResponse:
        generated_plan = self.repository.get_generated_plan_by_id(request.generated_plan_id)
        if not generated_plan:
            raise ValueError("Generated plan not found")
        workout_plan = self.repository.insert_workout_plan(
            {
                "user_id": user_id,
                "plan_data": generated_plan["structured_content"],
            }
        )
        created = self.repository.insert_workout_session(
            {
                "user_id": user_id,
                "title": request.title,
                "duration": max(1, round(request.elapsed_seconds / 60)),
                "plan_type": "guided_training",
                "completed": request.completed,
                "plan_id": workout_plan["id"],
                "feel_rating": request.feel_rating,
            }
        )
        return LogGeneratedWorkoutResponse(workout_id=created["id"], completed=bool(created.get("completed", request.completed)))

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
            return "BEAST"
        if score >= 16:
            return "BUILD"
        if score >= 11:
            return "RECOVER"
        return "REST"

    def _normalize_mode(self, mode: str) -> str:
        return LEGACY_TO_CANONICAL_MODE.get(mode, mode)

    def _is_mode_constraint_error(self, exc: DailyCheckinRepositoryError) -> bool:
        if exc.code and str(exc.code) != "23514":
            return False
        message = " ".join(
            part for part in [str(exc), exc.details, exc.hint] if isinstance(part, str) and part.strip()
        ).lower()
        return "daily_checkins_assigned_mode_check" in message

    def _build_result(self, record: dict) -> DailyCheckinResult:
        mode = self._normalize_mode(record["assigned_mode"])
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

        client_id = record.get("client_id")
        inputs = DailyCheckinInputs(**record["inputs"])
        lowest_dimension = self._get_lowest_dimension(inputs)
        primary_goal = None
        yesterday_record = None

        if self.profile_service and client_id:
            try:
                profile = self.profile_service.get_or_create_profile(client_id) or {}
                primary_goal = profile.get("primary_goal")
            except Exception as exc:
                logger.warning(
                    "Daily check-in enrichment skipped profile lookup for client_id=%s: %s",
                    client_id,
                    exc,
                )

        if client_id and self.repository:
            try:
                yesterday_record = self.repository.get_previous_checkin(client_id, parsed_date)
            except Exception as exc:
                logger.warning(
                    "Daily check-in enrichment skipped previous-checkin lookup for client_id=%s date=%s: %s",
                    client_id,
                    parsed_date,
                    exc,
                )

        return DailyCheckinResult(
            id=record["id"],
            date=parsed_date,
            score=record["total_score"],
            mode=mode,
            inputs=inputs,
            training=bundle["training"],
            nutrition=bundle["nutrition"],
            mindset=bundle["mindset"],
            time_to_complete=record.get("time_to_complete"),
            completion_timestamp=parsed_completion_timestamp,
            mode_tagline=bundle["tagline"],
            nutrition_tip=self._build_nutrition_tip(lowest_dimension, primary_goal),
            motivational_quote=self._build_motivational_quote(mode, primary_goal),
            primary_goal=primary_goal,
            yesterday_checkin_summary=self._build_yesterday_summary(yesterday_record),
        )

    def _build_yesterday_summary(self, record: dict | None) -> YesterdayCheckinSummary | None:
        if not record:
            return None
        return YesterdayCheckinSummary(
            date=self._coerce_date(record["date"]),
            score=record["total_score"],
            mode=self._normalize_mode(record["assigned_mode"]),
            inputs=DailyCheckinInputs(**record["inputs"]),
        )

    def _coerce_date(self, value):
        if isinstance(value, str):
            return date.fromisoformat(value)
        return value

    def _get_lowest_dimension(self, inputs: DailyCheckinInputs) -> str:
        values = inputs.model_dump()
        return min(values, key=lambda key: values[key])

    def _build_nutrition_tip(self, dimension: str, primary_goal: str | None) -> str:
        goal_text = GOAL_LABELS.get(primary_goal or "", primary_goal or "your goal")
        base_tip = LOWEST_DIMENSION_TIPS.get(dimension, LOWEST_DIMENSION_TIPS["nutrition"])
        return f"{base_tip} Keep it aligned with {goal_text}."

    def _build_motivational_quote(self, mode: str, primary_goal: str | None) -> str:
        quote = MODE_BUNDLES[mode]["quote"]
        goal_text = GOAL_LABELS.get(primary_goal or "", primary_goal)
        if goal_text:
            return f"{quote} Every smart choice still moves {goal_text} forward."
        return quote

    def _generate_structured_plan(self, checkin: dict, profile: dict, request: GenerateCheckinPlanRequest, yesterday: dict | None, last_workout: dict | None):
        mode = self._normalize_mode(checkin["assigned_mode"])
        inputs = DailyCheckinInputs(**checkin["inputs"])
        prompt = self._build_generation_prompt(
            checkin=checkin,
            profile=profile,
            request=request,
            yesterday=yesterday,
            last_workout=last_workout,
            inputs=inputs,
        )
        raw_text = ""
        try:
            raw_text = self.llm_client.create_chat_completion(
                model=GPT_5_4_MINI_MODEL,
                messages=prompt,
            )
        except Exception as exc:
            logger.warning("Post-check-in generation fell back to local template: %s", exc)

        parser = StructuredTrainingPlan if request.plan_type == PlanType.TRAINING else StructuredNutritionPlan
        parsed = self._parse_structured_json(raw_text, parser)
        if parsed is None:
            parsed = self._build_fallback_plan(
                plan_type=request.plan_type,
                mode=mode,
                inputs=inputs,
                request=request,
                profile=profile,
                last_workout=last_workout,
            )

        if not parsed.coachNote.strip():
            parsed.coachNote = self._build_adaptive_note(mode, last_workout)

        return {"structured_model": parsed}

    def _build_generation_prompt(self, checkin: dict, profile: dict, request: GenerateCheckinPlanRequest, yesterday: dict | None, last_workout: dict | None, inputs: DailyCheckinInputs):
        mode = self._normalize_mode(checkin["assigned_mode"])
        why = profile.get("primary_goal") or "general fitness"
        adaptive_note = self._build_adaptive_note(mode, last_workout)
        schema_text = TRAINING_SCHEMA_TEXT if request.plan_type == PlanType.TRAINING else NUTRITION_SCHEMA_TEXT
        request_details = {
            "checkin_date": str(checkin["date"]),
            "mode": mode,
            "score": checkin["total_score"],
            "inputs": inputs.model_dump(),
            "why": why,
            "experience_level": profile.get("experience_level"),
            "equipment_access": profile.get("equipment_access"),
            "preferred_session_length": profile.get("preferred_session_length"),
            "environment": request.environment.value if request.environment else None,
            "time_available": request.time_available,
            "nutrition_day_note": request.nutrition_day_note,
            "yesterday_context": {
                "score": yesterday.get("total_score"),
                "mode": yesterday.get("assigned_mode"),
                "inputs": yesterday.get("inputs"),
            } if yesterday else None,
            "last_workout": last_workout or None,
            "adaptive_note": adaptive_note,
            "coach_name": MODE_BUNDLES[mode]["coach"],
        }
        return [
            {
                "role": "system",
                "content": (
                    f"You are Coach {MODE_BUNDLES[mode]['coach']} writing a {request.plan_type.value} plan for MODE. "
                    "Respond with strict JSON only, no markdown fences, and ensure coachNote is personalized."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Build a {request.plan_type.value} plan using this context:\n"
                    f"{json.dumps(request_details)}\n"
                    f"Return JSON matching exactly this schema:\n{schema_text}"
                ),
            },
        ]

    def _parse_structured_json(self, raw_text: str, parser):
        if not raw_text:
            return None
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
        try:
            payload = json.loads(cleaned.strip())
            return parser(**payload)
        except Exception:
            return None

    def _build_fallback_plan(self, plan_type: PlanType, mode: str, inputs: DailyCheckinInputs, request: GenerateCheckinPlanRequest, profile: dict, last_workout: dict | None):
        if plan_type == PlanType.TRAINING:
            duration = request.time_available or profile.get("preferred_session_length") or 30
            difficulty = "advanced" if inputs.motivation >= 4 and inputs.sleep >= 4 else "intermediate"
            workout_type = "strength" if mode == "BEAST" else "general"
            return StructuredTrainingPlan(
                title=f"{mode.title()} Mode {MODE_BUNDLES[mode]['coach']} Session",
                type=workout_type,
                difficulty=difficulty,
                durationMinutes=duration,
                description=f"A {duration}-minute session tailored for {request.environment.value.replace('_', ' ')} on your {mode} day.",
                warmup=[
                    {"name": "Dynamic reset", "duration": "3 min", "description": "Open up joints and raise body temperature."},
                    {"name": "Prep circuit", "duration": "4 min", "description": "Prime the movement patterns you will use."},
                ],
                exercises=[
                    {
                        "name": "Goblet squat",
                        "sets": 3,
                        "reps": "10",
                        "rest": "60 sec",
                        "muscleGroup": "legs",
                        "description": "Control the lowering phase and stay tall through the chest.",
                        "coachTip": "Leave one clean rep in reserve and own the tempo.",
                    },
                    {
                        "name": "Push-up variation",
                        "sets": 3,
                        "reps": "8-12",
                        "rest": "45 sec",
                        "muscleGroup": "chest",
                        "description": "Use an incline if needed to keep reps crisp.",
                        "coachTip": "Smooth reps beat sloppy reps today.",
                    },
                    {
                        "name": "Split squat",
                        "sets": 2,
                        "reps": "8 / side",
                        "rest": "45 sec",
                        "muscleGroup": "legs",
                        "description": "Stay balanced and drive through the front foot.",
                        "coachTip": "Move with control, especially if soreness is lingering.",
                    },
                ],
                cooldown=[
                    {"name": "Easy walk", "duration": "2 min", "description": "Bring your heart rate down gradually."},
                    {"name": "Breathing reset", "duration": "2 min", "description": "Finish with long exhales and relaxed shoulders."},
                ],
                coachNote=self._build_adaptive_note(mode, last_workout),
            )

        meals = [
            {
                "name": "Breakfast",
                "timing": "Morning",
                "emoji": "🍳",
                "foods": [
                    {"name": "Greek yogurt", "amount": "1 bowl", "calories": 220, "protein": 25},
                    {"name": "Berries", "amount": "1 cup", "calories": 70, "protein": 1},
                ],
                "totalCalories": 290,
                "totalProtein": 26,
                "notes": "Start with an easy protein win.",
            },
            {
                "name": "Lunch",
                "timing": "Midday",
                "emoji": "🥗",
                "foods": [
                    {"name": "Chicken bowl", "amount": "1 serving", "calories": 520, "protein": 42},
                    {"name": "Fruit", "amount": "1 piece", "calories": 90, "protein": 1},
                ],
                "totalCalories": 610,
                "totalProtein": 43,
                "notes": request.nutrition_day_note or "Keep lunch balanced and repeatable.",
            },
            {
                "name": "Dinner",
                "timing": "Evening",
                "emoji": "🍽️",
                "foods": [
                    {"name": "Salmon", "amount": "6 oz", "calories": 360, "protein": 38},
                    {"name": "Rice and vegetables", "amount": "1 plate", "calories": 340, "protein": 8},
                ],
                "totalCalories": 700,
                "totalProtein": 46,
                "notes": "End the day with recovery-supportive protein and carbs.",
            },
        ]
        return StructuredNutritionPlan(
            title=f"{mode.title()} Mode Fuel Plan",
            totalCalories=sum(meal["totalCalories"] for meal in meals),
            totalProtein=sum(meal["totalProtein"] for meal in meals),
            meals=meals,
            coachNote=self._build_adaptive_note(mode, last_workout),
        )

    def _build_adaptive_note(self, mode: str, last_workout: dict | None) -> str:
        feel_rating = last_workout.get("feel_rating") if isinstance(last_workout, dict) else None
        if isinstance(feel_rating, int) and 1 <= feel_rating <= 5:
            feel_labels = {
                1: "Very Hard",
                2: "Hard",
                3: "Moderate",
                4: "Manageable",
                5: "Easy",
            }
            feel_label = feel_labels[feel_rating]
            if feel_rating <= 2:
                return (
                    f"Your last session felt {feel_label}, so I've dialed intensity down today to protect recovery while "
                    "still keeping momentum."
                )
            if feel_rating == 3:
                return (
                    f"Your last session felt {feel_label}, so today's plan keeps the load balanced and repeatable without "
                    "spiking fatigue."
                )
            return (
                f"Your last session felt {feel_label}, so today's plan nudges intensity up with controlled progression."
            )

        last_title = last_workout.get("title") if isinstance(last_workout, dict) else None
        if last_title:
            return f"Your last logged session was '{last_title}', so today's {mode.lower()} plan keeps the effort targeted and sustainable."
        return f"Coach {MODE_BUNDLES[mode]['coach']} tuned this {mode.lower()} plan to match today's readiness instead of forcing a generic template."


TRAINING_SCHEMA_TEXT = json.dumps(
    {
        "title": "string",
        "type": "hiit|strength|cardio|flexibility|mobility|general",
        "difficulty": "beginner|intermediate|advanced",
        "durationMinutes": 30,
        "description": "string",
        "warmup": [{"name": "string", "duration": "string", "description": "string"}],
        "exercises": [
            {
                "name": "string",
                "sets": 3,
                "reps": "8-10",
                "rest": "60 sec",
                "muscleGroup": "string",
                "description": "string",
                "coachTip": "string",
            }
        ],
        "cooldown": [{"name": "string", "duration": "string", "description": "string"}],
        "coachNote": "string",
    }
)
NUTRITION_SCHEMA_TEXT = json.dumps(
    {
        "title": "string",
        "totalCalories": 2000,
        "totalProtein": 150,
        "meals": [
            {
                "name": "string",
                "timing": "string",
                "emoji": "string",
                "foods": [{"name": "string", "amount": "string", "calories": 300, "protein": 25}],
                "totalCalories": 300,
                "totalProtein": 25,
                "notes": "string",
            }
        ],
        "coachNote": "string",
    }
)
