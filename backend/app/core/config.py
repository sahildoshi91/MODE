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
    app_env: str = "development"
    startup_guard_enabled: bool = True
    account_deletion_enabled: bool = True
    account_deletion_contract_enforced: bool = True
    personal_data_inventory_path: str = "security/personal_data_inventory.json"
    account_deletion_active_sink_categories: str = "file_storage,retrieval_caches,analytics_events"
    account_deletion_disabled_sink_categories: str = (
        "vector_indexes,embedding_stores,logs,notification_providers,email_providers,ai_memory_retrieval_systems"
    )
    auth_password_proxy_enabled: bool = True
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None
    ai_request_timeout_seconds: float = 30.0
    ai_max_retries: int = 2
    expose_route_debug: bool = False
    redis_url: str | None = None
    chat_cache_enabled: bool = True
    chat_cache_timeout_ms: int = Field(default=25, ge=1, le=500)
    chat_router_timeout_ms: int = Field(default=200, ge=1, le=1000)
    health_check_timeout_ms: int = Field(default=500, ge=50, le=5000)
    health_cache_ttl_seconds: float = Field(default=5.0, ge=0.1, le=60.0)
    health_stale_after_seconds: float = Field(default=30.0, ge=1.0, le=300.0)
    chat_stream_legacy_alias_enabled: bool = True
    chat_staging_openai_only: bool = False
    atlas_enabled: bool = True
    atlas_background_learning_enabled: bool = True
    atlas_review_required: bool = True
    atlas_trainer_deletion_learning_enabled: bool = True
    atlas_trainer_ai_manager_enabled: bool = True
    trainer_ai_learning_enabled: bool = True
    trainer_ai_review_required: bool = True
    intelligence_worker_concurrency: int = Field(default=1, ge=1, le=16)
    atlas_runtime_enabled: bool = False
    atlas_generic_coach_enabled: bool = False
    atlas_admin_email_allowlist: str = ""
    trainer_intelligence_orchestration_enabled: bool = False
    trainer_ai_review_auto_apply_enabled: bool = True
    trainer_assistant_v1_enabled: bool = True
    trainer_assignment_global_fallback_enabled: bool = False
    rate_limit_enabled: bool = True
    rate_limit_backend: str = "memory"
    rate_limit_window_seconds: int = 60
    rate_limit_default_per_window: int = 90
    rate_limit_chat_per_window: int = 30
    rate_limit_chat_client_per_window: int = 20
    rate_limit_chat_trainer_per_window: int = 200
    rate_limit_chat_ip_per_window: int = 500
    rate_limit_ip_per_window: int = 1000
    rate_limit_trainer_assistant_per_window: int = 20
    rate_limit_onboarding_per_window: int = 20
    rate_limit_mobile_events_per_window: int = 120
    rate_limit_invite_redeem_per_window: int = 8
    rate_limit_login_per_window: int = 10
    rate_limit_signup_per_window: int = 8
    rate_limit_password_reset_per_window: int = 6
    rate_limit_memory_create_per_window: int = 20
    rate_limit_file_upload_per_window: int = 20
    rate_limit_expensive_ai_per_window: int = 8
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
    storage_private_bucket: str = "private-user-files"
    storage_signed_url_ttl_seconds: int = 300
    storage_upload_window_seconds: int = 180
    storage_upload_verification_grace_seconds: int = 30
    storage_cleanup_known_prefixes: str = "client,trainer,user,users,auth"
    storage_max_file_size_bytes: int = 10 * 1024 * 1024
    storage_allowed_extensions: str = "pdf,png,jpg,jpeg,webp,txt,csv,json"
    storage_allowed_mime_types: str = (
        "application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,application/json"
    )
    production_required_rls_tables: str = (
        "clients,trainers,conversations,conversation_messages,coach_memory,trainer_invite_codes"
    )
    production_block_staging_supabase_hosts: str = "staging,localhost,127.0.0.1"

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

    @property
    def is_production(self) -> bool:
        return str(self.app_env).strip().lower() in {"prod", "production"}

    @property
    def storage_allowed_extensions_list(self) -> list[str]:
        return [item.lstrip(".").lower() for item in _split_csv(self.storage_allowed_extensions, fallback=[])]

    @property
    def storage_allowed_mime_types_list(self) -> list[str]:
        return [item.lower() for item in _split_csv(self.storage_allowed_mime_types, fallback=[])]

    @property
    def production_required_rls_tables_list(self) -> list[str]:
        return [item for item in _split_csv(self.production_required_rls_tables, fallback=[])]

    @property
    def production_block_staging_supabase_hosts_list(self) -> list[str]:
        return [item.lower() for item in _split_csv(self.production_block_staging_supabase_hosts, fallback=[])]

    @property
    def account_deletion_active_sink_categories_list(self) -> list[str]:
        return [item for item in _split_csv(self.account_deletion_active_sink_categories, fallback=[])]

    @property
    def account_deletion_disabled_sink_categories_list(self) -> list[str]:
        return [item for item in _split_csv(self.account_deletion_disabled_sink_categories, fallback=[])]

    @property
    def storage_cleanup_known_prefixes_list(self) -> list[str]:
        return [item for item in _split_csv(self.storage_cleanup_known_prefixes, fallback=[])]

    @property
    def atlas_admin_email_allowlist_list(self) -> list[str]:
        return [item.lower() for item in _split_csv(self.atlas_admin_email_allowlist, fallback=[])]


settings = Settings()
