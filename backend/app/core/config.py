from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

DEFAULT_DEV_SECRET = "dev-only-insecure-jwt-secret-change-before-deploying"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Settings(BaseSettings):
    """Application configuration loaded from environment variables and `.env`."""

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "ParkVanta"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    enable_api_docs: bool | None = None

    database_url: str = "postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta"
    database_echo: bool = False
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_recycle: int = 1800
    database_connect_timeout: int = 10

    redis_url: str = "redis://localhost:56379/0"

    jwt_secret: str = DEFAULT_DEV_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    stream_ticket_minutes: int = 2
    refresh_cookie_samesite: str = "lax"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allowed_hosts: str = "*"
    trusted_proxies: str = ""

    login_rate_limit: int = 10
    login_rate_window_seconds: int = 60

    default_qr_validity_minutes: int = 240
    default_overstay_grace_minutes: int = 30
    reservation_ttl_minutes: int = 30
    event_retention_days: int = 30

    app_public_url: str = "http://localhost:5173"
    metrics_token: str = ""
    outbox_stale_minutes: int = 10
    worker_stale_minutes: int = 5
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "ParkVanta <no-reply@parkvanta.local>"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            raise ValueError("DATABASE_URL must not be empty")
        if raw.startswith("postgres://"):
            raw = "postgresql+psycopg://" + raw[len("postgres://") :]
        elif raw.startswith("postgresql://"):
            raw = "postgresql+psycopg://" + raw[len("postgresql://") :]
        try:
            parsed = make_url(raw)
        except Exception as exc:
            raise ValueError("DATABASE_URL is not a valid SQLAlchemy database URL") from exc
        if parsed.drivername != "postgresql+psycopg":
            raise ValueError("DATABASE_URL must use the postgresql+psycopg driver")
        if not parsed.host or not parsed.database:
            raise ValueError("DATABASE_URL must include a hostname and database name")
        return raw

    @field_validator("redis_url")
    @classmethod
    def _validate_redis_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            raise ValueError("REDIS_URL must not be empty")
        parsed = urlparse(raw)
        if parsed.scheme not in {"redis", "rediss", "unix"}:
            raise ValueError("REDIS_URL must use redis://, rediss://, or unix://")
        if parsed.scheme in {"redis", "rediss"} and not parsed.hostname:
            raise ValueError("REDIS_URL must include a hostname")
        return raw

    @field_validator("jwt_secret")
    @classmethod
    def _reject_short_secret(cls, value: str) -> str:
        if len(value) < 24:
            raise ValueError("JWT_SECRET must be at least 24 characters")
        return value

    @field_validator("refresh_cookie_samesite")
    @classmethod
    def _validate_cookie_samesite(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("REFRESH_COOKIE_SAMESITE must be 'lax', 'strict', or 'none'")
        return normalized

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def trusted_proxy_list(self) -> list[str]:
        return [proxy.strip() for proxy in self.trusted_proxies.split(",") if proxy.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod", "staging"}

    @property
    def api_docs_enabled(self) -> bool:
        if self.enable_api_docs is not None:
            return self.enable_api_docs
        return not self.is_production

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    def _production_errors(self) -> list[str]:
        errors: list[str] = []
        if self.jwt_secret == DEFAULT_DEV_SECRET or len(self.jwt_secret.strip()) < 32:
            errors.append("JWT_SECRET must be at least 32 characters and not the development default")
        if self.debug:
            errors.append("DEBUG must be false in production")
        if self.database_echo:
            errors.append("DATABASE_ECHO must be false in production")

        db_url = make_url(self.database_url)
        if (db_url.host or "").lower() in _LOCAL_HOSTS or (
            db_url.username == "parkvanta" and db_url.password == "parkvanta"
        ):
            errors.append("DATABASE_URL must not use development defaults in production")

        redis_parsed = urlparse(self.redis_url)
        if redis_parsed.scheme in {"redis", "rediss"} and (redis_parsed.hostname or "").lower() in _LOCAL_HOSTS:
            errors.append("REDIS_URL must not point to localhost in production")

        origins = self.cors_origin_list
        if not origins:
            errors.append("CORS_ORIGINS must be explicitly configured in production")
        elif "*" in origins:
            errors.append("CORS_ORIGINS cannot contain '*' when credentials are enabled in production")
        else:
            for origin in origins:
                parsed = urlparse(origin)
                if (
                    parsed.scheme != "https"
                    or not parsed.netloc
                    or parsed.path not in {"", "/"}
                    or parsed.query
                    or parsed.fragment
                    or (parsed.hostname or "").lower() in _LOCAL_HOSTS
                ):
                    errors.append(f"CORS_ORIGINS entry '{origin}' must be a valid non-local https:// origin")

        hosts = self.allowed_host_list
        if not hosts or "*" in hosts:
            errors.append("ALLOWED_HOSTS must list explicit hostnames and must not be '*' in production")

        public_parsed = urlparse(self.app_public_url.strip())
        if (
            public_parsed.scheme != "https"
            or not public_parsed.netloc
            or (public_parsed.hostname or "").lower() in _LOCAL_HOSTS
        ):
            errors.append("APP_PUBLIC_URL must be a valid non-local https:// URL in production")

        if self.metrics_token and len(self.metrics_token.strip()) < 16:
            errors.append("METRICS_TOKEN must be at least 16 characters when configured in production")

        return errors

    @model_validator(mode="after")
    def _validate_environment_constraints(self) -> "Settings":
        if self.refresh_cookie_samesite == "none" and not self.is_production:
            raise ValueError("REFRESH_COOKIE_SAMESITE='none' requires a production/HTTPS environment")
        if self.is_production:
            errors = self._production_errors()
            if errors:
                raise ValueError("; ".join(errors))
        return self

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        errors = self._production_errors()
        if errors:
            raise RuntimeError(f"Refusing to start in {self.environment} mode: {'; '.join(errors)}")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
