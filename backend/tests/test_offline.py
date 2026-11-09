from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

from app.database.session import SessionLocal
from app.models import AuditLog, EntryExitEvent, OfflineGateAction, User
from app.schemas.offline import OfflineGateActionIn
from app.services import offline_service

PLATE = "KA07OF7788"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _approved_invitation(client, tokens):
    arrival = datetime.now(UTC) + timedelta(minutes=10)
    invitation = client.post(
        "/api/v1/invitations",
        headers=auth(tokens["resident"]),
        json={
            "visitor_name": "Offline Visitor",
            "vehicle_registration": PLATE,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=2)).isoformat(),
        },
    ).json()
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text
    return invitation, approval.json()["pass_token"]


def _entered_visit(client, tokens):
    invitation, pass_token = _approved_invitation(client, tokens)
    authorized = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": pass_token, "plate_number": PLATE},
    )
    assert authorized.status_code == 200, authorized.text
    confirmed = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["slot_status"] == "OCCUPIED"
    return invitation


def _payload(property_id, actions, device_id="gate-device-01"):
    return {
        "property_id": str(property_id),
        "device_id": device_id,
        "actions": actions,
    }


def _exit_action(invitation_id, client_event_id="offline-exit-0001", recorded_at=None):
    return {
        "client_event_id": client_event_id,
        "action": "EXIT_CONFIRM",
        "invitation_id": str(invitation_id),
        "recorded_at": (recorded_at or datetime.now(UTC)).isoformat(),
    }


def test_offline_exit_is_applied_once_and_replay_is_idempotent(
    client, world, tokens, db_session
):
    invitation = _entered_visit(client, tokens)
    payload = _payload(world["property_id"], [_exit_action(invitation["id"])])

    first = client.post(
        "/api/v1/gate/offline/reconcile", headers=auth(tokens["guard"]), json=payload
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["applied"] == 1
    assert body["results"][0]["status"] == "applied"
    assert body["results"][0]["result"]["slot_code"] == "V-01"

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["occupied"] == 0
    assert availability["available"] == 4

    replay = client.post(
        "/api/v1/gate/offline/reconcile", headers=auth(tokens["guard"]), json=payload
    )
    assert replay.status_code == 200
    assert replay.json()["duplicates"] == 1
    assert replay.json()["applied"] == 0

    # Exactly one release event and one ledger row survive the replay.
    assert (
        db_session.query(OfflineGateAction)
        .filter(OfflineGateAction.client_event_id == "offline-exit-0001")
        .count()
        == 1
    )
    assert (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "gate.exit_confirmed")
        .count()
        == 1
    )


def test_offline_entry_confirmation_requires_online_authorization(
    client, world, tokens, db_session
):
    invitation, _pass_token = _approved_invitation(client, tokens)
    payload = _payload(
        world["property_id"],
        [
            {
                "client_event_id": "offline-entry-0001",
                "action": "ENTRY_CONFIRM",
                "invitation_id": invitation["id"],
                "recorded_at": datetime.now(UTC).isoformat(),
            }
        ],
    )

    response = client.post(
        "/api/v1/gate/offline/reconcile", headers=auth(tokens["guard"]), json=payload
    )
    assert response.status_code == 200, response.text
    assert response.json()["rejected"] == 1
    assert response.json()["results"][0]["code"] == "authorization_required"
    assert db_session.query(OfflineGateAction).count() == 0

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["reserved"] == 1


def test_offline_entry_confirmation_accepts_an_authorized_pass(client, world, tokens):
    invitation, pass_token = _approved_invitation(client, tokens)
    authorized = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": pass_token, "plate_number": PLATE},
    )
    assert authorized.status_code == 200, authorized.text

    response = client.post(
        "/api/v1/gate/offline/reconcile",
        headers=auth(tokens["guard"]),
        json=_payload(
            world["property_id"],
            [
                {
                    "client_event_id": "offline-entry-0002",
                    "action": "ENTRY_CONFIRM",
                    "invitation_id": invitation["id"],
                    "recorded_at": datetime.now(UTC).isoformat(),
                }
            ],
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["applied"] == 1
    assert response.json()["results"][0]["result"]["slot_code"] == "V-01"


def test_offline_exit_respects_explicit_property_for_society_admin(
    client, world, tokens, db_session
):
    invitation = _entered_visit(client, tokens)

    # A society-wide admin is not assigned to one property; the reconcile
    # request is the only source of the target property.
    admin = db_session.query(User).filter(User.email == world["admin_email"]).one()
    admin.property_id = None
    db_session.commit()
    admin_token = client.post(
        "/api/v1/auth/login",
        json={"email": world["admin_email"], "password": "TestPass123"},
    ).json()["access_token"]

    response = client.post(
        "/api/v1/gate/offline/reconcile",
        headers=auth(admin_token),
        json=_payload(world["property_id"], [_exit_action(invitation["id"])]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["applied"] == 1
    assert response.json()["results"][0]["result"]["slot_code"] == "V-01"


def test_offline_action_with_future_device_clock_is_rejected(client, world, tokens):
    invitation = _entered_visit(client, tokens)
    future = datetime.now(UTC) + timedelta(hours=1)
    response = client.post(
        "/api/v1/gate/offline/reconcile",
        headers=auth(tokens["guard"]),
        json=_payload(world["property_id"], [_exit_action(invitation["id"], recorded_at=future)]),
    )
    assert response.status_code == 200
    assert response.json()["rejected"] == 1
    assert response.json()["results"][0]["code"] == "clock_mismatch"


def test_concurrent_replay_of_one_offline_action_applies_once(world, db_session):
    action = OfflineGateActionIn(
        client_event_id="offline-override-concurrent-0001",
        action="MANUAL_OVERRIDE",
        reason="Resident confirmed by intercom during network outage",
        direction="ENTRY",
        recorded_at=datetime.now(UTC),
    )
    barrier = Barrier(6)
    outcomes: list[str] = []

    def reconcile_once() -> None:
        db = SessionLocal()
        try:
            guard = db.get(User, world["guard_id"])
            barrier.wait(timeout=10)
            result = offline_service.reconcile(
                db,
                guard=guard,
                property_id=world["property_id"],
                device_id="gate-device-01",
                actions=[action],
                ip_address="127.0.0.1",
            )
            outcomes.append(result[0]["status"])
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: reconcile_once(), range(6)))

    assert outcomes.count("applied") == 1
    assert outcomes.count("duplicate") == 5

    db_session.expire_all()
    assert db_session.query(OfflineGateAction).count() == 1
    assert (
        db_session.query(EntryExitEvent)
        .filter(EntryExitEvent.decision == "MANUAL_OVERRIDE")
        .count()
        == 1
    )
    assert db_session.query(AuditLog).filter(AuditLog.action == "gate.manual_override").count() == 1


def test_offline_reconcile_is_property_scoped(client, world, tokens):
    invitation = _entered_visit(client, tokens)
    response = client.post(
        "/api/v1/gate/offline/reconcile",
        headers=auth(tokens["other_admin"]),
        json=_payload(world["property_id"], [_exit_action(invitation["id"])]),
    )
    assert response.status_code == 403
