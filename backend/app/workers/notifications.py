"""Email notification outbox worker.

Run on a schedule:

    python -m app.workers.notifications

Rows are claimed by status + next_attempt_at and committed one batch. SMTP
failure retries with exponential backoff; no relay marks the row SKIPPED.
"""

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.database.session import session_scope
from app.models import Notification, User
from app.models.enums import NotificationChannel, NotificationStatus
from app.services import mail_service, worker_service

logger = logging.getLogger("parkvanta.workers.notifications")
MAX_ATTEMPTS = 5


def dispatch_notifications(db: Session, *, now=None, limit: int = 50) -> dict[str, int]:
    now = now or utcnow()
    rows = db.execute(
        select(Notification, User)
        .outerjoin(User, Notification.user_id == User.id)
        .where(
            Notification.channel == NotificationChannel.EMAIL.value,
            Notification.status == NotificationStatus.PENDING.value,
            (Notification.next_attempt_at.is_(None))
            | (Notification.next_attempt_at <= now),
        )
        .order_by(Notification.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True, of=Notification)
    ).all()
    result = {"sent": 0, "skipped": 0, "failed": 0, "retrying": 0}

    for note, user in rows:
        if user is None or not user.is_active or user.is_suspended:
            note.status = NotificationStatus.FAILED.value
            note.error = "Recipient account is unavailable"
            result["failed"] += 1
            continue

        try:
            mail_service.send_email(
                to=user.email,
                subject=f"[ParkVanta] {note.title}",
                body=f"{note.title}\n\n{note.body}\n\n— ParkVanta",
            )
        except mail_service.MailNotConfigured:
            note.status = NotificationStatus.SKIPPED.value
            note.error = "SMTP is not configured"
            result["skipped"] += 1
        except mail_service.MailDeliveryError as exc:
            note.attempts = (note.attempts or 0) + 1
            note.error = str(exc)[:255]
            if note.attempts >= MAX_ATTEMPTS:
                note.status = NotificationStatus.FAILED.value
                result["failed"] += 1
            else:
                note.next_attempt_at = now + timedelta(minutes=2**note.attempts)
                result["retrying"] += 1
        else:
            note.status = NotificationStatus.SENT.value
            note.sent_at = now
            note.error = None
            note.next_attempt_at = None
            result["sent"] += 1

    worker_service.record_heartbeat(
        db,
        "notifications",
        detail=(
            f"sent={result['sent']} retrying={result['retrying']} "
            f"skipped={result['skipped']} failed={result['failed']}"
        ),
    )
    db.commit()
    return result


if __name__ == "__main__":  # pragma: no cover - operational entry point
    logging.basicConfig(level=logging.INFO)
    with session_scope() as session:
        logger.info("notification dispatch complete: %s", dispatch_notifications(session))
