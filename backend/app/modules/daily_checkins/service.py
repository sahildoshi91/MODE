import json
import hashlib
import logging
from datetime import date, datetime, timezone
from typing import Any

from app.modules.daily_checkins.repository import DailyCheckinRepository, DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
    CheckinProgressResponse,
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
    ProgressRecentCheckin,
    ScoreWindowChange,
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
            return DailyCheckinStatusResponse(date=checkin_date, completed=False, current_streak=0)

        return DailyCheckinStatusResponse(
            date=checkin_date,
            completed=True,
            current_streak=self._calculate_current_streak(client_id, checkin_date),
            checkin=self._build_result(record),
        )

    def get_previous_checkin_summary(self, client_id: str, before_date: date):
        record = self.repository.get_previous_checkin(client_id, before_date)
        return self._build_yesterday_summary(record)

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
        if request.plan_type == PlanType.TRAINING and request.time_available is None:
            raise ValueError("Training plan generation requires time available")
        if request.plan_type == PlanType.NUTRITION and request.nutrition_day_note is not None and not request.nutrition_day_note.strip():
            raise ValueError("Nutrition day note must not be empty")

        request_fingerprint = self._build_request_fingerprint(request)
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

    def _generate_structured_plan(
        self,
        checkin: dict,
        profile: dict,
        request: GenerateCheckinPlanRequest,
        yesterday: dict | None,
        last_workout: dict | None,
        prior_variant: dict | None = None,
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
            )

        if not parsed.coachNote.strip():
            parsed.coachNote = self._build_adaptive_note(mode, last_workout)

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
    ):
        mode = self._normalize_mode(checkin["assigned_mode"])
        why = profile.get("primary_goal") or "general fitness"
        adaptive_note = self._build_adaptive_note(mode, last_workout)
        schema_text = TRAINING_SCHEMA_TEXT if request.plan_type == PlanType.TRAINING else NUTRITION_SCHEMA_TEXT
        training_prompt_rules = ""
        if request.plan_type == PlanType.TRAINING:
            training_prompt_rules = (
                " Build a workout that treats the selected environment and exact time available as hard constraints. "
                "Use warmup descriptions that explain the movement focus and why that block prepares the athlete for the main work. "
                "Make the exercise selection feel specific to the day's readiness, not like a generic template. "
                "Change block structure, exercise selection, and pacing when environment or time changes. "
                "Do not use emoji in any training-plan field."
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
            "workout_context": workout_context,
        }
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
                    "Respond with strict JSON only, no markdown fences, and ensure coachNote is personalized."
                    f"{training_prompt_rules}{delta_instruction}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Build a {request.plan_type.value} plan using this context:\n"
                    f"{json.dumps(request_details)}\n"
                    "If this is a training plan, make the warmup specific and descriptive, make the main work match the selected environment and time cap, and keep every field emoji-free.\n"
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

    def _build_request_fingerprint(self, request: GenerateCheckinPlanRequest) -> str:
        payload = {
            "checkin_id": request.checkin_id,
            "plan_type": request.plan_type.value,
            "environment": request.environment.value if request.environment else None,
            "time_available": request.time_available,
            "nutrition_day_note": request.nutrition_day_note.strip() if request.nutrition_day_note else None,
            "include_yesterday_context": bool(request.include_yesterday_context),
        }
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

    def _build_fallback_plan(self, plan_type: PlanType, mode: str, inputs: DailyCheckinInputs, request: GenerateCheckinPlanRequest, profile: dict, last_workout: dict | None):
        if plan_type == PlanType.TRAINING:
            duration = request.time_available or profile.get("preferred_session_length") or 30
            difficulty = "advanced" if inputs.motivation >= 4 and inputs.sleep >= 4 else "intermediate"
            workout_type = self._fallback_workout_type(mode, request.environment)
            title, description = self._fallback_training_framing(mode, request.environment, duration)
            warmup = self._fallback_warmup(request.environment, workout_type)
            exercises = self._fallback_training_exercises(request.environment, duration, mode)
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
