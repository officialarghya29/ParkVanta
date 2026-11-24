import pytest
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

import app.main as main_module
from app.api.v1.routers import auth as auth_router
from app.core.config import DEFAULT_DEV_SECRET, Settings
from app.core.errors import ForbiddenError


def _valid_prod_kwargs(**overrides) -> dict:
    base = {
        "environment": "production",
        "debug": False,
        "database_echo": False,
        "database_url": "postgresql://produser:StrongPass123@postgres.railway.internal:5432/railway",
        "redis_url": "redis://default:StrongRedis123@redis.railway.internal:6379/0",
        "jwt_secret": "a-production-jwt-secret-with-at-least-32-chars",
        "cors_origins": "https://web.example.com,https://admin.example.com",
        "allowed_hosts": "api.example.com,*.up.railway.app",
        "app_public_url": "https://web.example.com",
        "metrics_token": "metrics-token-at-least-16-chars",
        "refresh_cookie_samesite": "lax",
    }
    base.update(overrides)
    return base


def test_database_url_normalizes_railway_postgres_schemes():
    cfg = Settings(
        database_url="postgres://user:p%40ss@db.railway.internal:5432/railway",
        jwt_secret="test-secret-key-that-is-long-enough-for-validation",
    )
    assert cfg.database_url == "postgresql+psycopg://user:p%40ss@db.railway.internal:5432/railway"

    cfg2 = Settings(**_valid_prod_kwargs())
    assert cfg2.database_url.startswith("postgresql+psycopg://")
    assert cfg2.api_docs_enabled is False


def test_production_settings_reject_insecure_defaults():
    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(jwt_secret=DEFAULT_DEV_SECRET))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(jwt_secret="too-short-for-prod-1234567"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(debug=True))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(cors_origins="*"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(cors_origins="http://web.example.com"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(allowed_hosts="*"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(app_public_url="http://localhost:5173"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(redis_url="redis://localhost:56379/0"))

    with pytest.raises(ValidationError):
        Settings(**_valid_prod_kwargs(metrics_token="short"))

    with pytest.raises(ValidationError):
        Settings(environment="development", refresh_cookie_samesite="none")


def test_metrics_fails_closed_in_production_without_token(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, "environment", "production")
    monkeypatch.setattr(main_module.settings, "metrics_token", "")

    denied = client.get("/metrics")
    assert denied.status_code == 403

    monkeypatch.setattr(main_module.settings, "metrics_token", "prod-metrics-secret-123")
    assert client.get("/metrics").status_code == 401
    assert (
        client.get("/metrics", headers={"Authorization": "Bearer prod-metrics-secret-123"}).status_code
        == 200
    )


def test_health_bypass_trusted_host_allows_probes_but_blocks_untrusted_api_hosts():
    import asyncio

    async def dummy_app(scope, receive, send):
        response = Response("ok", status_code=200)
        await response(scope, receive, send)

    middleware = main_module._HealthBypassTrustedHostMiddleware(
        dummy_app, allowed_hosts=["api.example.com"]
    )

    async def call(path: str, host: str) -> int:
        status_code = 0

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]

        scope = {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [(b"host", host.encode())],
            "query_string": b"",
            "scheme": "https",
        }
        await middleware(scope, receive, send)
        return status_code

    assert asyncio.run(call("/health", "healthcheck.railway.app")) == 200
    assert asyncio.run(call("/ready", "127.0.0.1:8000")) == 200
    assert asyncio.run(call("/api/v1/auth/me", "evil.example")) == 400
    assert asyncio.run(call("/api/v1/auth/me", "api.example.com")) == 200


def test_cross_site_cookie_csrf_and_logout_cookie_attributes(monkeypatch):
    monkeypatch.setattr(auth_router.settings, "environment", "production")
    monkeypatch.setattr(auth_router.settings, "refresh_cookie_samesite", "none")
    monkeypatch.setattr(auth_router.settings, "cors_origins", "https://web.up.railway.app")

    def make_req(headers: dict[str, str]) -> Request:
        return Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/auth/refresh",
                "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                "query_string": b"",
                "scheme": "https",
            }
        )

    # Missing Origin is rejected in SameSite=None mode
    with pytest.raises(ForbiddenError):
        auth_router._assert_cookie_csrf(
            make_req({"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"})
        )

    # Untrusted Origin is rejected
    with pytest.raises(ForbiddenError):
        auth_router._assert_cookie_csrf(
            make_req(
                {
                    "Origin": "https://evil.example",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                }
            )
        )

    # Simple-request CSRF without X-Requested-With / JSON is rejected
    with pytest.raises(ForbiddenError):
        auth_router._assert_cookie_csrf(
            make_req({"Origin": "https://web.up.railway.app", "Content-Type": "text/plain"})
        )

    # Valid cross-site SPA request passes
    auth_router._assert_cookie_csrf(
        make_req(
            {
                "Origin": "https://web.up.railway.app",
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            }
        )
    )

    # Cookie deletion uses matching SameSite=None, Secure, HttpOnly, Path=/api/v1/auth
    resp = Response()
    resp.delete_cookie(auth_router.COOKIE_NAME, **auth_router._cookie_attrs())
    set_cookie = resp.headers["set-cookie"].lower()
    assert "path=/api/v1/auth" in set_cookie
    assert "samesite=none" in set_cookie
    assert "secure" in set_cookie
    assert "httponly" in set_cookie
