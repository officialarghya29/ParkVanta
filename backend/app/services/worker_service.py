"""Worker liveness and email-outbox health.

Workers record a heartbeat after each successful run. The health command and
the Prometheus endpoint read those heartbeats plus the email outbox, so an
operator can distinguish a stopped scheduler from a failing relay.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import ensure_utc, utcnow
from app.models import Notification, WorkerHeartbeat
from app.models.enums import NotificationChannel, NotificationStatus

WORKERS = ("expiry", "notifications")


def record_heartbeat(
    db: Session,
    worker: str,
    *,
    status: str = "OK",
    detail: str | None = None,
    now: datetime | None = None,
) -> WorkerHeartbeat:
    """Upsert the worker's last successful run in the caller's transaction."""
    now = now or utcnow()
    row = db.get(WorkerHeartbeat, worker)
    if row is None:
        row = WorkerHeartbeat(worker=worker)
        db.add(row)
    row.last_seen_at = now
    row.last_status = status
    row.detail = (detail or "")[:255] or None
    return row


def outbox_snapshot(db: Session, *, now: datetime | None = None) -> dict:
    now = now or utcnow()
    rows = db.execute(
        select(Notification.status, func.count())
        .where(Notification.channel == NotificationChannel.EMAIL.value)
        .group_by(Notification.status)
    ).all()
    counts = {status.value: 0 for status in NotificationStatus}
    for status, count in rows:
        counts[str(status)] = int(count)

    oldest = db.scalar(
        select(func.min(Notification.created_at)).where(
            Notification.channel == NotificationChannel.EMAIL.value,
            Notification.status == NotificationStatus.PENDING.value,
        )
    )
    max_attempts = db.scalar(
        select(func.max(Notification.attempts)).where(
            Notification.channel == NotificationChannel.EMAIL.value,
            Notification.status == NotificationStatus.PENDING.value,
        )
    )
    age = 0.0 if oldest is None else max(0.0, (now - ensure_utc(oldest)).total_seconds())
    return {
        "counts": counts,
        "oldest_pending_at": oldest,
        "oldest_pending_seconds": age,
        "pending_attempts_max": int(max_attempts or 0),
    }


def heartbeat_snapshot(db: Session, *, now: datetime | None = None) -> dict:
    now = now or utcnow()
    rows = {row.worker: row for row in db.scalars(select(WorkerHeartbeat))}
    snapshot: dict[str, dict] = {}
    for worker in WORKERS:
        row = rows.get(worker)
        age = (
            None
            if row is None
            else max(0.0, (now - ensure_utc(row.last_seen_at)).total_seconds())
        )
        snapshot[worker] = {
            "last_seen_at": row.last_seen_at if row else None,
            "age_seconds": age,
            "status": row.last_status if row else None,
            "detail": row.detail if row else None,
        }
    return snapshot


def check_health(
    db: Session,
    *,
    now: datetime | None = None,
    max_pending_minutes: int | None = None,
    max_worker_age_minutes: int | None = None,
) -> dict:
    """Return a machine-readable verdict; the CLI exits non-zero when unhealthy."""
    now = now or utcnow()
    pending_limit = (
        settings.outbox_stale_minutes
        if max_pending_minutes is None
        else max_pending_minutes
    )
    worker_limit = (
        settings.worker_stale_minutes
        if max_worker_age_minutes is None
        else max_worker_age_minutes
    )
    outbox = outbox_snapshot(db, now=now)
    workers = heartbeat_snapshot(db, now=now)
    problems: list[str] = []

    failed = outbox["counts"].get(NotificationStatus.FAILED.value, 0)
    if failed:
        problems.append(f"{failed} email delivery row(s) are FAILED")

    pending = outbox["counts"].get(NotificationStatus.PENDING.value, 0)
    pending_minutes = outbox["oldest_pending_seconds"] / 60
    if pending and pending_minutes > pending_limit:
        problems.append(
            f"oldest pending email is {pending_minutes:.1f} minutes old "
            f"(limit {pending_limit})"
        )

    for worker in WORKERS:
        heartbeat = workers[worker]
        if heartbeat["last_seen_at"] is None:
            problems.append(f"worker '{worker}' has no heartbeat")
        elif heartbeat["age_seconds"] > worker_limit * 60:
            problems.append(
                f"worker '{worker}' last ran {heartbeat['age_seconds'] / 60:.1f} "
                f"minutes ago (limit {worker_limit})"
            )

    return {
        "healthy": not problems,
        "checked_at": now.isoformat(),
        "problems": problems,
        "thresholds": {
            "max_pending_minutes": pending_limit,
            "max_worker_age_minutes": worker_limit,
        },
        "outbox": outbox,
        "workers": workers,
    }
