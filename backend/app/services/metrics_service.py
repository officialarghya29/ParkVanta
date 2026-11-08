"""Prometheus text exposition for the email outbox and worker freshness."""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import ensure_utc
from app.models.enums import NotificationStatus
from app.services import worker_service

STATUS_ORDER = (
    NotificationStatus.FAILED,
    NotificationStatus.PENDING,
    NotificationStatus.SENT,
    NotificationStatus.SKIPPED,
)


def render_metrics(db: Session) -> str:
    outbox = worker_service.outbox_snapshot(db)
    workers = worker_service.heartbeat_snapshot(db)
    lines = [
        "# HELP parkvanta_notification_outbox_rows Email outbox rows by delivery status.",
        "# TYPE parkvanta_notification_outbox_rows gauge",
    ]
    for status in STATUS_ORDER:
        value = outbox["counts"].get(status.value, 0)
        lines.append(
            f'parkvanta_notification_outbox_rows{{status="{status.value}"}} {value}'
        )

    lines.extend(
        [
            "# HELP parkvanta_notification_outbox_oldest_pending_seconds "
            "Age of the oldest queued email.",
            "# TYPE parkvanta_notification_outbox_oldest_pending_seconds gauge",
            "parkvanta_notification_outbox_oldest_pending_seconds "
            f"{outbox['oldest_pending_seconds']:.3f}",
            "# HELP parkvanta_notification_outbox_pending_attempts_max "
            "Highest retry count among queued email.",
            "# TYPE parkvanta_notification_outbox_pending_attempts_max gauge",
            "parkvanta_notification_outbox_pending_attempts_max "
            f"{outbox['pending_attempts_max']}",
            "# HELP parkvanta_worker_last_seen_timestamp_seconds "
            "Unix time of the last successful worker run.",
            "# TYPE parkvanta_worker_last_seen_timestamp_seconds gauge",
        ]
    )
    for worker in worker_service.WORKERS:
        last_seen = workers[worker]["last_seen_at"]
        if last_seen is not None:
            lines.append(
                f'parkvanta_worker_last_seen_timestamp_seconds{{worker="{worker}"}} '
                f"{ensure_utc(last_seen).timestamp():.0f}"
            )

    lines.extend(
        [
            "# HELP parkvanta_worker_age_seconds Seconds since the last successful run.",
            "# TYPE parkvanta_worker_age_seconds gauge",
        ]
    )
    for worker in worker_service.WORKERS:
        age = workers[worker]["age_seconds"]
        if age is not None:
            lines.append(
                f'parkvanta_worker_age_seconds{{worker="{worker}"}} {age:.3f}'
            )

    lines.extend(
        [
            "# HELP parkvanta_worker_up Whether the worker has a fresh heartbeat.",
            "# TYPE parkvanta_worker_up gauge",
        ]
    )
    limit = settings.worker_stale_minutes * 60
    for worker in worker_service.WORKERS:
        age = workers[worker]["age_seconds"]
        up = 1 if age is not None and age <= limit else 0
        lines.append(f'parkvanta_worker_up{{worker="{worker}"}} {up}')

    return "\n".join(lines) + "\n"
