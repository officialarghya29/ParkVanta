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
    """Deliver an in-app notification. External channels need a configured provider.

    SMS/email/WhatsApp rows are recorded as SKIPPED rather than pretending the
    message was delivered. Entry decisions never depend on notification delivery.
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
    db.add(note)
    return note
