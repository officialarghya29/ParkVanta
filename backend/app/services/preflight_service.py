"""Go/no-go checks for a live pilot.

These checks are deliberately block-or-warn: a simulated pilot is not a pilot.
The command refuses to declare a deployment ready while demo accounts, missing
workers, a broken outbox or development secrets are present.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import DEFAULT_DEV_SECRET
from app.core.config import settings as global_settings
from app.core.time import utcnow
from app.models import Organization, Property, User
from app.models.enums import NotificationStatus, Role
from app.services import worker_service

DEMO_EMAIL_DOMAIN = "@skyline.dev"


def _check(
    checks: list[dict],
    name: str,
    passed: bool,
    detail: str,
    *,
    blocking: bool = True,
) -> None:
    checks.append(
        {"name": name, "passed": bool(passed), "blocking": blocking, "detail": detail}
    )


def run_preflight(
    db: Session,
    *,
    now: datetime | None = None,
    cfg=None,
) -> dict:
    cfg = cfg or global_settings
    now = now or utcnow()
    production = cfg.is_production
    checks: list[dict] = []

    _check(
        checks,
        "environment",
        production,
        f"ENVIRONMENT={cfg.environment}",
        blocking=False,
    )
    _check(
        checks,
        "jwt_secret",
        cfg.jwt_secret != DEFAULT_DEV_SECRET and len(cfg.jwt_secret) >= 24,
        "JWT secret is not the development default",
    )

    origins = cfg.cors_origin_list
    cors_ok = bool(origins) and "*" not in origins
    if production:
        cors_ok = cors_ok and all(origin.startswith("https://") for origin in origins)
    _check(checks, "cors", cors_ok, f"CORS origins: {', '.join(origins) or 'none'}")

    public_ok = bool(cfg.app_public_url)
    if production:
        public_ok = public_ok and cfg.app_public_url.startswith("https://")
    _check(checks, "public_url", public_ok, f"APP_PUBLIC_URL={cfg.app_public_url}")

    _check(
        checks,
        "smtp",
        cfg.email_configured,
        "SMTP_HOST and SMTP_FROM are configured",
    )
    _check(
        checks,
        "metrics_token",
        bool(cfg.metrics_token),
        "METRICS_TOKEN is set for /metrics",
        blocking=False,
    )

    org_count = db.scalar(select(func.count()).select_from(Organization)) or 0
    property_count = db.scalar(select(func.count()).select_from(Property)) or 0
    admin_count = (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role.in_([Role.SOCIETY_ADMIN.value, Role.SUPER_ADMIN.value]),
                User.is_active.is_(True),
                User.is_suspended.is_(False),
            )
        )
        or 0
    )
    demo_count = (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.email.like(f"%{DEMO_EMAIL_DOMAIN}"))
        )
        or 0
    )
    _check(checks, "organization", org_count >= 1, f"{org_count} organization(s)")
    _check(checks, "property", property_count >= 1, f"{property_count} property(ies)")
    _check(checks, "administrator", admin_count >= 1, f"{admin_count} active administrator(s)")
    _check(
        checks,
        "demo_accounts",
        demo_count == 0,
        f"{demo_count} demo account(s) still present",
    )

    heartbeats = worker_service.heartbeat_snapshot(db, now=now)
    worker_limit = cfg.worker_stale_minutes * 60
    stale = [
        worker
        for worker, heartbeat in heartbeats.items()
        if heartbeat["age_seconds"] is None
        or heartbeat["age_seconds"] > worker_limit
    ]
    _check(
        checks,
        "worker_heartbeats",
        not stale,
        f"stale/missing: {', '.join(stale) or 'none'}",
    )

    outbox = worker_service.outbox_snapshot(db, now=now)
    failed = outbox["counts"].get(NotificationStatus.FAILED.value, 0)
    pending_minutes = outbox["oldest_pending_seconds"] / 60
    _check(
        checks,
        "email_outbox",
        failed == 0 and pending_minutes <= cfg.outbox_stale_minutes,
        f"failed={failed}, oldest_pending={pending_minutes:.1f}m",
    )
    _check(
        checks,
        "archive_retention",
        cfg.event_retention_days >= 7,
        f"EVENT_RETENTION_DAYS={cfg.event_retention_days}",
        blocking=False,
    )

    blockers = [item["detail"] for item in checks if item["blocking"] and not item["passed"]]
    warnings = [
        item["detail"] for item in checks if not item["blocking"] and not item["passed"]
    ]
    return {
        "ready": not blockers,
        "checked_at": now.isoformat(),
        "environment": cfg.environment,
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
    }
