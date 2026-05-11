from datetime import datetime, timezone
from typing import Any

from app.modules.profile.repository import ProfileRepository
from app.modules.profile.schemas import (
    AlgorithmHomeResponse,
    AlgorithmMemoryCreateRequest,
    AlgorithmMemoryRecord,
    AlgorithmMemoryUpdateRequest,
    FitnessProfile,
)
from app.modules.motivation import clean_motivation_text


ALGORITHM_LEARNING_FALLBACK = (
    "MODE is still learning what drives you. Add your Why to personalize your coaching."
)
PROFILE_ALGORITHM_STORAGE_UNAVAILABLE_DETAIL = (
    "Your Why storage is not available yet. Apply backend/sql/20260504b_your_mode_algorithm_home.sql "
    "and retry."
)
PROFILE_WHY_VERIFICATION_FAILED_DETAIL = "Your Why could not be verified after saving. Please retry."
PROFILE_MEMORY_VERIFICATION_FAILED_DETAIL = "Memory could not be verified after saving. Please retry."
PROFILE_MEMORY_DELETE_VERIFICATION_FAILED_DETAIL = "Memory could not be verified after deleting. Please retry."
SUMMARY_WORD_LIMIT = 30


class ProfileStorageUnavailableError(RuntimeError):
    pass


class ProfilePersistenceVerificationError(RuntimeError):
    pass


