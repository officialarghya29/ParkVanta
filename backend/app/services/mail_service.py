import smtplib
from email.message import EmailMessage

from app.core.config import settings


class MailNotConfigured(RuntimeError):
    """Raised when no SMTP transport has been provisioned."""


class MailDeliveryError(RuntimeError):
    """Raised when the configured SMTP transport rejects or drops a message."""


def send_email(*, to: str, subject: str, body: str) -> None:
    """Send a plain-text transactional email through the configured SMTP relay."""
    if not settings.email_configured:
        raise MailNotConfigured("SMTP is not configured")

    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        if settings.smtp_use_ssl:
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=10
            )
        else:
            client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
        with client:
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                client.starttls()
            if settings.smtp_username:
                client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise MailDeliveryError("SMTP delivery failed") from exc
