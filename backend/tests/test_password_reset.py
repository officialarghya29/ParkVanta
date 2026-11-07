from urllib.parse import parse_qs, urlparse

from app.services import mail_service


def test_password_reset_sends_a_real_link_and_rotates_password(client, world, monkeypatch):
    sent: dict[str, str] = {}

    def fake_send_email(*, to: str, subject: str, body: str) -> None:
        sent.update({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(mail_service, "send_email", fake_send_email)

    requested = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": world["resident_email"]},
    )
    assert requested.status_code == 202, requested.text
    assert sent["to"] == world["resident_email"]
    assert sent["subject"] == "Reset your ParkVanta password"

    link = next(
        word for word in sent["body"].split() if word.startswith("http") and "reset-password" in word
    )
    token = parse_qs(urlparse(link).query)["token"][0]
    assert len(token) >= 16

    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "ChangedPass456"},
    )
    assert reset.status_code == 200, reset.text

    old_login = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "ChangedPass456"},
    )
    assert new_login.status_code == 200, new_login.text


def test_password_reset_does_not_send_for_unknown_email(client, monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(
        mail_service,
        "send_email",
        lambda **_: sent.append("called"),
    )

    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "nobody@example.com"},
    )
    assert response.status_code == 202
    assert sent == []
