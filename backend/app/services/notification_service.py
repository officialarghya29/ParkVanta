from uuid import UUID

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import Notification
from app.models.enums import NotificationChannel, NotificationStatus


def notify_user(
    db: Session,
    *,
    organization_id: UUID,
    user_id: UUID,
    title: str,
    body: str,
) -> Notification:
    """Create the authoritative in-app note and a queued email delivery row.

    Email rows are PENDING until `python -m app.workers.notifications` runs.
    The worker marks them SENT, SKIPPED (no SMTP) or FAILED (retry exhausted);
    entry decisions never depend on delivery.
    """
    note = Notification(
        organization_id=organization_id,
        user_id=user_id,
        channel=NotificationChannel.IN_APP.value,
        title=title,
        body=body,
        status=NotificationStatus.SENT.value,
        sent_at=utcnow(),
    )
    email = Notification(
        organization_id=organization_id,
        user_id=user_id,
        channel=NotificationChannel.EMAIL.value,
        title=title,
        body=body,
        status=NotificationStatus.PENDING.value,
        attempts=0,
    )
    db.add_all([note, email])
    return note
