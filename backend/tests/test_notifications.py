from sqlalchemy import select

from app.models import User
from app.services import notification_service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_notifications_are_scoped_and_have_read_state(client, world, tokens, db_session):
    resident = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    neighbour = db_session.scalar(select(User).where(User.email == world["neighbour_email"]))
    assert resident is not None and neighbour is not None

    first = notification_service.notify_user(
        db_session,
        organization_id=resident.organization_id,
        user_id=resident.id,
        title="Visitor approved",
        body="Your visitor pass is ready.",
    )
    notification_service.notify_user(
        db_session,
        organization_id=resident.organization_id,
        user_id=resident.id,
        title="Visitor arrived",
        body="Your visitor entered the society.",
    )
    db_session.commit()

    unread = client.get("/api/v1/notifications/unread-count", headers=_auth(tokens["resident"]))
    assert unread.status_code == 200
    assert unread.json()["count"] == 2

    listed = client.get("/api/v1/notifications?limit=10", headers=_auth(tokens["resident"]))
    assert listed.status_code == 200
    assert listed.json()["total"] == 2
    assert all(item["read_at"] is None for item in listed.json()["items"])

    marked = client.post(
        f"/api/v1/notifications/{first.id}/read", headers=_auth(tokens["resident"])
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["read_at"] is not None

    unread = client.get("/api/v1/notifications/unread-count", headers=_auth(tokens["resident"]))
    assert unread.json()["count"] == 1
    unread_only = client.get(
        "/api/v1/notifications?unread_only=true", headers=_auth(tokens["resident"])
    )
    assert unread_only.json()["total"] == 1

    cross_user = client.post(
        f"/api/v1/notifications/{first.id}/read", headers=_auth(tokens["neighbour"])
    )
    assert cross_user.status_code == 404

    marked_all = client.post("/api/v1/notifications/read-all", headers=_auth(tokens["resident"]))
    assert marked_all.status_code == 200
    unread = client.get("/api/v1/notifications/unread-count", headers=_auth(tokens["resident"]))
    assert unread.json()["count"] == 0
