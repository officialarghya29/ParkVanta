import json
import time
from datetime import UTC, datetime, timedelta

import redis

from app.core.config import settings

PLATE = "KA05SS1234"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_invitation(client, token: str) -> dict:
    arrival = datetime.now(UTC) + timedelta(minutes=10)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": "Live Visitor",
            "vehicle_registration": PLATE,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _ticket(client, token: str, property_id) -> str:
    response = client.post(
        "/api/v1/events/ticket",
        headers=auth(token),
        json={"property_id": str(property_id)},
    )
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


def test_stream_ticket_is_scoped_to_the_property(client, world, tokens):
    ticket = client.post(
        "/api/v1/events/ticket",
        headers=auth(tokens["resident"]),
        json={"property_id": str(world["property_id"])},
    )
    assert ticket.status_code == 200
    assert ticket.json()["ticket"]
    assert ticket.json()["expires_in"] > 0

    cross_tenant = client.post(
        "/api/v1/events/ticket",
        headers=auth(tokens["other_admin"]),
        json={"property_id": str(world["property_id"])},
    )
    assert cross_tenant.status_code == 403


def test_stream_rejects_invalid_ticket(client, world):
    response = client.get("/api/v1/events/stream?ticket=not-a-real-ticket-value")
    assert response.status_code == 401


def test_stream_opens_and_emits_connected_frame(client, world, tokens):
    ticket = _ticket(client, tokens["guard"], world["property_id"])

    with client.stream("GET", f"/api/v1/events/stream?ticket={ticket}") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        lines = response.iter_lines()
        assert next(lines) == ": connected"


def test_approval_publishes_realtime_event(client, world, tokens):
    invitation = _create_invitation(client, tokens["resident"])

    subscriber = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    pubsub = subscriber.pubsub()
    pubsub.subscribe(f"pv:events:{world['property_id']}")

    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text

    event = None
    deadline = time.time() + 5
    while time.time() < deadline:
        message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
        if message and message.get("type") == "message":
            event = json.loads(message["data"])
            break
    pubsub.close()

    assert event is not None, "expected an invitation.approved event on Redis"
    assert event["type"] == "invitation.approved"
    assert event["property_id"] == str(world["property_id"])
    assert event["data"]["invitation_id"] == invitation["id"]


def test_approval_is_retained_in_the_replay_stream(client, world, tokens):
    invitation = _create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text

    subscriber = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    entries = subscriber.xrange(f"pv:stream:{world['property_id']}")
    assert entries, "expected the property stream to retain frames"
    payloads = [json.loads(fields["payload"]) for _entry_id, fields in entries]
    assert any(item["type"] == "invitation.approved" for item in payloads)


def test_stream_replays_missed_events_from_last_event_id(client, world, tokens):
    invitation = _create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text

    ticket = _ticket(client, tokens["guard"], world["property_id"])
    seen: list[tuple[str, str]] = []
    with client.stream(
        "GET", f"/api/v1/events/stream?ticket={ticket}&last_event_id=0-0"
    ) as response:
        assert response.status_code == 200
        frame_id = ""
        for line in response.iter_lines():
            if line.startswith("id: "):
                frame_id = line[4:]
            elif line.startswith("event: "):
                seen.append((frame_id, line[7:]))
            if any(name == "invitation.approved" for _fid, name in seen):
                break

    assert any(name == "invitation.approved" for _fid, name in seen)
    assert all(frame_id for frame_id, _name in seen)
