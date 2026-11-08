import socketserver
import threading
from contextlib import contextmanager

from sqlalchemy import select

from app.core.config import settings
from app.core.time import utcnow
from app.models import Notification, User
from app.models.enums import NotificationChannel, NotificationStatus
from app.services import mail_service, notification_service
from app.workers import notifications as worker


class _RecordingSMTPHandler(socketserver.StreamRequestHandler):
    """Minimal SMTP conversation sufficient for `smtplib.send_message`."""

    def handle(self) -> None:
        self.wfile.write(b"220 parkvanta-test ESMTP\r\n")
        while True:
            line = self.rfile.readline()
            if not line:
                return
            verb = line.decode("ascii", "replace").split(" ", 1)[0].strip().upper()
            if verb in {"EHLO", "HELO"}:
                self.wfile.write(b"250-parkvanta-test\r\n250 OK\r\n")
            elif verb in {"MAIL", "RCPT", "RSET", "NOOP"}:
                self.wfile.write(b"250 OK\r\n")
            elif verb == "DATA":
                self.wfile.write(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                chunks: list[bytes] = []
                while True:
                    data_line = self.rfile.readline()
                    if data_line in {b".\r\n", b".\n", b""}:
                        break
                    chunks.append(data_line)
                self.server.messages.append(b"".join(chunks).decode("utf-8", "replace"))
                self.wfile.write(b"250 OK: queued\r\n")
            elif verb == "QUIT":
                self.wfile.write(b"221 Bye\r\n")
                return
            else:
                self.wfile.write(b"250 OK\r\n")


class _RecordingSMTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _RecordingSMTPHandler)
        self.messages: list[str] = []

    @property
    def port(self) -> int:
        return int(self.server_address[1])


@contextmanager
def recording_smtp_server():
    server = _RecordingSMTPServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_outbox_delivers_through_a_real_smtp_server(client, world, tokens, db_session, monkeypatch):
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

    with recording_smtp_server() as smtp:
        monkeypatch.setattr(settings, "smtp_host", "127.0.0.1")
        monkeypatch.setattr(settings, "smtp_port", smtp.port)
        monkeypatch.setattr(settings, "smtp_use_tls", False)
        monkeypatch.setattr(settings, "smtp_use_ssl", False)
        monkeypatch.setattr(settings, "smtp_username", "")
        result = worker.dispatch_notifications(db_session, now=utcnow())
        replay = worker.dispatch_notifications(db_session, now=utcnow())

    assert result == {"sent": 1, "skipped": 0, "failed": 0, "retrying": 0}
    assert replay["sent"] == 0
    assert len(smtp.messages) == 1
    raw = smtp.messages[0]
    assert f"To: {world['resident_email']}" in raw
    assert "[ParkVanta] Visitor pass issued" in raw
    assert "Your visitor pass is ready." in raw
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
