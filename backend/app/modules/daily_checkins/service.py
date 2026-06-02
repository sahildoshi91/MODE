import json
import hashlib
import logging
import re
from datetime import date, datetime, timezone
from typing import Any

from app.modules.daily_checkins.repository import DailyCheckinRepository, DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
    CheckinResponseInput,
    CheckinResponseOutput,
    CheckinProgressResponse,
    DailyCheckinInputs,
    DailyCheckinResult,
    DailyCheckinStatusResponse,
    Environment,
    GenerateCheckinPlanRequest,
    GenerateCheckinPlanResponse,
    LastNutritionSetup,
    LastNutritionSetupResponse,
    LastTrainingSetup,
    LastTrainingSetupResponse,
    LogGeneratedWorkoutResponse,
    MindsetRecommendation,
    NutritionRecommendation,
    NutritionSetupDayType,
    PlanType,
    ProgressRecentCheckin,
    ScoreWindowChange,
    StructuredNutritionPlan,
    StructuredTrainingPlan,
    TrainingRecommendation,
    YesterdayCheckinSummary,
)
from app.modules.daily_checkins.checkin_response import (
    build_deterministic_checkin_response,
    classify_signals,
    is_meaningful_client_why,
)
from app.modules.motivation import build_mindset_why_cue, resolve_motivation_baseline
from app.modules.observability.metrics import emit_metric
from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient


logger = logging.getLogger(__name__)


