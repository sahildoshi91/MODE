import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = os.getenv("OPENAI_API_KEY")
    supabase_url: str = os.getenv("SUPABASE_URL")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY") or os.getenv("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
