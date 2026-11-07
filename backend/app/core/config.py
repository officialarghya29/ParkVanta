from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DEV_SECRET = "dev-only-insecure-jwt-secret-change-before-deploying"


class Settings(BaseSettings):
    """Application configuration loaded from environment variables and `.env`."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ParkVanta"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False

    database_url: str = "postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta"
    database_echo: bool = False
    database_pool_size: int = 10
    database_max_overflow: int = 20

    redis_url: str = "redis://localhost:56379/0"

    jwt_secret: str = DEFAULT_DEV_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    stream_ticket_minutes: int = 2

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allowed_hosts: str = "*"

    login_rate_limit: int = 10
    login_rate_window_seconds: int = 60

    default_qr_validity_minutes: int = 240
    default_overstay_grace_minutes: int = 30
    reservation_ttl_minutes: int = 30

    vision_service_url: str = ""
    vision_enabled: bool = False

    @field_validator("jwt_secret")
    @classmethod
    def _reject_short_secret(cls, value: str) -> str:
        if len(value) < 24:
            raise ValueError("JWT_SECRET must be at least 24 characters")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod", "staging"}

    def validate_for_production(self) -> None:
        if self.is_production and self.jwt_secret == DEFAULT_DEV_SECRET:
            raise RuntimeError("Refusing to start: default JWT secret in a production environment")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