class ProfileService:
    def __init__(self, repository: ProfileRepository, delete_repository: ProfileRepository | None = None):
        self.repository = repository
        self.delete_repository = delete_repository or repository

    def get_or_create_profile(self, client_id: str) -> dict:
        profile = self.repository.get_by_client_id(client_id)
        if profile:
            return profile
        return self.repository.create_empty(client_id)

    def get_profile_model(self, client_id: str) -> FitnessProfile:
        return FitnessProfile(**self.get_or_create_profile(client_id))

    def upsert_profile_patch(self, client_id: str, fields: dict) -> FitnessProfile:
        self.get_or_create_profile(client_id)
        updated = self.repository.update_fields(client_id, fields)
        merged = {**self.get_or_create_profile(client_id), **updated}
        return FitnessProfile(**merged)

    def get_algorithm_home(self, client_id: str, trainer_id: str | None = None) -> AlgorithmHomeResponse:
        profile = self.get_or_create_profile(client_id)
        memories = self._load_client_visible_memories(client_id=client_id, trainer_id=trainer_id)
        checkins = self._safe_recent_checkins(client_id)
        summary = self._generate_algorithm_summary(profile, memories, checkins)
        profile = self._persist_summary_if_needed(client_id, profile, summary)

        return AlgorithmHomeResponse(
            client_id=client_id,
            summary_text=summary,
            user_why=self._clean_optional_text(profile.get("user_why"), limit=500),
            algorithm_summary_updated_at=profile.get("algorithm_summary_updated_at"),
            memories=memories,
        )

    def update_user_why(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
        user_why: str | None,
    ) -> AlgorithmHomeResponse:
        normalized_why = clean_motivation_text(user_why, limit=500)
        now = datetime.now(timezone.utc).isoformat()
        try:
            self.get_or_create_profile(client_id)
            self.repository.update_fields(
                client_id,
                {
                    "user_why": normalized_why,
                    "updated_at": now,
                },
            )
            persisted_profile = self.repository.get_by_client_id(client_id) or {}
        except Exception as exc:
            if self._is_missing_algorithm_profile_field_error(exc):
                raise ProfileStorageUnavailableError(PROFILE_ALGORITHM_STORAGE_UNAVAILABLE_DETAIL) from exc
            raise

        persisted_why = clean_motivation_text(persisted_profile.get("user_why"), limit=500)
        if persisted_why != normalized_why:
            raise ProfilePersistenceVerificationError(PROFILE_WHY_VERIFICATION_FAILED_DETAIL)

        return self.get_algorithm_home(client_id, trainer_id)

    def create_algorithm_memory(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
        request: AlgorithmMemoryCreateRequest,
    ) -> AlgorithmHomeResponse:
        if not trainer_id:
            raise ValueError("Client is not assigned to a trainer")
        text = self._clean_required_text(request.text, field_name="Memory text")
        memory_type = self._normalize_memory_type(request.memory_type)
        now = datetime.now(timezone.utc)
        memory_key = f"user_{memory_type}_{now.strftime('%Y%m%d%H%M%S%f')}"
        value_json = {
            "source": "user",
            "created_by": "user",
            "client_visible": True,
            "ai_usable": bool(request.ai_usable),
            "visibility": "ai_usable" if request.ai_usable else "client_visible",
            "is_archived": False,
            "text": text,
            "category": self._clean_optional_text(request.category, limit=80),
            "tags": self._normalize_tags(request.tags),
            "structured_data": {},
        }
        created = self.repository.insert_algorithm_memory(
            {
                "trainer_id": trainer_id,
                "client_id": client_id,
                "memory_type": memory_type,
                "memory_key": memory_key,
                "value_json": value_json,
                "updated_at": now.isoformat(),
            }
        )
        algorithm_home = self.get_algorithm_home(client_id, trainer_id)
        created_id = str(created.get("id") or "")
        if not created_id or not any(memory.id == created_id for memory in algorithm_home.memories):
            raise ProfilePersistenceVerificationError(PROFILE_MEMORY_VERIFICATION_FAILED_DETAIL)
        return algorithm_home

    def update_algorithm_memory(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
        memory_id: str,
        request: AlgorithmMemoryUpdateRequest,
    ) -> AlgorithmHomeResponse:
        if not trainer_id:
            raise ValueError("Client is not assigned to a trainer")
        existing = self.repository.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not existing:
            raise ValueError("Memory not found")
        value = self._memory_value(existing)
        if not self._is_client_owned_memory(value):
            raise ValueError("Memory not found")

        next_value = dict(value)
        if request.text is not None:
            next_value["text"] = self._clean_required_text(request.text, field_name="Memory text")
        if request.category is not None:
            next_value["category"] = self._clean_optional_text(request.category, limit=80)
        if request.ai_usable is not None:
            next_value["ai_usable"] = bool(request.ai_usable)
            next_value["visibility"] = "ai_usable" if request.ai_usable else "client_visible"
        if request.tags is not None:
            next_value["tags"] = self._normalize_tags(request.tags)
        next_value["source"] = "user"
        next_value["created_by"] = "user"
        next_value["client_visible"] = True

        updates: dict[str, Any] = {"value_json": next_value}
        if request.memory_type is not None:
            updates["memory_type"] = self._normalize_memory_type(request.memory_type)
        self.repository.update_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
            payload=updates,
        )
        return self.get_algorithm_home(client_id, trainer_id)

    def delete_algorithm_memory(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
        memory_id: str,
    ) -> AlgorithmHomeResponse:
        if not trainer_id:
            raise ValueError("Client is not assigned to a trainer")
        existing = self.repository.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not existing:
            raise ValueError("Memory not found")
        value = self._memory_value(existing)
        if not self._is_client_owned_memory(value):
            raise ValueError("Memory not found")
        self.delete_repository.delete_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if self.delete_repository.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        ):
            raise ProfilePersistenceVerificationError(PROFILE_MEMORY_DELETE_VERIFICATION_FAILED_DETAIL)
        return self.get_algorithm_home(client_id, trainer_id)

    def _persist_summary_if_needed(self, client_id: str, profile: dict, summary: str) -> dict:
        if profile.get("algorithm_summary") == summary and profile.get("algorithm_summary_updated_at"):
            return profile
        now = datetime.now(timezone.utc).isoformat()
        try:
            updated = self.repository.update_fields(
                client_id,
                {
                    "algorithm_summary": summary,
                    "algorithm_summary_updated_at": now,
                    "updated_at": now,
                },
            )
        except Exception as exc:
            if self._is_missing_algorithm_profile_field_error(exc):
                return profile
            raise
        return {**profile, **updated}

    def _load_client_visible_memories(
        self,
        *,
        client_id: str,
        trainer_id: str | None,
    ) -> list[AlgorithmMemoryRecord]:
        if not trainer_id:
            return []
        rows = self.repository.list_algorithm_memories(trainer_id=trainer_id, client_id=client_id)
        records: list[AlgorithmMemoryRecord] = []
        for row in rows:
            record = self._to_algorithm_memory_record(row)
            if record:
                records.append(record)
        return records[:40]

    def _to_algorithm_memory_record(self, row: dict[str, Any]) -> AlgorithmMemoryRecord | None:
        value = self._memory_value(row)
        if self._coerce_bool(value.get("is_archived"), default=False):
            return None
        text = self._clean_optional_text(value.get("text") or value.get("summary") or value.get("value"), limit=500)
        if not text:
            return None
        source = self._normalize_source(value.get("source"))
        is_client_owned = self._is_client_owned_memory(value)
        client_visible = self._is_algorithm_memory_visible_to_client(value, source=source)
        if not client_visible:
            return None
        return AlgorithmMemoryRecord(
            id=str(row.get("id") or ""),
            text=text,
            memory_type=self._normalize_memory_type(row.get("memory_type")),
            memory_key=str(row.get("memory_key") or "") or None,
            category=self._clean_optional_text(value.get("category"), limit=80),
            source=source,  # type: ignore[arg-type]
            ai_usable=self._memory_is_ai_usable(value),
            client_visible=client_visible,
            can_edit=is_client_owned,
            tags=self._normalize_tags(value.get("tags")),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def _generate_algorithm_summary(
        self,
        profile: dict,
        memories: list[AlgorithmMemoryRecord],
        checkins: list[dict[str, Any]],
    ) -> str:
        why = self._clean_optional_text(profile.get("user_why"), limit=160)
        goal = self._goal_label(profile.get("primary_goal"))
        memory_theme = self._memory_theme(memories)
        has_checkins = bool(checkins)

        if not why and not goal and not memory_theme and not has_checkins:
            return ALGORITHM_LEARNING_FALLBACK

        if why:
            return self._limit_words(
                f"You're building strength, energy, and consistency around what matters most: {why}",
                SUMMARY_WORD_LIMIT,
            )
        if goal and memory_theme:
            return self._limit_words(
                f"You're working toward {goal}, with coaching shaped around {memory_theme} and real-life consistency.",
                SUMMARY_WORD_LIMIT,
            )
        if goal:
            return self._limit_words(
                f"You're working toward {goal}, better energy, and a routine that fits real life.",
                SUMMARY_WORD_LIMIT,
            )
        if memory_theme:
            return self._limit_words(
                f"You're shaping training around {memory_theme}, consistency, and support that fits real life.",
                SUMMARY_WORD_LIMIT,
            )
        return self._limit_words(
            "You're building a routine from today's signals, steady energy, and small wins that compound.",
            SUMMARY_WORD_LIMIT,
        )

    def _memory_theme(self, memories: list[AlgorithmMemoryRecord]) -> str | None:
        joined = " ".join(memory.text.lower() for memory in memories[:12])
        if not joined:
            return None
        if any(term in joined for term in ("kid", "family", "child", "children")):
            return "family motivation"
        if any(term in joined for term in ("back", "knee", "shoulder", "pain", "sensitive")):
            return "training safely"
        if any(term in joined for term in ("nutrition", "protein", "meal", "food")):
            return "simple nutrition"
        if any(term in joined for term in ("morning", "schedule", "busy", "travel")):
            return "your schedule"
        if any(term in joined for term in ("direct", "accountability", "motivation")):
            return "direct accountability"
        return "what your coach knows"

    def _safe_recent_checkins(self, client_id: str) -> list[dict[str, Any]]:
        try:
            return self.repository.list_recent_checkins(client_id, limit=5)
        except Exception:
            return []

    def _goal_label(self, value: Any) -> str | None:
        normalized = str(value or "").strip().lower()
        labels = {
            "muscle_gain": "strength",
            "strength": "strength",
            "fat_loss": "leaner fitness",
            "lose_weight": "leaner fitness",
            "general_fitness": "general fitness",
            "performance": "performance",
        }
        if normalized in labels:
            return labels[normalized]
        cleaned = normalized.replace("_", " ").strip()
        return cleaned or None

    def _limit_words(self, value: str, limit: int) -> str:
        words = [word for word in " ".join(str(value or "").split()).split(" ") if word]
        if len(words) <= limit:
            return " ".join(words)
        return f"{' '.join(words[:limit]).rstrip('.,;:')}..."

    def _memory_value(self, row: dict[str, Any]) -> dict[str, Any]:
        value = row.get("value_json")
        return value if isinstance(value, dict) else {}

    def _memory_is_ai_usable(self, value: dict[str, Any]) -> bool:
        if isinstance(value.get("ai_usable"), bool):
            return bool(value.get("ai_usable"))
        if value.get("ai_usable") is not None:
            return self._coerce_bool(value.get("ai_usable"), default=False)
        return str(value.get("visibility") or "").strip().lower() == "ai_usable"

    def _is_algorithm_memory_visible_to_client(self, value: dict[str, Any], *, source: str) -> bool:
        if self._is_client_owned_memory(value):
            return True
        if self._coerce_bool(value.get("client_visible"), default=False):
            return True
        return source == "trainer" and self._memory_is_ai_usable(value)

    def _is_client_owned_memory(self, value: dict[str, Any]) -> bool:
        return (
            self._normalize_source(value.get("source")) == "user"
            and str(value.get("created_by") or "").strip().lower() == "user"
        )

    def _normalize_source(self, value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"user", "trainer", "ai"}:
            return normalized
        return "trainer"

    def _normalize_memory_type(self, value: Any) -> str:
        normalized = str(value or "note").strip().lower()
        if normalized in {"note", "preference", "constraint"}:
            return normalized
        return "note"

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        seen: set[str] = set()
        for item in value:
            normalized = str(item or "").strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            tags.append(normalized[:32])
            if len(tags) >= 8:
                break
        return tags

    def _coerce_bool(self, value: Any, *, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on"}:
                return True
            if normalized in {"false", "0", "no", "off"}:
                return False
        return default

    def _is_missing_algorithm_profile_field_error(self, exc: Exception) -> bool:
        message = str(exc).lower()
        has_algorithm_field = (
            "algorithm_summary" in message
            or "algorithm_summary_updated_at" in message
            or "user_why" in message
        )
        return (
            "user_fitness_profiles" in message
            and has_algorithm_field
            and (
                "schema cache" in message
                or "could not find" in message
                or "does not exist" in message
                or "pgrst204" in message
                or "42703" in message
            )
        )

    def _clean_optional_text(self, value: Any, *, limit: int) -> str | None:
        return clean_motivation_text(value, limit=limit)

    def _clean_required_text(self, value: Any, *, field_name: str) -> str:
        normalized = self._clean_optional_text(value, limit=500)
        if not normalized:
            raise ValueError(f"{field_name} is required")
        return normalized
