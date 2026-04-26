from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_csv(raw_value: str | None, *, fallback: list[str]) -> list[str]:
    if raw_value is None:
        return [*fallback]

    values = [value.strip() for value in str(raw_value).split(",") if value.strip()]
    if values:
        return values
    return [*fallback]


class Settings(BaseSettings):
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None
    ai_request_timeout_seconds: float = 30.0
    ai_max_retries: int = 2
    expose_route_debug: bool = False
    trainer_intelligence_orchestration_enabled: bool = False
    trainer_ai_review_auto_apply_enabled: bool = True
    trainer_assistant_v1_enabled: bool = True
    trainer_assignment_global_fallback_enabled: bool = False
    rate_limit_enabled: bool = True
    rate_limit_window_seconds: int = 60
    rate_limit_default_per_window: int = 90
    rate_limit_chat_per_window: int = 30
    rate_limit_trainer_assistant_per_window: int = 20
    rate_limit_onboarding_per_window: int = 20
    rate_limit_mobile_events_per_window: int = 120
    cors_allow_origins: str = (
        "http://localhost:19006,http://127.0.0.1:19006,"
        "http://localhost:8081,http://127.0.0.1:8081,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )
    cors_allow_methods: str = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    cors_allow_headers: str = "*"
    cors_allow_credentials: bool = False
    supabase_url: str | None = None
    supabase_anon_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY"),
    )
    supabase_service_role_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "backend/.env"),
        extra="ignore",
    )

    @property
    def cors_allow_origins_list(self) -> list[str]:
        return _split_csv(self.cors_allow_origins, fallback=["*"])

    @property
    def cors_allow_methods_list(self) -> list[str]:
        return _split_csv(self.cors_allow_methods, fallback=["*"])

    @property
    def cors_allow_headers_list(self) -> list[str]:
        return _split_csv(self.cors_allow_headers, fallback=["*"])


settings = Settings()