MODE_BUNDLES = {
    "BEAST": {
        "training": TrainingRecommendation(
            type="Strength or HIIT",
            duration="45-60 min",
            intensity="High",
        ),
        "nutrition": NutritionRecommendation(rule="Prioritize protein early, add performance carbs around training, and keep fluids steady."),
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
        "nutrition": NutritionRecommendation(rule="Anchor each meal with protein, add balanced carbs, and keep snacks intentional."),
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
        "nutrition": NutritionRecommendation(rule="Keep protein steady, choose easy whole-food meals, and hydrate before chasing intensity."),
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
        "nutrition": NutritionRecommendation(rule="Stay consistent with protein, colorful plants, and fluids so recovery has what it needs."),
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

VEGETARIAN_EXCLUDED_FOOD_TERMS = (
    "bacon",
    "beef",
    "chicken",
    "fish",
    "ham",
    "pork",
    "salmon",
    "seafood",
    "shellfish",
    "shrimp",
    "steak",
    "tuna",
    "turkey",
)
VEGAN_EXCLUDED_FOOD_TERMS = VEGETARIAN_EXCLUDED_FOOD_TERMS + (
    "cheese",
    "cottage cheese",
    "egg",
    "eggs",
    "greek yogurt",
    "honey",
    "milk",
    "whey",
    "yogurt",
)
PESCATARIAN_EXCLUDED_FOOD_TERMS = (
    "bacon",
    "beef",
    "chicken",
    "ham",
    "pork",
    "steak",
    "turkey",
)
COMMON_NUTRITION_RESTRICTIONS = (
    (("dairy-free", "dairy free", "no dairy", "lactose"), ("cheese", "cottage cheese", "greek yogurt", "milk", "whey", "yogurt")),
    (("gluten-free", "gluten free", "no gluten", "celiac"), ("barley", "bread", "flour", "gluten", "pasta", "rye", "wheat")),
    (("peanut allergy", "peanut-free", "peanut free", "no peanuts"), ("peanut", "peanuts")),
    (("tree nut allergy", "nut allergy", "nut-free", "nut free", "no nuts"), ("almond", "almonds", "cashew", "cashews", "nuts", "walnut", "walnuts")),
    (("shellfish allergy", "no shellfish"), ("crab", "lobster", "shellfish", "shrimp")),
    (("fish allergy", "no fish"), ("fish", "salmon", "tuna")),
    (("egg-free", "egg free", "no eggs", "egg allergy"), ("egg", "eggs")),
    (("soy-free", "soy free", "no soy", "soy allergy"), ("soy", "soy milk", "tempeh", "tofu")),
)
TRAINING_CONSTRAINT_RULES = (
    (
        ("knee", "lower body pain", "lower-body pain", "leg pain", "acl", "meniscus", "patella"),
        (
            "box jump",
            "front squat",
            "goblet squat",
            "jump",
            "jumping",
            "leg press",
            "lunge",
            "reverse lunge",
            "run",
            "running",
            "sprint",
            "squat",
            "step up",
            "step-up",
        ),
    ),
    (
        ("shoulder", "wrist", "rotator cuff", "elbow pain"),
        (
            "bench press",
            "dumbbell press",
            "floor press",
            "incline push-up",
            "machine press",
            "press",
            "push up",
            "push-up",
            "wall press",
        ),
    ),
    (
        ("back pain", "low back", "lower back", "back injury", "sciatica"),
        (
            "deadlift",
            "hinge",
            "loaded carry",
            "loaded hinge",
            "romanian deadlift",
            "suitcase",
            "suitcase squat",
        ),
    ),
)


class DailyCheckinService:
    CLIENT_MEMORY_LIMIT = 24

    def __init__(
        self,
        repository: DailyCheckinRepository,
        profile_service=None,
        llm_client=None,
        checkin_response_openai_client=None,
        checkin_response_gemini_client=None,
    ):
        self.repository = repository
        self.profile_service = profile_service
        self.llm_client = llm_client or OpenAIClient()
        self.checkin_response_openai_client = checkin_response_openai_client
        self.checkin_response_gemini_client = checkin_response_gemini_client

    def get_status(self, client_id: str, checkin_date: date) -> DailyCheckinStatusResponse:
        record = self.repository.get_by_client_and_date(client_id, checkin_date)
        if not record:
            return DailyCheckinStatusResponse(date=checkin_date, completed=False, current_streak=0)

        if not self._coerce_checkin_response(record.get("checkin_response")):
            backfilled = self.ensure_checkin_response(client_id=client_id, record=record)
            if backfilled:
                record = {**record, "checkin_response": backfilled}

        return DailyCheckinStatusResponse(
            date=checkin_date,
            completed=True,
            current_streak=self._calculate_current_streak(client_id, checkin_date),
            checkin=self._build_result(record),
        )

    def get_previous_checkin_summary(self, client_id: str, before_date: date):
        record = self.repository.get_previous_checkin(client_id, before_date)
        return self._build_yesterday_summary(record)

    def get_last_training_setup(
        self,
        client_id: str,
        *,
        exclude_checkin_id: str | None = None,
    ) -> LastTrainingSetupResponse:
        if not self.repository or not hasattr(self.repository, "get_latest_training_setup"):
            return LastTrainingSetupResponse()

        record = self.repository.get_latest_training_setup(
            client_id,
            exclude_checkin_id=exclude_checkin_id,
        )
        if not record:
            return LastTrainingSetupResponse()

        environment = record.get("environment")
        time_available = record.get("time_available")
        generated_plan_id = record.get("id")
        created_at = record.get("created_at")
        if not environment or time_available is None or not generated_plan_id or not created_at:
            return LastTrainingSetupResponse()

        return LastTrainingSetupResponse(
            setup=LastTrainingSetup(
                generated_plan_id=str(generated_plan_id),
                environment=str(environment),
                time_available=int(time_available),
                created_at=created_at,
            )
        )

    def get_last_nutrition_setup(
        self,
        client_id: str,
        *,
        exclude_checkin_id: str | None = None,
    ) -> LastNutritionSetupResponse:
        if not self.repository or not hasattr(self.repository, "get_latest_nutrition_setup"):
            return LastNutritionSetupResponse()

        record = self.repository.get_latest_nutrition_setup(
            client_id,
            exclude_checkin_id=exclude_checkin_id,
        )
        if not record:
            return LastNutritionSetupResponse()

        generated_plan_id = record.get("id")
        created_at = record.get("created_at")
        if not generated_plan_id or not created_at:
            return LastNutritionSetupResponse()

        note = record.get("nutrition_day_note")
        normalized_note = note.strip() if isinstance(note, str) and note.strip() else None
        day_type = NutritionSetupDayType.CUSTOM if normalized_note else NutritionSetupDayType.NORMAL

        return LastNutritionSetupResponse(
            setup=LastNutritionSetup(
                generated_plan_id=str(generated_plan_id),
                nutrition_day_type=day_type,
                nutrition_day_note=normalized_note,
                created_at=created_at,
            )
        )

    def get_progress_analytics(self, client_id: str, as_of_date: date) -> CheckinProgressResponse:
        if not self.repository or not hasattr(self.repository, "list_checkins_on_or_before"):
            return CheckinProgressResponse(
                as_of_date=as_of_date,
                score_change_7d=ScoreWindowChange(),
                score_change_30d=ScoreWindowChange(),
            )

        rows = self.repository.list_checkins_on_or_before(client_id, as_of_date)
        normalized_rows = []
        for row in rows or []:
            row_date = row.get("date")
            if not row_date:
                continue
            parsed_date = self._coerce_date(row_date)
            score = row.get("total_score")
            if score is None:
                continue
            normalized_rows.append(
                {
                    "date": parsed_date,
                    "score": float(score),
                    "mode": self._normalize_mode(str(row.get("assigned_mode") or "")),
                }
            )

        date_to_score = {row["date"]: row["score"] for row in normalized_rows}
        current_streak = self._calculate_streak_from_dates(set(date_to_score.keys()), as_of_date)

        last_7_scores = self._window_scores(date_to_score, as_of_date=as_of_date, window_days=7, offset_days=0)
        prev_7_scores = self._window_scores(date_to_score, as_of_date=as_of_date, window_days=7, offset_days=7)
        last_30_scores = self._window_scores(date_to_score, as_of_date=as_of_date, window_days=30, offset_days=0)
        prev_30_scores = self._window_scores(date_to_score, as_of_date=as_of_date, window_days=30, offset_days=30)

        avg_7 = self._average(last_7_scores)
        avg_30 = self._average(last_30_scores)
        prev_avg_7 = self._average(prev_7_scores)
        prev_avg_30 = self._average(prev_30_scores)
        avg_7_change = self._round_for_change(avg_7)
        avg_30_change = self._round_for_change(avg_30)
        prev_avg_7_change = self._round_for_change(prev_avg_7)
        prev_avg_30_change = self._round_for_change(prev_avg_30)

        has_enough_for_30d = len(normalized_rows) >= 30
        insufficient_data_reason = None
        if not has_enough_for_30d:
            insufficient_data_reason = "Not enough data yet for 30-day analytics. Log at least 30 check-ins."

        return CheckinProgressResponse(
            as_of_date=as_of_date,
            current_streak_days=current_streak,
            total_checkins_count=len(normalized_rows),
            checkins_last_7_days=len(last_7_scores),
            avg_score_last_7_days=avg_7,
            avg_mode_last_7_days=self._assign_mode(avg_7) if avg_7 is not None else None,
            avg_score_last_30_days=avg_30 if has_enough_for_30d else None,
            avg_mode_last_30_days=self._assign_mode(avg_30) if has_enough_for_30d and avg_30 is not None else None,
            score_change_7d=ScoreWindowChange(
                value=(
                    round(avg_7_change - prev_avg_7_change, 2)
                    if avg_7_change is not None and prev_avg_7_change is not None
                    else None
                ),
                previous_average=prev_avg_7_change,
                has_previous_window_data=prev_avg_7_change is not None,
            ),
            score_change_30d=ScoreWindowChange(
                value=(
                    round(avg_30_change - prev_avg_30_change, 2)
                    if has_enough_for_30d and avg_30_change is not None and prev_avg_30_change is not None
                    else None
                ),
                previous_average=prev_avg_30_change if has_enough_for_30d else None,
                has_previous_window_data=bool(has_enough_for_30d and prev_avg_30_change is not None),
            ),
            has_enough_for_30d=has_enough_for_30d,
            insufficient_data_reason=insufficient_data_reason,
            recent_checkins=[
                ProgressRecentCheckin(
                    date=row["date"],
                    score=int(row["score"]),
                    mode=row["mode"],
                )
                for row in normalized_rows[:12]
            ],
        )

    def submit_checkin(
        self,
        client_id: str,
        checkin_date: date,
        inputs: DailyCheckinInputs,
        time_to_complete: int | None = None,
        trainer_id: str | None = None,
        trainer_display_name: str | None = None,
        trace_id: str | None = None,
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
        response_payload = self._try_generate_and_persist_checkin_response(
            client_id=client_id,
            record=record,
            trainer_id=trainer_id,
            trainer_display_name=trainer_display_name,
            trace_id=trace_id,
        )
        if response_payload:
            record = {**record, "checkin_response": response_payload}
        record = {**record, "checkin_response_attempted": True}
        return self._build_result(record)

    def ensure_checkin_response(
        self,
        *,
        client_id: str,
        record: dict[str, Any],
        trainer_id: str | None = None,
        trainer_display_name: str | None = None,
        trace_id: str | None = None,
    ) -> dict[str, Any] | None:
        existing_response = self._coerce_checkin_response(record.get("checkin_response"))
        if existing_response:
            return existing_response.model_dump(mode="json")

        return self._try_generate_and_persist_checkin_response(
            client_id=client_id,
            record=record,
            trainer_id=trainer_id,
            trainer_display_name=trainer_display_name,
            trace_id=trace_id,
        )

    def _try_generate_and_persist_checkin_response(
        self,
        *,
        client_id: str,
        record: dict[str, Any],
        trainer_id: str | None,
        trainer_display_name: str | None,
        trace_id: str | None,
    ) -> dict[str, Any] | None:
        mode = self._normalize_mode(str(record.get("assigned_mode") or ""))
        try:
            inputs = DailyCheckinInputs(**record["inputs"])
        except Exception as exc:
            self._record_checkin_response_fallback(
                reason="incomplete_or_invalid_signals",
                trace_id=trace_id,
                client_id=client_id,
                trainer_id=trainer_id,
                mode=mode,
                exc=exc,
            )
            return None

        profile = self._load_profile_for_checkin_response(client_id) or {}
        client_why = str(profile.get("user_why") or "").strip()
        if not is_meaningful_client_why(client_why):
            client_why = ""
        input_data = self._build_checkin_response_input(
            client_id=client_id,
            trainer_id=trainer_id,
            trainer_display_name=trainer_display_name,
            record=record,
            inputs=inputs,
            profile=profile,
            client_why=client_why,
        )
        classification = classify_signals(input_data)
        payload = build_deterministic_checkin_response(
            input_data=input_data,
            classification=classification,
        ).model_dump(mode="json")
        saved_response = self._persist_checkin_response_payload(
            client_id=client_id,
            checkin_id=str(record["id"]),
            payload=payload,
        )
        return saved_response if isinstance(saved_response, dict) else payload

    def _persist_checkin_response_payload(
        self,
        *,
        client_id: str,
        checkin_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        if not self.repository or not hasattr(self.repository, "update_checkin_response"):
            return payload
        try:
            saved = self.repository.update_checkin_response(
                client_id=client_id,
                checkin_id=checkin_id,
                checkin_response=payload,
            )
        except Exception as exc:
            logger.warning(
                "Check-in response persistence failed after primary check-in save client_id=%s checkin_id=%s: %s",
                client_id,
                checkin_id,
                exc,
                exc_info=True,
            )
            return payload
        saved_response = saved.get("checkin_response") if isinstance(saved, dict) else None
        return saved_response if isinstance(saved_response, dict) else payload

    def _mark_checkin_response_attempted(
        self,
        *,
        client_id: str,
        record: dict[str, Any],
        trainer_id: str | None,
        trace_id: str | None,
    ) -> dict[str, Any] | None:
        if bool(record.get("checkin_response_attempted")):
            return {"checkin_response_attempted": True}
        if not self.repository or not hasattr(self.repository, "mark_checkin_response_attempted"):
            return {"checkin_response_attempted": True}
        mode = self._normalize_mode(str(record.get("assigned_mode") or ""))
        try:
            marked = self.repository.mark_checkin_response_attempted(
                client_id=client_id,
                checkin_id=str(record["id"]),
            )
        except Exception as exc:
            self._record_checkin_response_fallback(
                reason="attempt_marker_failed",
                trace_id=trace_id,
                client_id=client_id,
                trainer_id=trainer_id,
                mode=mode,
                exc=exc,
            )
            return None
        return marked if isinstance(marked, dict) else {"checkin_response_attempted": True}

    def _load_profile_for_checkin_response(self, client_id: str) -> dict[str, Any] | None:
        if not self.profile_service:
            return None
        try:
            profile = self.profile_service.get_or_create_profile(client_id) or {}
        except Exception as exc:
            logger.warning(
                "Check-in response profile lookup failed client_id=%s: %s",
                client_id,
                exc,
            )
            return None
        return profile if isinstance(profile, dict) else {}

    def _build_checkin_response_input(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
        trainer_display_name: str | None,
        record: dict[str, Any],
        inputs: DailyCheckinInputs,
        profile: dict[str, Any],
        client_why: str,
    ) -> CheckinResponseInput:
        mode = self._normalize_mode(str(record.get("assigned_mode") or ""))
        trainer_persona = self._load_trainer_persona(trainer_id)
        trainer_knowledge = self._load_trainer_knowledge(trainer_id)
        client_memory = self._load_ai_usable_client_memory(
            trainer_id=trainer_id,
            client_id=client_id,
        )
        trainer_name = (
            self._clean_text(trainer_display_name)
            or self._clean_text((trainer_persona or {}).get("persona_name"))
            or "your coach"
        )
        return CheckinResponseInput(
            sleep_score=inputs.sleep,
            stress_score=inputs.stress,
            body_score=inputs.soreness,
            nutrition_score=inputs.nutrition,
            motivation_score=inputs.motivation,
            total_score=int(record.get("total_score") or self._calculate_total_score(inputs)),
            mode=mode,
            client_first_name=self._first_name(self._load_client_name(client_id)) or "there",
            client_goal=self._clean_text(profile.get("primary_goal")) or "general fitness",
            client_why=client_why,
            client_constraints=self._build_client_constraints(profile, client_memory),
            client_experience_level=self._clean_text(profile.get("experience_level")) or "beginner",
            trainer_name=trainer_name,
            trainer_programming_philosophy=(
                self._clean_text((trainer_persona or {}).get("coaching_philosophy"))
                or "progressive overload, form first"
            ),
            trainer_nutrition_approach=self._derive_trainer_nutrition_approach(trainer_knowledge),
            trainer_tone=(
                self._clean_text((trainer_persona or {}).get("tone_description"))
                or "direct, encouraging, no fluff"
            ),
            trainer_kb_summary=self._summarize_trainer_kb(trainer_knowledge),
        )

    def _load_client_name(self, client_id: str) -> str | None:
        if not self.repository or not hasattr(self.repository, "get_client_name"):
            return None
        try:
            return self.repository.get_client_name(client_id)
        except Exception as exc:
            logger.warning("Check-in response client-name lookup failed client_id=%s: %s", client_id, exc)
            return None

    def _load_trainer_persona(self, trainer_id: str | None) -> dict[str, Any] | None:
        if not trainer_id or not self.repository or not hasattr(self.repository, "get_default_trainer_persona"):
            return None
        try:
            persona = self.repository.get_default_trainer_persona(trainer_id)
        except Exception as exc:
            logger.warning("Check-in response trainer persona lookup failed trainer_id=%s: %s", trainer_id, exc)
            return None
        return persona if isinstance(persona, dict) else None

    def _load_trainer_knowledge(self, trainer_id: str | None) -> list[dict[str, Any]]:
        if not trainer_id or not self.repository or not hasattr(self.repository, "list_active_trainer_knowledge_entries"):
            return []
        try:
            rows = self.repository.list_active_trainer_knowledge_entries(trainer_id, limit=12)
        except Exception as exc:
            logger.warning("Check-in response trainer knowledge lookup failed trainer_id=%s: %s", trainer_id, exc)
            return []
        return [row for row in rows or [] if isinstance(row, dict)]

    def _build_client_constraints(self, profile: dict[str, Any], client_memory: list[dict[str, Any]]) -> str:
        parts = [
            self._clean_text(profile.get("injury_notes")),
            self._clean_text(profile.get("equipment_access")),
            self._clean_text(profile.get("training_location")),
            self._clean_text(profile.get("minimum_win")),
        ]
        for memory in client_memory[:6]:
            tags = " ".join(str(tag) for tag in memory.get("tags") or [])
            text = self._clean_text(memory.get("summary") or memory.get("text") or memory.get("memory_key"))
            memory_type = str(memory.get("memory_type") or "")
            if text and (
                memory_type == "constraint"
                or any(keyword in tags.lower() for keyword in ("injury", "constraint", "equipment", "nutrition", "diet"))
            ):
                parts.append(text)
        return self._clip_words("; ".join(part for part in parts if part), 40) or "none stated"

    def _derive_trainer_nutrition_approach(self, knowledge_rows: list[dict[str, Any]]) -> str:
        for row in knowledge_rows:
            knowledge_type = str(row.get("knowledge_type") or "").lower()
            tags = " ".join(str(tag) for tag in row.get("tags") or []).lower()
            if "nutrition" not in knowledge_type and "nutrition" not in tags:
                continue
            text = self._clean_text(row.get("structured_summary") or row.get("raw_content") or row.get("title"))
            if text:
                return self._clip_words(text, 24)
        return "protein at every meal, don't overcomplicate it"

    def _summarize_trainer_kb(self, knowledge_rows: list[dict[str, Any]]) -> str:
        snippets = []
        for row in knowledge_rows[:6]:
            text = self._clean_text(row.get("structured_summary") or row.get("raw_content") or row.get("title"))
            if text:
                snippets.append(text)
        return self._clip_words(" ".join(snippets), 160)

    def _record_checkin_response_fallback(
        self,
        *,
        reason: str,
        trace_id: str | None,
        client_id: str,
        trainer_id: str | None,
        mode: str,
        exc: Exception | None = None,
    ) -> None:
        logger.warning(
            "checkin_response_fallback_triggered trace_id=%s client_id=%s trainer_id=%s mode=%s reason=%s error=%s",
            trace_id,
            client_id,
            trainer_id,
            mode,
            reason,
            str(exc) if exc else "",
        )
        try:
            emit_metric(
                "checkin_response_fallback_triggered",
                1.0,
                tags={
                    "mode": mode or "unknown",
                    "reason": reason,
                    "trainer_id": trainer_id or "",
                },
            )
        except Exception:
            logger.debug("checkin_response_fallback_metric_failed", exc_info=True)

    def generate_plan(
        self,
        client_id: str,
        user_id: str,
        request: GenerateCheckinPlanRequest,
        trainer_id: str | None = None,
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
        if request.plan_type == PlanType.TRAINING and request.time_available is None:
            raise ValueError("Training plan generation requires time available")
        if request.plan_type == PlanType.NUTRITION and request.nutrition_day_note is not None and not request.nutrition_day_note.strip():
            raise ValueError("Nutrition day note must not be empty")

        client_memory = self._load_ai_usable_client_memory(
            trainer_id=trainer_id,
            client_id=client_id,
        )
        motivation_baseline = resolve_motivation_baseline(profile)

        request_fingerprint = self._build_request_fingerprint(
            request,
            client_memory=client_memory,
            motivation_baseline=motivation_baseline,
        )
        latest_variant = None
        if hasattr(self.repository, "get_latest_generated_plan_variant"):
            latest_variant = self.repository.get_latest_generated_plan_variant(
                client_id=client_id,
                checkin_id=request.checkin_id,
                plan_type=request.plan_type.value,
                request_fingerprint=request_fingerprint,
            )
        if latest_variant and not request.refresh_requested:
            return self._build_generate_plan_response(
                request=request,
                saved_record=latest_variant,
            )

        prior_variant = None
        if hasattr(self.repository, "get_latest_generated_plan_from_other_fingerprints"):
            prior_variant = self.repository.get_latest_generated_plan_from_other_fingerprints(
                client_id=client_id,
                checkin_id=request.checkin_id,
                plan_type=request.plan_type.value,
                request_fingerprint=request_fingerprint,
            )

        generated = self._generate_structured_plan(
            checkin=checkin,
            profile=profile or {},
            request=request,
            yesterday=yesterday,
            last_workout=last_workout,
            prior_variant=prior_variant,
            client_memory=client_memory,
        )
        structured_model = generated["structured_model"]
        if (
            request.plan_type == PlanType.TRAINING
            and prior_variant
            and self._plans_effectively_identical(structured_model.model_dump(), prior_variant.get("structured_content"))
        ):
            logger.warning(
                "Generated workout matched prior variant for client_id=%s checkin_id=%s; forcing fallback divergence",
                client_id,
                request.checkin_id,
            )
            structured_model = self._build_fallback_plan(
                plan_type=request.plan_type,
                mode=normalized_mode,
                inputs=DailyCheckinInputs(**checkin["inputs"]),
                request=request,
                profile=profile or {},
                last_workout=last_workout,
                client_memory=client_memory,
            )
        structured_payload = structured_model.model_dump()
        raw_content = json.dumps(structured_payload)
        revision_number = 1
        if latest_variant:
            revision_number = int(latest_variant.get("revision_number") or 0) + 1
        payload = {
            "client_id": client_id,
            "checkin_id": request.checkin_id,
            "plan_type": request.plan_type.value,
            "assigned_mode": normalized_mode,
            "environment": request.environment.value if request.environment else None,
            "time_available": request.time_available,
            "nutrition_day_note": request.nutrition_day_note.strip() if request.nutrition_day_note else None,
            "used_yesterday_context": bool(request.include_yesterday_context and yesterday),
            "request_fingerprint": request_fingerprint,
            "revision_number": revision_number,
            "raw_content": raw_content,
            "structured_content": structured_payload,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if hasattr(self.repository, "insert_generated_plan"):
            saved = self.repository.insert_generated_plan(payload)
        else:
            saved = self.repository.upsert_generated_plan(payload)
        return self._build_generate_plan_response(
            request=request,
            saved_record={**saved, "structured_content": structured_payload, "raw_content": raw_content},
        )

    def log_generated_workout(
        self,
        user_id: str,
        request,
        *,
        client_id: str | None = None,
    ) -> LogGeneratedWorkoutResponse:
        generated_plan = self.repository.get_generated_plan_by_id(
            request.generated_plan_id,
            client_id=client_id,
        )
        if not generated_plan:
            raise ValueError("Generated plan not found")
        structured_content = generated_plan.get("structured_content")
        if not isinstance(structured_content, dict):
            raise ValueError("Generated plan is missing structured content")
        workout_plan = self.repository.insert_workout_plan(
            {
                "user_id": user_id,
                "plan_data": structured_content,
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
        profile = {}
        primary_goal = None
        motivation_baseline = "general fitness"
        yesterday_record = None

        if self.profile_service and client_id:
            try:
                profile = self.profile_service.get_or_create_profile(client_id) or {}
                primary_goal = profile.get("primary_goal")
                motivation_baseline = resolve_motivation_baseline(profile)
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

        checkin_response = self._coerce_checkin_response(record.get("checkin_response"))
        if checkin_response:
            return DailyCheckinResult(
                id=record["id"],
                date=parsed_date,
                score=record["total_score"],
                mode=mode,
                inputs=inputs,
                checkin_response=checkin_response,
                time_to_complete=record.get("time_to_complete"),
                completion_timestamp=parsed_completion_timestamp,
                primary_goal=primary_goal,
                yesterday_checkin_summary=self._build_yesterday_summary(yesterday_record),
            )

        return DailyCheckinResult(
            id=record["id"],
            date=parsed_date,
            score=record["total_score"],
            mode=mode,
            inputs=inputs,
            training=bundle["training"],
            nutrition=bundle["nutrition"],
            mindset=self._build_mindset_recommendation(mode, profile),
            time_to_complete=record.get("time_to_complete"),
            completion_timestamp=parsed_completion_timestamp,
            mode_tagline=bundle["tagline"],
            nutrition_tip=self._build_nutrition_tip(lowest_dimension, motivation_baseline),
            motivational_quote=self._build_motivational_quote(mode, motivation_baseline),
            primary_goal=primary_goal,
            yesterday_checkin_summary=self._build_yesterday_summary(yesterday_record),
        )

    def _coerce_checkin_response(self, value: Any) -> CheckinResponseOutput | None:
        if not isinstance(value, dict):
            return None
        try:
            response = CheckinResponseOutput(**value)
        except Exception as exc:
            logger.warning("Ignoring malformed persisted check-in response: %s", exc)
            return None
        return response if response.sections else None

    def _build_yesterday_summary(self, record: dict | None) -> YesterdayCheckinSummary | None:
        if not record:
            return None
        return YesterdayCheckinSummary(
            date=self._coerce_date(record["date"]),
            score=record["total_score"],
            mode=self._normalize_mode(record["assigned_mode"]),
            inputs=DailyCheckinInputs(**record["inputs"]),
        )

    def _calculate_current_streak(self, client_id: str, checkin_date: date) -> int:
        if not self.repository or not hasattr(self.repository, "list_checkin_dates_on_or_before"):
            return 0

        try:
            checkin_dates = self.repository.list_checkin_dates_on_or_before(client_id, checkin_date)
        except Exception as exc:
            logger.warning(
                "Daily check-in streak lookup failed for client_id=%s date=%s: %s",
                client_id,
                checkin_date,
                exc,
            )
            return 0

        streak = 0
        expected_date = checkin_date
        for completed_date in checkin_dates:
            if completed_date != expected_date:
                break
            streak += 1
            expected_date = expected_date.fromordinal(expected_date.toordinal() - 1)
        return streak

    def _coerce_date(self, value):
        if isinstance(value, str):
            return date.fromisoformat(value)
        return value

    def _calculate_streak_from_dates(self, completed_dates: set[date], as_of_date: date) -> int:
        streak = 0
        day_cursor = as_of_date
        while day_cursor in completed_dates:
            streak += 1
            day_cursor = day_cursor.fromordinal(day_cursor.toordinal() - 1)
        return streak

    def _window_scores(
        self,
        date_to_score: dict[date, float],
        *,
        as_of_date: date,
        window_days: int,
        offset_days: int,
    ) -> list[float]:
        end_date = as_of_date.fromordinal(as_of_date.toordinal() - offset_days)
        start_date = end_date.fromordinal(end_date.toordinal() - (window_days - 1))
        scores = []
        day_cursor = start_date
        while day_cursor <= end_date:
            score = date_to_score.get(day_cursor)
            if score is not None:
                scores.append(score)
            day_cursor = day_cursor.fromordinal(day_cursor.toordinal() + 1)
        return scores

    def _average(self, values: list[float]) -> float | None:
        if not values:
            return None
        return round(sum(values) / len(values), 2)

    def _round_for_change(self, value: float | None) -> float | None:
        if value is None:
            return None
        return float(round(value))

    def _get_lowest_dimension(self, inputs: DailyCheckinInputs) -> str:
        values = inputs.model_dump()
        return min(values, key=lambda key: values[key])

    def _build_nutrition_tip(self, dimension: str, motivation_baseline: str | None) -> str:
        goal_text = self._motivation_text(motivation_baseline)
        base_tip = LOWEST_DIMENSION_TIPS.get(dimension, LOWEST_DIMENSION_TIPS["nutrition"])
        return f"{base_tip} Keep it aligned with {goal_text}."

    def _build_motivational_quote(self, mode: str, motivation_baseline: str | None) -> str:
        quote = MODE_BUNDLES[mode]["quote"]
        goal_text = self._motivation_text(motivation_baseline)
        if goal_text:
            return f"{quote} Every smart choice still serves {goal_text}."
        return quote

    def _build_mindset_recommendation(self, mode: str, profile: dict[str, Any] | None) -> MindsetRecommendation:
        bundle_cue = MODE_BUNDLES[mode]["mindset"].cue
        payload = profile if isinstance(profile, dict) else {}
        return MindsetRecommendation(
            cue=build_mindset_why_cue(bundle_cue, payload.get("user_why")),
        )

    def _motivation_text(self, value: str | None) -> str:
        text = str(value or "").strip()
        if not text:
            return "your goal"
        return GOAL_LABELS.get(text, text)

    def _clean_text(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = re.sub(r"\s+", " ", value).strip()
        return normalized or None

    def _first_name(self, value: Any) -> str | None:
        text = self._clean_text(value)
        if not text:
            return None
        return text.split(" ", 1)[0].strip() or None

    def _clip_words(self, value: Any, limit: int) -> str:
        text = self._clean_text(value)
        if not text:
            return ""
        words = text.split()
        if len(words) <= limit:
            return text
        return " ".join(words[:limit])

    def _load_ai_usable_client_memory(
        self,
        *,
        trainer_id: str | None,
        client_id: str,
    ) -> list[dict[str, Any]]:
        if not trainer_id or not client_id or not hasattr(self.repository, "list_client_coach_memory"):
            return []
        try:
            rows = self.repository.list_client_coach_memory(
                trainer_id=trainer_id,
                client_id=client_id,
                limit=self.CLIENT_MEMORY_LIMIT * 2,
            )
        except Exception as exc:
            logger.warning(
                "Generate-plan coach memory lookup failed for trainer_id=%s client_id=%s: %s",
                trainer_id,
                client_id,
                exc,
            )
            return []
        return self._normalize_ai_usable_client_memory(rows)[: self.CLIENT_MEMORY_LIMIT]

    def _normalize_ai_usable_client_memory(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for row in rows or []:
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            if bool(value.get("is_archived")):
                continue
            visibility = str(value.get("visibility") or "internal_only").strip().lower()
            ai_usable = bool(value.get("ai_usable")) if isinstance(value.get("ai_usable"), bool) else visibility == "ai_usable"
            if not ai_usable:
                continue
            memory_key = str(row.get("memory_key") or "").strip()
            text = self._normalize_memory_text(value.get("text"))
            summary = self._normalize_memory_text(value.get("summary"))
            structured_data = value.get("structured_data") if isinstance(value.get("structured_data"), dict) else {}
            if not text and not summary and not memory_key and not structured_data:
                continue
            normalized.append(
                {
                    "memory_type": self._normalize_memory_type(row.get("memory_type")),
                    "memory_key": memory_key,
                    "text": text,
                    "summary": summary,
                    "tags": self._normalize_memory_tags(value.get("tags")),
                    "structured_data": structured_data,
                    "updated_at": str(row.get("updated_at") or "").strip() or None,
                }
            )
        return normalized

    def _normalize_memory_type(self, value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"note", "preference", "constraint"}:
            return normalized
        return "note"

    def _normalize_memory_text(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized[:500] if normalized else None

    def _normalize_memory_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        seen: set[str] = set()
        for item in value:
            tag = str(item or "").strip().lower()
            if not tag or tag in seen:
                continue
            seen.add(tag)
            tags.append(tag[:40])
        return tags

    def _client_memory_search_text(self, client_memory: list[dict[str, Any]]) -> str:
        parts: list[str] = []
        for memory in client_memory or []:
            for key in ("memory_type", "memory_key", "text", "summary"):
                value = memory.get(key)
                if value:
                    parts.append(str(value))
            tags = memory.get("tags")
            if isinstance(tags, list):
                parts.extend(str(tag) for tag in tags if tag)
            structured_data = memory.get("structured_data")
            if isinstance(structured_data, dict) and structured_data:
                parts.append(json.dumps(structured_data, sort_keys=True, default=str))
        return " ".join(parts).lower()

    def _contains_context_phrase(self, text: str, phrase: str) -> bool:
        normalized = phrase.strip().lower()
        if not normalized:
            return False
        if " " in normalized or "-" in normalized:
            return normalized in text
        return re.search(rf"\b{re.escape(normalized)}\b", text) is not None

    def _derive_nutrition_constraints(self, client_memory: list[dict[str, Any]] | None) -> dict[str, Any]:
        memory = client_memory or []
        text = self._client_memory_search_text(memory)
        excluded_terms: set[str] = set()
        diet_type = None
        if self._contains_context_phrase(text, "vegan") and "not vegan" not in text:
            diet_type = "vegan"
            excluded_terms.update(VEGAN_EXCLUDED_FOOD_TERMS)
        elif (
            self._contains_context_phrase(text, "vegetarian")
            and "not vegetarian" not in text
            and "not a vegetarian" not in text
        ):
            diet_type = "vegetarian"
            excluded_terms.update(VEGETARIAN_EXCLUDED_FOOD_TERMS)
        elif self._contains_context_phrase(text, "pescatarian") and "not pescatarian" not in text:
            diet_type = "pescatarian"
            excluded_terms.update(PESCATARIAN_EXCLUDED_FOOD_TERMS)

        for triggers, terms in COMMON_NUTRITION_RESTRICTIONS:
            if any(self._contains_context_phrase(text, trigger) for trigger in triggers):
                excluded_terms.update(terms)

        excluded_terms.update(self._structured_excluded_food_terms(memory))
        return {
            "diet_type": diet_type,
            "excluded_food_terms": sorted(term for term in excluded_terms if term),
            "memory_count": len(memory),
        }

    def _structured_excluded_food_terms(self, client_memory: list[dict[str, Any]]) -> set[str]:
        terms: set[str] = set()
        watched_key_parts = ("allerg", "avoid", "dislike", "exclude", "intoler")

        def visit(value: Any, *, key_hint: str = "") -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    next_hint = str(key or "").strip().lower()
                    visit(child, key_hint=next_hint)
                return
            if isinstance(value, list):
                for child in value:
                    visit(child, key_hint=key_hint)
                return
            if not any(part in key_hint for part in watched_key_parts):
                return
            normalized = str(value or "").strip().lower()
            for part in re.split(r"[,;/]", normalized):
                food_term = part.strip()
                if 1 <= len(food_term) <= 40:
                    terms.add(food_term)

        for memory in client_memory or []:
            structured_data = memory.get("structured_data")
            if isinstance(structured_data, dict):
                visit(structured_data)
        return terms

    def _derive_training_constraints(self, client_memory: list[dict[str, Any]] | None) -> dict[str, Any]:
        memory = client_memory or []
        text = self._client_memory_search_text(memory)
        blocked_terms: set[str] = set()
        matched_constraints: list[str] = []
        for triggers, terms in TRAINING_CONSTRAINT_RULES:
            matched_trigger = next((trigger for trigger in triggers if self._contains_context_phrase(text, trigger)), None)
            if not matched_trigger:
                continue
            matched_constraints.append(matched_trigger)
            blocked_terms.update(terms)

        blocked_terms.update(self._explicit_training_avoid_terms(memory))
        return {
            "matched_constraints": matched_constraints,
            "blocked_exercise_terms": sorted(term for term in blocked_terms if term),
            "memory_count": len(memory),
        }

    def _explicit_training_avoid_terms(self, client_memory: list[dict[str, Any]]) -> set[str]:
        terms: set[str] = set()
        watched_key_parts = ("avoid", "dislike", "exclude", "exercise", "movement", "restriction")

        def add_term(value: Any) -> None:
            normalized = str(value or "").strip().lower()
            if not normalized:
                return
            for part in re.split(r"[,;/]", normalized):
                term = re.split(r"\b(?:because|due to|during|for now|right now|until)\b", part, maxsplit=1)[0].strip()
                if 2 <= len(term) <= 40:
                    terms.add(term)

        def visit_structured(value: Any, *, key_hint: str = "") -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    visit_structured(child, key_hint=str(key or "").strip().lower())
                return
            if isinstance(value, list):
                for child in value:
                    visit_structured(child, key_hint=key_hint)
                return
            if any(part in key_hint for part in watched_key_parts):
                add_term(value)

        for memory in client_memory or []:
            for key in ("text", "summary", "memory_key"):
                source = str(memory.get(key) or "").lower()
                if not source:
                    continue
                for pattern in (
                    r"\b(?:avoid|avoids|dislike|dislikes|hate|hates|cannot do|can't do|do not do|don't do|no)\s+([a-z][a-z0-9 -]{1,40})",
                ):
                    for match in re.finditer(pattern, source):
                        add_term(match.group(1))
            structured_data = memory.get("structured_data")
            if isinstance(structured_data, dict):
                visit_structured(structured_data)
        return terms

    def _training_plan_constraint_violation(
        self,
        plan: StructuredTrainingPlan,
        constraints: dict[str, Any],
    ) -> str | None:
        blocked_terms = constraints.get("blocked_exercise_terms")
        if not isinstance(blocked_terms, list) or not blocked_terms:
            return None
        plan_text = self._training_plan_text(plan)
        for term in blocked_terms:
            normalized = str(term or "").strip().lower()
            if normalized and self._contains_blocked_term(plan_text, normalized):
                return normalized
        return None

    def _training_plan_text(self, plan: StructuredTrainingPlan) -> str:
        parts = [plan.title, plan.description, plan.coachNote]
        for item in [*plan.warmup, *plan.cooldown]:
            parts.extend([item.name, item.duration, item.description or ""])
        for exercise in plan.exercises:
            parts.extend([
                exercise.name,
                exercise.reps,
                exercise.rest,
                exercise.muscleGroup,
                exercise.description,
                exercise.coachTip,
            ])
        return " ".join(part for part in parts if part).lower()

    def _build_client_memory_hash(self, client_memory: list[dict[str, Any]] | None) -> str:
        payload = client_memory or []
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()

    def _contains_blocked_term(self, text: str, term: str) -> bool:
        normalized = term.strip().lower()
        if not normalized:
            return False
        if " " in normalized:
            return re.search(rf"\b{re.escape(normalized)}\b", text) is not None
        return re.search(rf"\b{re.escape(normalized)}s?\b", text) is not None

    def _nutrition_plan_constraint_violation(
        self,
        plan: StructuredNutritionPlan,
        constraints: dict[str, Any],
    ) -> str | None:
        excluded_terms = constraints.get("excluded_food_terms")
        if not isinstance(excluded_terms, list) or not excluded_terms:
            return None
        plan_text = self._nutrition_plan_text(plan)
        for term in excluded_terms:
            normalized = str(term or "").strip().lower()
            if normalized and self._contains_blocked_term(plan_text, normalized):
                return normalized
        return None

    def _nutrition_plan_text(self, plan: StructuredNutritionPlan) -> str:
        parts = [plan.title, plan.coachNote]
        for meal in plan.meals:
            parts.extend([meal.name, meal.timing, meal.notes or ""])
            for food in meal.foods:
                parts.extend([food.name, food.amount])
        return " ".join(part for part in parts if part).lower()

    def _generate_structured_plan(
        self,
        checkin: dict,
        profile: dict,
        request: GenerateCheckinPlanRequest,
        yesterday: dict | None,
        last_workout: dict | None,
        prior_variant: dict | None = None,
        client_memory: list[dict[str, Any]] | None = None,
    ):
        mode = self._normalize_mode(checkin["assigned_mode"])
        inputs = DailyCheckinInputs(**checkin["inputs"])
        prompt = self._build_generation_prompt(
            checkin=checkin,
            profile=profile,
            request=request,
            yesterday=yesterday,
            last_workout=last_workout,
            inputs=inputs,
            prior_variant=prior_variant,
            client_memory=client_memory,
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
        if (
            parsed is not None
            and request.plan_type == PlanType.TRAINING
            and prior_variant
            and self._plans_effectively_identical(parsed.model_dump(), prior_variant.get("structured_content"))
        ):
            retry_prompt = self._build_generation_prompt(
                checkin=checkin,
                profile=profile,
                request=request,
                yesterday=yesterday,
                last_workout=last_workout,
                inputs=inputs,
                prior_variant=prior_variant,
                require_delta=True,
                client_memory=client_memory,
            )
            try:
                retry_raw_text = self.llm_client.create_chat_completion(
                    model=GPT_5_4_MINI_MODEL,
                    messages=retry_prompt,
                )
                retried = self._parse_structured_json(retry_raw_text, parser)
                if retried is not None:
                    parsed = retried
            except Exception as exc:
                logger.warning("Post-check-in regeneration retry fell back to local template: %s", exc)
        if parsed is None:
            parsed = self._build_fallback_plan(
                plan_type=request.plan_type,
                mode=mode,
                inputs=inputs,
                request=request,
                profile=profile,
                last_workout=last_workout,
                client_memory=client_memory,
            )

        if request.plan_type == PlanType.TRAINING:
            constraints = self._derive_training_constraints(client_memory)
            violation = self._training_plan_constraint_violation(parsed, constraints)
            if violation:
                logger.warning(
                    "Generated workout violated client memory constraints checkin_id=%s violation=%s; using fallback",
                    request.checkin_id,
                    violation,
                )
                parsed = self._build_fallback_plan(
                    plan_type=request.plan_type,
                    mode=mode,
                    inputs=inputs,
                    request=request,
                    profile=profile,
                    last_workout=last_workout,
                    client_memory=client_memory,
                )
            if not parsed.coachNote.strip():
                parsed.coachNote = self._build_adaptive_note(
                    mode,
                    last_workout,
                    motivation_baseline=resolve_motivation_baseline(profile),
                )
        elif request.plan_type == PlanType.NUTRITION:
            constraints = self._derive_nutrition_constraints(client_memory)
            violation = self._nutrition_plan_constraint_violation(parsed, constraints)
            if violation:
                logger.warning(
                    "Generated nutrition plan violated client memory constraints checkin_id=%s violation=%s; using fallback",
                    request.checkin_id,
                    violation,
                )
                parsed = self._build_fallback_plan(
                    plan_type=request.plan_type,
                    mode=mode,
                    inputs=inputs,
                    request=request,
                    profile=profile,
                    last_workout=last_workout,
                    client_memory=client_memory,
                )
            if not parsed.coachNote.strip() or self._looks_like_training_note(parsed.coachNote):
                parsed.coachNote = self._build_nutrition_adaptive_note(
                    mode,
                    request,
                    inputs,
                    motivation_baseline=resolve_motivation_baseline(profile),
                )

        return {"structured_model": parsed}

    def _build_generation_prompt(
        self,
        checkin: dict,
        profile: dict,
        request: GenerateCheckinPlanRequest,
        yesterday: dict | None,
        last_workout: dict | None,
        inputs: DailyCheckinInputs,
        prior_variant: dict | None = None,
        require_delta: bool = False,
        client_memory: list[dict[str, Any]] | None = None,
    ):
        mode = self._normalize_mode(checkin["assigned_mode"])
        motivation_baseline = resolve_motivation_baseline(profile)
        adaptive_note = (
            self._build_nutrition_adaptive_note(
                mode,
                request,
                inputs,
                motivation_baseline=motivation_baseline,
            )
            if request.plan_type == PlanType.NUTRITION
            else self._build_adaptive_note(mode, last_workout, motivation_baseline=motivation_baseline)
        )
        schema_text = TRAINING_SCHEMA_TEXT if request.plan_type == PlanType.TRAINING else NUTRITION_SCHEMA_TEXT
        prompt_rules = ""
        if request.plan_type == PlanType.TRAINING:
            prompt_rules = (
                " Build a workout that treats the selected environment and exact time available as hard constraints. "
                "Saved client memory is authoritative: injuries, pain areas, movement restrictions, exercise dislikes, and equipment limits are hard constraints. "
                "Use motivation_baseline as the client's baseline reason for training and motivational framing. "
                "Avoid exercises and movement patterns that conflict with client_memory.training_constraints. "
                "Use warmup descriptions that explain the movement focus and why that block prepares the athlete for the main work. "
                "Make the exercise selection feel specific to the day's readiness, not like a generic template. "
                "Change block structure, exercise selection, and pacing when environment or time changes. "
                "Do not use emoji in any training-plan field."
            )
        elif request.plan_type == PlanType.NUTRITION:
            prompt_rules = (
                " Build nutrition coachNote as a readable, meal-focused sentence tied to today's readiness and nutrition context. "
                "Mention fuel, protein, hydration, meal timing, or simple food choices. "
                "Use motivation_baseline as the client's baseline reason for nutrition and motivational framing. "
                "Saved client memory is authoritative: diet type, allergies, dislikes, and saved preferences are hard constraints. "
                "If client memory says vegetarian, every meal and food must be vegetarian. If it says vegan, use plant-based foods only. "
                "Do not refer to workout load, session intensity, sets, reps, or progression in nutrition coachNote."
            )
        workout_context = self._build_workout_context(
            generated_plan_id=None,
            request=request,
            structured_plan=None,
        ) if request.plan_type == PlanType.TRAINING else None
        request_details = {
            "checkin_date": str(checkin["date"]),
            "mode": mode,
            "score": checkin["total_score"],
            "inputs": inputs.model_dump(),
            "why": motivation_baseline,
            "motivation_baseline": motivation_baseline,
            "user_why": profile.get("user_why"),
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
            "workout_context": workout_context,
        }
        if request.plan_type in {PlanType.TRAINING, PlanType.NUTRITION}:
            normalized_memory = client_memory or []
            request_details["client_memory"] = {
                "ai_usable": normalized_memory,
            }
            if request.plan_type == PlanType.TRAINING:
                request_details["client_memory"]["training_constraints"] = self._derive_training_constraints(normalized_memory)
            else:
                request_details["client_memory"]["nutrition_constraints"] = self._derive_nutrition_constraints(normalized_memory)
        if prior_variant:
            request_details["prior_variant"] = {
                "request_fingerprint": prior_variant.get("request_fingerprint"),
                "environment": prior_variant.get("environment"),
                "time_available": prior_variant.get("time_available"),
                "structured_content": prior_variant.get("structured_content"),
            }
        delta_instruction = ""
        if require_delta and prior_variant and request.plan_type == PlanType.TRAINING:
            delta_instruction = (
                " The prior variant is too similar. You must produce a meaningfully different workout for this environment/time pair. "
                "Change at least the warmup focus, the first exercise, and the overall duration structure."
            )
        return [
            {
                "role": "system",
                "content": (
                    f"You are Coach {MODE_BUNDLES[mode]['coach']} writing a {request.plan_type.value} plan for MODE. "
                    "Respond with strict JSON only, no markdown fences, and ensure coachNote is personalized around motivation_baseline."
                    f"{prompt_rules}{delta_instruction}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Build a {request.plan_type.value} plan using this context:\n"
                    f"{json.dumps(request_details)}\n"
                    "Treat motivation_baseline as the client's baseline why and use it to drive motivation factors without over-repeating it.\n"
                    "If this is a training plan, make the warmup specific and descriptive, make the main work match the selected environment and time cap, keep every field emoji-free, and apply client_memory.ai_usable plus training_constraints as hard constraints for injuries, pain areas, movement restrictions, exercise dislikes, and equipment limits.\n"
                    "If this is a nutrition plan, keep coachNote practical, human-readable, and focused on meals, fuel, protein, and hydration rather than workout mechanics. Apply client_memory.ai_usable as hard constraints and never include foods that violate saved dietary preferences, allergies, dislikes, or restrictions.\n"
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
        except Exception as exc:
            preview = cleaned.strip().replace("\n", " ")[:240]
            logger.warning(
                "Post-check-in generation returned invalid structured JSON parser=%s error=%s preview=%r",
                getattr(parser, "__name__", str(parser)),
                exc,
                preview,
            )
            return None

    def _build_request_fingerprint(
        self,
        request: GenerateCheckinPlanRequest,
        *,
        client_memory: list[dict[str, Any]] | None = None,
        motivation_baseline: str | None = None,
    ) -> str:
        payload = {
            "checkin_id": request.checkin_id,
            "plan_type": request.plan_type.value,
            "environment": request.environment.value if request.environment else None,
            "time_available": request.time_available,
            "nutrition_day_note": request.nutrition_day_note.strip() if request.nutrition_day_note else None,
            "include_yesterday_context": bool(request.include_yesterday_context),
        }
        if request.plan_type in {PlanType.TRAINING, PlanType.NUTRITION}:
            payload["client_memory_hash"] = self._build_client_memory_hash(client_memory)
            payload["motivation_baseline"] = str(motivation_baseline or "").strip() or None
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()

    def _build_generate_plan_response(
        self,
        request: GenerateCheckinPlanRequest,
        saved_record: dict[str, Any],
    ) -> GenerateCheckinPlanResponse:
        structured = saved_record.get("structured_content") or {}
        raw_content = saved_record.get("raw_content")
        if not isinstance(raw_content, str):
            raw_content = json.dumps(structured)
        workout_context = None
        if request.plan_type == PlanType.TRAINING:
            workout_context = self._build_workout_context(
                generated_plan_id=saved_record.get("id"),
                request=request,
                structured_plan=structured,
                request_fingerprint=saved_record.get("request_fingerprint"),
                revision_number=saved_record.get("revision_number"),
            )
        return GenerateCheckinPlanResponse(
            plan_id=saved_record["id"],
            plan_type=request.plan_type,
            content=raw_content,
            structured=structured,
            request_fingerprint=saved_record.get("request_fingerprint"),
            revision_number=saved_record.get("revision_number"),
            workout_context=workout_context,
        )

    def _build_workout_context(
        self,
        generated_plan_id: str | None,
        request: GenerateCheckinPlanRequest,
        structured_plan: dict[str, Any] | None,
        request_fingerprint: str | None = None,
        revision_number: int | None = None,
    ) -> dict[str, Any]:
        return {
            "generated_plan_id": generated_plan_id,
            "request_fingerprint": request_fingerprint,
            "revision_number": revision_number,
            "environment": request.environment.value if request.environment else None,
            "time_available": request.time_available,
            "plan_title": structured_plan.get("title") if isinstance(structured_plan, dict) else None,
            "plan_summary": self._build_workout_summary(structured_plan),
        }

    def _build_workout_summary(self, structured_plan: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(structured_plan, dict):
            return {}
        return {
            "title": structured_plan.get("title"),
            "type": structured_plan.get("type"),
            "difficulty": structured_plan.get("difficulty"),
            "duration_minutes": structured_plan.get("durationMinutes"),
            "warmup": [
                {
                    "name": item.get("name"),
                    "duration": item.get("duration"),
                    "description": item.get("description"),
                }
                for item in structured_plan.get("warmup", []) if isinstance(item, dict)
            ],
            "exercises": [
                {
                    "name": item.get("name"),
                    "sets": item.get("sets"),
                    "reps": item.get("reps"),
                    "rest": item.get("rest"),
                    "muscle_group": item.get("muscleGroup"),
                    "description": item.get("description"),
                    "coach_tip": item.get("coachTip"),
                }
                for item in structured_plan.get("exercises", []) if isinstance(item, dict)
            ],
            "cooldown": [
                {
                    "name": item.get("name"),
                    "duration": item.get("duration"),
                    "description": item.get("description"),
                }
                for item in structured_plan.get("cooldown", []) if isinstance(item, dict)
            ],
            "coach_note": structured_plan.get("coachNote"),
        }

    def _plans_effectively_identical(self, current: dict[str, Any] | None, previous: dict[str, Any] | None) -> bool:
        return self._normalize_plan_signature(current) == self._normalize_plan_signature(previous)

    def _normalize_plan_signature(self, plan: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(plan, dict):
            return {}
        return {
            "type": plan.get("type"),
            "durationMinutes": plan.get("durationMinutes"),
            "warmup_names": [item.get("name") for item in plan.get("warmup", []) if isinstance(item, dict)],
            "exercise_names": [item.get("name") for item in plan.get("exercises", []) if isinstance(item, dict)],
            "exercise_reps": [item.get("reps") for item in plan.get("exercises", []) if isinstance(item, dict)],
            "exercise_sets": [item.get("sets") for item in plan.get("exercises", []) if isinstance(item, dict)],
        }

    def _build_fallback_plan(
        self,
        plan_type: PlanType,
        mode: str,
        inputs: DailyCheckinInputs,
        request: GenerateCheckinPlanRequest,
        profile: dict,
        last_workout: dict | None,
        client_memory: list[dict[str, Any]] | None = None,
    ):
        motivation_baseline = resolve_motivation_baseline(profile)
        if plan_type == PlanType.TRAINING:
            duration = request.time_available or profile.get("preferred_session_length") or 30
            difficulty = "advanced" if inputs.motivation >= 4 and inputs.sleep >= 4 else "intermediate"
            training_constraints = self._derive_training_constraints(client_memory)
            has_training_constraints = bool(training_constraints.get("blocked_exercise_terms"))
            workout_type = "mobility" if has_training_constraints and mode in {"REST", "RECOVER"} else self._fallback_workout_type(mode, request.environment)
            title, description = self._fallback_training_framing(mode, request.environment, duration)
            warmup = (
                self._fallback_warmup_for_constraints(training_constraints)
                if has_training_constraints
                else self._fallback_warmup(request.environment, workout_type)
            )
            exercises = (
                self._fallback_training_exercises_for_constraints(training_constraints, duration)
                if has_training_constraints
                else self._fallback_training_exercises(request.environment, duration, mode)
            )
            cooldown = self._fallback_cooldown(request.environment)
            return StructuredTrainingPlan(
                title=title,
                type=workout_type,
                difficulty=difficulty,
                durationMinutes=duration,
                description=description,
                warmup=warmup,
                exercises=exercises,
                cooldown=cooldown,
                coachNote=self._build_adaptive_note(
                    mode,
                    last_workout,
                    motivation_baseline=motivation_baseline,
                ),
            )

        meals = self._build_fallback_nutrition_meals(request, client_memory)
        return StructuredNutritionPlan(
            title=f"{mode.title()} Mode Fuel Plan",
            totalCalories=sum(meal["totalCalories"] for meal in meals),
            totalProtein=sum(meal["totalProtein"] for meal in meals),
            meals=meals,
            coachNote=self._build_nutrition_adaptive_note(
                mode,
                request,
                inputs,
                motivation_baseline=motivation_baseline,
            ),
        )

    def _build_fallback_nutrition_meals(
        self,
        request: GenerateCheckinPlanRequest,
        client_memory: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        constraints = self._derive_nutrition_constraints(client_memory)
        excluded_terms = set(constraints.get("excluded_food_terms") or [])
        constrained = bool(excluded_terms or constraints.get("diet_type"))
        dairy_limited = bool({"cheese", "greek yogurt", "milk", "whey", "yogurt"}.intersection(excluded_terms))
        gluten_limited = bool({"bread", "flour", "gluten", "oats", "pasta", "wheat"}.intersection(excluded_terms))

        if constrained:
            breakfast_foods = (
                [
                    {"name": "Rice porridge", "amount": "1 bowl", "calories": 300, "protein": 6},
                    {"name": "Pea protein", "amount": "1 scoop", "calories": 120, "protein": 24},
                    {"name": "Berries", "amount": "1 cup", "calories": 70, "protein": 1},
                ]
                if dairy_limited or gluten_limited or constraints.get("diet_type") == "vegan"
                else [
                    {"name": "Greek yogurt", "amount": "1 bowl", "calories": 220, "protein": 25},
                    {"name": "Berries", "amount": "1 cup", "calories": 70, "protein": 1},
                ]
            )
            breakfast_calories = sum(food["calories"] for food in breakfast_foods)
            breakfast_protein = sum(food["protein"] for food in breakfast_foods)
            return [
                {
                    "name": "Breakfast",
                    "timing": "Morning",
                    "emoji": "",
                    "foods": breakfast_foods,
                    "totalCalories": breakfast_calories,
                    "totalProtein": breakfast_protein,
                    "notes": "Start with a simple protein anchor that respects saved food preferences.",
                },
                {
                    "name": "Lunch",
                    "timing": "Midday",
                    "emoji": "",
                    "foods": [
                        {"name": "Lentil quinoa bowl", "amount": "1 serving", "calories": 520, "protein": 28},
                        {"name": "Fruit", "amount": "1 piece", "calories": 90, "protein": 1},
                    ],
                    "totalCalories": 610,
                    "totalProtein": 29,
                    "notes": request.nutrition_day_note or "Keep lunch balanced, repeatable, and aligned with saved constraints.",
                },
                {
                    "name": "Dinner",
                    "timing": "Evening",
                    "emoji": "",
                    "foods": [
                        {"name": "Chickpea rice plate", "amount": "1 plate", "calories": 560, "protein": 24},
                        {"name": "Vegetables", "amount": "2 cups", "calories": 120, "protein": 6},
                    ],
                    "totalCalories": 680,
                    "totalProtein": 30,
                    "notes": "End the day with steady carbs, plants, and protein without violating saved preferences.",
                },
            ]

        return [
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

    def _fallback_warmup_for_constraints(self, constraints: dict[str, Any]) -> list[dict]:
        matched = constraints.get("matched_constraints")
        matched_text = ", ".join(matched) if isinstance(matched, list) and matched else "saved constraints"
        return [
            {
                "name": "Breathing and range scan",
                "duration": "3 min",
                "description": f"Check today's comfort against {matched_text} and keep every movement inside a pain-free range.",
            },
            {
                "name": "Low-impact activation",
                "duration": "4 min",
                "description": "Use slow controlled joint circles, bracing, and unloaded movement to prepare without testing restricted patterns.",
            },
        ]

    def _fallback_training_exercises_for_constraints(
        self,
        constraints: dict[str, Any],
        duration: int,
    ) -> list[dict]:
        short_session = duration <= 10
        candidate_sets = 1 if short_session else 2
        candidates = [
            {
                "name": "Seated breathing reset",
                "sets": candidate_sets,
                "reps": "5 breaths",
                "rest": "20 sec",
                "muscleGroup": "recovery",
                "description": "Sit tall, keep ribs stacked, and use slow exhales to downshift before controlled work.",
                "coachTip": "Stop and adjust if any saved restriction starts to feel irritated.",
            },
            {
                "name": "Dead bug heel tap",
                "sets": candidate_sets,
                "reps": "6 / side",
                "rest": "30 sec",
                "muscleGroup": "core",
                "description": "Brace gently and alternate heel taps while keeping the range small and controlled.",
                "coachTip": "Move slowly enough that your trunk stays quiet throughout the set.",
            },
            {
                "name": "Side-lying hip abduction",
                "sets": candidate_sets,
                "reps": "8 / side",
                "rest": "30 sec",
                "muscleGroup": "hips",
                "description": "Lift from the side hip with a short smooth range and no momentum.",
                "coachTip": "Keep this easy and controlled rather than chasing fatigue.",
            },
            {
                "name": "Standing band row",
                "sets": candidate_sets,
                "reps": "10-12",
                "rest": "30 sec",
                "muscleGroup": "back",
                "description": "Use light band tension and pull with smooth control while staying tall.",
                "coachTip": "Keep the range comfortable and avoid any position that bothers a saved restriction.",
            },
            {
                "name": "Anti-rotation hold",
                "sets": candidate_sets,
                "reps": "15 sec / side",
                "rest": "30 sec",
                "muscleGroup": "core",
                "description": "Hold a stable torso against light band tension without twisting or bracing hard.",
                "coachTip": "Make this feel steady and clean, not maximal.",
            },
        ]
        filtered = [
            exercise
            for exercise in candidates
            if not self._exercise_violates_training_constraints(exercise, constraints)
        ]
        if len(filtered) >= 3:
            return filtered[:3]
        fallback = [
            {
                "name": "Comfort-limited mobility",
                "sets": 2,
                "reps": "45 sec",
                "rest": "30 sec",
                "muscleGroup": "mobility",
                "description": "Move only through ranges that feel clear today and skip any restricted pattern.",
                "coachTip": "The win is staying within the constraint, not forcing output.",
            },
            {
                "name": "Easy core brace",
                "sets": 2,
                "reps": "6 breaths",
                "rest": "30 sec",
                "muscleGroup": "core",
                "description": "Brace lightly while breathing slowly and keeping the body relaxed.",
                "coachTip": "Keep the effort low enough that form never changes.",
            },
            {
                "name": "Controlled balance hold",
                "sets": 2,
                "reps": "20 sec",
                "rest": "30 sec",
                "muscleGroup": "stability",
                "description": "Use support as needed and hold a stable, comfortable position.",
                "coachTip": "Choose the setup that feels safest for today's restriction.",
            },
        ]
        return fallback

    def _exercise_violates_training_constraints(self, exercise: dict[str, Any], constraints: dict[str, Any]) -> bool:
        blocked_terms = constraints.get("blocked_exercise_terms")
        if not isinstance(blocked_terms, list) or not blocked_terms:
            return False
        exercise_text = " ".join(str(value or "") for value in exercise.values()).lower()
        return any(self._contains_blocked_term(exercise_text, str(term or "")) for term in blocked_terms)

    def _fallback_workout_type(self, mode: str, environment: Environment | None) -> str:
        if environment == Environment.OUTDOORS:
            return "cardio"
        if environment == Environment.HOTEL_ROOM:
            return "mobility" if mode == "REST" else "general"
        if environment == Environment.BODYWEIGHT:
            return "hiit" if mode == "BEAST" else "general"
        if environment == Environment.LIMITED:
            return "mobility" if mode in {"REST", "RECOVER"} else "general"
        if mode == "REST":
            return "mobility"
        if environment in {Environment.HOME_GYM, Environment.FULL_GYM}:
            return "strength" if mode in {"BEAST", "BUILD"} else "general"
        return "general"

    def _fallback_training_framing(self, mode: str, environment: Environment | None, duration: int) -> tuple[str, str]:
        environment_label = environment.value.replace("_", " ") if environment else "your setup"
        if duration <= 10:
            focus = "a true sprint session that trims the plan down to the highest-value work only"
        elif duration <= 30:
            focus = "a balanced session with a quick warmup, focused work, and no filler volume"
        else:
            focus = "a fuller session with room for layered prep, focused work, and a cleaner finish"
        return (
            f"{mode.title()} Mode {MODE_BUNDLES[mode]['coach']} {environment_label.title()} Session",
            f"A {duration}-minute {focus}, tailored for {environment_label} on your {mode} day.",
        )

    def _fallback_warmup(self, environment: Environment | None, workout_type: str) -> list[dict]:
        if environment == Environment.OUTDOORS:
            return [
                {"name": "Brisk ramp-up walk", "duration": "3 min", "description": "Build body heat gradually and loosen ankles, hips, and shoulders before faster outdoor movement."},
                {"name": "Dynamic stride prep", "duration": "4 min", "description": "Use skips, leg swings, and marching drills to open your stride and prepare for repeat efforts."},
            ]
        if environment == Environment.HOTEL_ROOM:
            return [
                {"name": "Travel reset flow", "duration": "3 min", "description": "Undo stiffness from sitting with ankle, hip, and thoracic mobility before you ask for output."},
                {"name": "Room-ready activation", "duration": "3 min", "description": "Use low-impact squats, wall presses, and core bracing to prep a compact hotel-room session."},
            ]
        if environment == Environment.BODYWEIGHT:
            return [
                {"name": "Joint prep flow", "duration": "3 min", "description": "Move through wrists, shoulders, hips, and ankles so your bodyweight reps feel smooth instead of sticky."},
                {"name": "Pattern primer", "duration": "4 min", "description": "Use squats, hinges, and plank-based activation to wake up the exact patterns used in the main circuit."},
            ]
        if environment == Environment.LIMITED:
            return [
                {"name": "Constraint scan", "duration": "2 min", "description": "Check the space, tools, and footing so the session matches what you actually have available."},
                {"name": "Minimal-kit rehearsal", "duration": "4 min", "description": "Practice the exact hinge, squat, and press patterns you can train safely with limited gear."},
            ]
        if environment == Environment.HOME_GYM:
            return [
                {"name": "Garage reset", "duration": "3 min", "description": "Raise body temperature and loosen the hips and shoulders so home-gym loading feels crisp fast."},
                {"name": "Load path rehearsal", "duration": "4 min", "description": "Rehearse the key positions for the squat, push, and hinge paths you will use with dumbbells or a bar at home."},
            ]
        if workout_type == "strength":
            return [
                {"name": "Dynamic reset", "duration": "3 min", "description": "Raise body temperature while opening hips, t-spine, and shoulders so loaded reps feel crisp from set one."},
                {"name": "Lift pattern prep", "duration": "4 min", "description": "Prime the squat, push, and hinge patterns with controlled reps before you load them under fatigue."},
            ]
        return [
            {"name": "Mobility reset", "duration": "3 min", "description": "Ease stiffness out of the joints and get your breathing under control before the main work starts."},
            {"name": "Movement rehearsal", "duration": "4 min", "description": "Rehearse the key positions you will use so the session starts smooth instead of rushed."},
        ]

    def _fallback_training_exercises(self, environment: Environment | None, duration: int, mode: str) -> list[dict]:
        short_session = duration <= 10
        medium_session = 10 < duration <= 30
        if environment == Environment.OUTDOORS:
            return [
                {"name": "Power walk or light jog intervals", "sets": 3 if short_session else 4 if medium_session else 5, "reps": "90 sec" if short_session else "2 min", "rest": "30 sec" if short_session else "45 sec", "muscleGroup": "conditioning", "description": "Stay tall, keep the pace honest, and use the recoveries to reset your breathing.", "coachTip": "Work at a pace you can repeat cleanly, not one that burns you out in round one."},
                {"name": "Bench or curb step-up", "sets": 2 if short_session else 3, "reps": "8 / side" if short_session else "10 / side", "rest": "45 sec", "muscleGroup": "legs", "description": "Drive through the whole foot and control the lowering so each rep builds stability.", "coachTip": "Choose a height that lets you stay balanced instead of muscling through sloppy reps."},
                {"name": "Incline push-up", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "8-12", "rest": "45 sec", "muscleGroup": "chest", "description": "Use a park bench or sturdy surface and keep your body in one straight line.", "coachTip": "Elevate your hands more if you want smoother reps and better tempo control."},
            ]
        if environment == Environment.HOTEL_ROOM:
            return [
                {"name": "Suitcase squat", "sets": 2 if short_session else 3, "reps": "10-12", "rest": "30 sec", "muscleGroup": "legs", "description": "Use a backpack or suitcase if you have one, and keep the squat compact and clean.", "coachTip": "If you have no load, slow the lowering and pause at the bottom."},
                {"name": "Bed-edge incline push-up", "sets": 2 if short_session else 3, "reps": "8-12", "rest": "30 sec", "muscleGroup": "chest", "description": "Use a stable elevated surface so hotel-room constraints still let you get quality pressing work.", "coachTip": "Choose the edge height that keeps every rep smooth and controlled."},
                {"name": "Split squat iso hold", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "20 sec / side", "rest": "30 sec", "muscleGroup": "legs", "description": "Hold the hardest position you can own to create leg tension without extra equipment.", "coachTip": "Stay tall and keep your front foot flat instead of rushing the hold."},
            ]
        if environment == Environment.BODYWEIGHT:
            return [
                {"name": "Tempo squat", "sets": 2 if short_session else 3, "reps": "10-12", "rest": "30 sec", "muscleGroup": "legs", "description": "Use a slow lowering phase and a clean stand to make bodyweight reps feel productive.", "coachTip": "If today feels heavy, shorten the range slightly and keep the tempo controlled."},
                {"name": "Push-up variation", "sets": 2 if short_session else 3, "reps": "6-12", "rest": "30 sec", "muscleGroup": "chest", "description": "Choose floor, incline, or hands-elevated reps that let you move with clean form.", "coachTip": "Quality beats pride here. Pick the version you can repeat without grinding."},
                {"name": "Reverse lunge to knee drive", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "8 / side", "rest": "30 sec", "muscleGroup": "legs", "description": "Stay balanced as you drive back to standing so the set trains coordination as well as legs.", "coachTip": "Own the landing and balance before you speed anything up."},
            ]
        if environment == Environment.LIMITED:
            return [
                {"name": "Loaded hinge with available gear", "sets": 2 if short_session else 3, "reps": "8-10", "rest": "45 sec", "muscleGroup": "posterior chain", "description": "Use the heaviest safe item you have and keep the hinge pattern crisp and repeatable.", "coachTip": "If the implement is awkward, cut the range a touch and keep your back position locked in."},
                {"name": "Single-arm floor press", "sets": 2 if short_session else 3, "reps": "8 / side", "rest": "45 sec", "muscleGroup": "chest", "description": "Press one side at a time with whatever implement you have available and keep your ribcage down.", "coachTip": "Use the off arm on the floor to stay stable instead of twisting through the rep."},
                {"name": "Front-foot elevated split squat", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "8 / side", "rest": "45 sec", "muscleGroup": "legs", "description": "Use a book, plate, or low step to make limited loading feel more demanding.", "coachTip": "Drive straight up through the front leg and avoid bouncing out of the bottom."},
            ]
        if environment == Environment.HOME_GYM:
            return [
                {"name": "Goblet squat", "sets": 2 if short_session else 3 if medium_session else 4, "reps": "8-10", "rest": "60 sec", "muscleGroup": "legs", "description": "Brace before each rep and own the lowering phase so your legs do the work instead of your back.", "coachTip": "Leave a rep in reserve unless today truly feels like a green-light session."},
                {"name": "Dumbbell floor or bench press", "sets": 2 if short_session else 3, "reps": "8-10", "rest": "60 sec", "muscleGroup": "chest", "description": "Press with control and keep your shoulders packed so each set stays smooth.", "coachTip": "If the last workout felt hard, hold the same load and clean up the reps instead of forcing more."},
                {"name": "Romanian deadlift", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "8-10", "rest": "60 sec", "muscleGroup": "posterior chain", "description": "Push the hips back, keep the lats tight, and stop where your hamstrings stay loaded.", "coachTip": "Think long spine and soft knees rather than chasing extra depth."},
            ]
        return [
            {"name": "Front squat or leg press", "sets": 2 if short_session else 3 if medium_session else 4, "reps": "6-8", "rest": "75 sec", "muscleGroup": "legs", "description": "Use a controlled descent and drive up with intent while keeping tension through the trunk.", "coachTip": "Strong reps matter more than load jumps unless today feels exceptionally sharp."},
            {"name": "Machine or dumbbell press", "sets": 2 if short_session else 3, "reps": "8-10", "rest": "60 sec", "muscleGroup": "chest", "description": "Keep the path smooth and avoid bouncing between reps so the set stays muscular instead of chaotic.", "coachTip": "Use the machine path to stay precise if energy is good but recovery is mixed."},
            {"name": "Cable or chest-supported row", "sets": 1 if short_session else 2 if medium_session else 3, "reps": "10-12", "rest": "60 sec", "muscleGroup": "back", "description": "Pull through the elbows and pause briefly at the finish to own the upper-back work.", "coachTip": "Let the shoulder blades move naturally, then finish each rep by squeezing the mid-back."},
        ]

    def _fallback_cooldown(self, environment: Environment | None) -> list[dict]:
        if environment == Environment.OUTDOORS:
            return [
                {"name": "Easy walk", "duration": "2 min", "description": "Bring your breathing down gradually before you fully stop moving."},
                {"name": "Standing reset breathing", "duration": "2 min", "description": "Use long exhales to settle heart rate and leave the session feeling more recovered than rushed."},
            ]
        if environment == Environment.HOTEL_ROOM:
            return [
                {"name": "Wall-supported breathing", "duration": "2 min", "description": "Settle your ribs and breathing so you leave the room feeling reset rather than wired."},
                {"name": "Hip flexor release", "duration": "2 min", "description": "Offset travel stiffness with a quick front-of-hip downshift."},
            ]
        return [
            {"name": "Easy downshift", "duration": "2 min", "description": "Use light movement to bring your heart rate down instead of stopping cold."},
            {"name": "Breathing reset", "duration": "2 min", "description": "Finish with slow exhales and relaxed shoulders so your body shifts out of go-mode cleanly."},
        ]

    def _motivation_clause(self, motivation_baseline: str | None) -> str:
        text = self._motivation_text(motivation_baseline).rstrip(".")
        if not text:
            return ""
        return f" Keep it connected to {text}."

    def _build_adaptive_note(
        self,
        mode: str,
        last_workout: dict | None,
        *,
        motivation_baseline: str | None = None,
    ) -> str:
        motivation_clause = self._motivation_clause(motivation_baseline)
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
                    f"still keeping momentum.{motivation_clause}"
                )
            if feel_rating == 3:
                return (
                    f"Your last session felt {feel_label}, so today's plan keeps the load balanced and repeatable without "
                    f"spiking fatigue.{motivation_clause}"
                )
            return (
                f"Your last session felt {feel_label}, so today's plan nudges intensity up with controlled progression."
                f"{motivation_clause}"
            )

        last_title = last_workout.get("title") if isinstance(last_workout, dict) else None
        if last_title:
            return (
                f"Your last logged session was '{last_title}', so today's {mode.lower()} plan keeps the effort "
                f"targeted and sustainable.{motivation_clause}"
            )
        return (
            f"Coach {MODE_BUNDLES[mode]['coach']} tuned this {mode.lower()} plan to match today's readiness "
            f"instead of forcing a generic template.{motivation_clause}"
        )

    def _build_nutrition_adaptive_note(
        self,
        mode: str,
        request: GenerateCheckinPlanRequest | None = None,
        inputs: DailyCheckinInputs | None = None,
        *,
        motivation_baseline: str | None = None,
    ) -> str:
        motivation_clause = self._motivation_clause(motivation_baseline)
        note = request.nutrition_day_note.strip() if request and request.nutrition_day_note else ""
        if note:
            return (
                f"Use today's note as the anchor: {note}. Keep meals protein-forward, hydrated, "
                f"and easy to follow from the first meal through dinner.{motivation_clause}"
            )

        nutrition_score = inputs.nutrition if inputs else None
        if isinstance(nutrition_score, int) and nutrition_score <= 2:
            return (
                "Keep food simple today: protein at each meal, steady fluids, and easy carbs that help energy "
                f"feel more predictable.{motivation_clause}"
            )

        mode_notes = {
            "BEAST": "Use this as a high-readiness fuel day: get protein in early, place carbs near training, and keep fluids steady.",
            "BUILD": "Use steady meals today: anchor protein at each meal, add balanced carbs, and keep hydration visible.",
            "RECOVER": "Keep recovery easy to execute today: steady protein, simple whole-food meals, and fluids before extra caffeine.",
            "REST": "Treat this as recovery support: protein, colorful plants, and fluids without overcomplicating the day.",
        }
        return f"{mode_notes.get(mode, mode_notes['RECOVER'])}{motivation_clause}"

    @staticmethod
    def _looks_like_training_note(value: str) -> bool:
        text = str(value or "").lower()
        if not text:
            return False
        blocked_terms = (
            "workout",
            "session",
            "load",
            "intensity",
            "sets",
            "reps",
            "progression",
            "exercise",
        )
        return any(term in text for term in blocked_terms)


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
