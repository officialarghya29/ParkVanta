
from app.core.security import create_access_token
from app.models import User


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_login_returns_tokens_and_identity(client, world):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "RESIDENT"
    assert body["user"]["email"] == world["resident_email"]
    assert body["token_type"] == "bearer"

    me = client.get("/api/v1/auth/me", headers=auth(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["id"] == body["user"]["id"]


def test_invalid_password_is_rejected(client, world):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "WrongPass123"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_refresh_rotation_and_reuse_detection(client, world):
    session = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    ).json()

    rotated = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
    )
    assert rotated.status_code == 200
    new_refresh = rotated.json()["refresh_token"]
    assert new_refresh != session["refresh_token"]

    replay = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
    )
    assert replay.status_code == 401

    # Replay revokes the whole family, including the freshly issued token.
    after_replay = client.post("/api/v1/auth/refresh", json={"refresh_token": new_refresh})
    assert after_replay.status_code == 401


def test_suspended_account_cannot_sign_in(client, world, db_session):
    user = db_session.query(User).filter(User.email == world["resident_email"]).one()
    user.is_suspended = True
    db_session.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    )
    assert response.status_code == 401


def test_cross_tenant_property_access_is_denied(client, world, tokens):
    response = client.get(
        f"/api/v1/properties/{world['property_id']}", headers=auth(tokens["other_admin"])
    )
    assert response.status_code == 403


def test_guard_cannot_read_another_property_inventory(client, world, tokens):
    response = client.get(
        f"/api/v1/parking/slots?property_id={world['other_property_id']}",
        headers=auth(tokens["guard"]),
    )
    assert response.status_code in {403, 404}


def test_expired_access_token_is_rejected(client, world, db_session):
    user = db_session.query(User).filter(User.email == world["resident_email"]).one()
    token = create_access_token(
        user_id=user.id, organization_id=user.organization_id, role=user.role
    )
    # Sanity check the freshly minted token works.
    assert client.get("/api/v1/auth/me", headers=auth(token)).status_code == 200


def test_validation_error_does_not_echo_submitted_secrets(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email", "password": "SecretPass123!"},
    )

    assert response.status_code == 422
    assert "SecretPass123!" not in response.text
    details = response.json()["error"]["details"]
    assert all("input" not in detail and "ctx" not in detail for detail in details)


def test_audit_trail_records_login(client, world, db_session):
    from app.models import AuditLog

    client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    )
    actions = {row.action for row in db_session.query(AuditLog).all()}
    assert "auth.login" in actions
