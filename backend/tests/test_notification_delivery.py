from sqlalchemy import select

from app.core.time import utcnow
from app.models import Notification, User
from app.models.enums import NotificationChannel, NotificationStatus
from app.services import mail_service, notification_service
from app.workers import notifications as worker


def test_outbox_marks_email_sent(client, world, tokens, db_session, monkeypatch):
    recipient = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    assert recipient is not None
    notification_service.notify_user(
        db_session,
        organization_id=world["org_id"],
        user_id=recipient.id,
        title="Visitor pass issued",
        body="Your visitor pass is ready.",
    )
    db_session.commit()

    sent: dict[str, str] = {}

    def fake_send_email(*, to: str, subject: str, body: str) -> None:
        sent.update({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(mail_service, "send_email", fake_send_email)
    result = worker.dispatch_notifications(db_session, now=utcnow())

    assert result["sent"] == 1
    assert sent["to"] == world["resident_email"]
    assert sent["subject"] == "[ParkVanta] Visitor pass issued"
    note = db_session.scalar(
        select(Notification).where(
            Notification.user_id == recipient.id,
            Notification.channel == NotificationChannel.EMAIL.value,
        )
    )
    assert note is not None
    assert note.status == NotificationStatus.SENT.value
    assert note.sent_at is not None


def test_outbox_retries_smtp_failure(client, world, tokens, db_session, monkeypatch):
    recipient = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    assert recipient is not None
    notification_service.notify_user(
        db_session,
        organization_id=world["org_id"],
        user_id=recipient.id,
        title="Visitor entered",
        body="Your visitor is inside.",
    )
    db_session.commit()

    def failing_send_email(**_):
        raise mail_service.MailDeliveryError("relay unavailable")

    monkeypatch.setattr(mail_service, "send_email", failing_send_email)
    result = worker.dispatch_notifications(db_session, now=utcnow())

    assert result["retrying"] == 1
    note = db_session.scalar(
        select(Notification).where(
            Notification.user_id == recipient.id,
            Notification.channel == NotificationChannel.EMAIL.value,
        )
    )
    assert note is not None
    assert note.status == NotificationStatus.PENDING.value
    assert note.attempts == 1
    assert note.next_attempt_at is not None
    assert "relay unavailable" in (note.error or "")


def test_outbox_skips_when_smtp_is_not_configured(client, world, tokens, db_session, monkeypatch):
    recipient = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    assert recipient is not None
    notification_service.notify_user(
        db_session,
        organization_id=world["org_id"],
        user_id=recipient.id,
        title="Visitor exited",
        body="The bay was released.",
    )
    db_session.commit()

    def unavailable(**_):
        raise mail_service.MailNotConfigured("SMTP is not configured")

    monkeypatch.setattr(mail_service, "send_email", unavailable)
    result = worker.dispatch_notifications(db_session, now=utcnow())

    assert result["skipped"] == 1
    note = db_session.scalar(
        select(Notification).where(
            Notification.user_id == recipient.id,
            Notification.channel == NotificationChannel.EMAIL.value,
        )
    )
    assert note is not None
    assert note.status == NotificationStatus.SKIPPED.value
    assert "SMTP" in (note.error or "")
