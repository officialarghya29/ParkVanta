from datetime import UTC, datetime, timedelta

from app.models import AuditLog, EntryExitEvent, ParkingOccupancy, ParkingSlot

PLATE = "KA01AB1234"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_invitation(client, token, *, plate=PLATE, minutes_ahead=10, duration=120):
    arrival = datetime.now(UTC) + timedelta(minutes=minutes_ahead)
    departure = arrival + timedelta(minutes=duration)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": "Rahul Sharma",
            "visitor_phone": "9876543210",
            "vehicle_registration": plate,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "purpose": "Family visit",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": departure.isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_pedestrian_invitation(client, token):
    arrival = datetime.now(UTC) + timedelta(minutes=10)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": "Pedestrian Guest",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def approve_and_authorize_pedestrian(client, tokens, invitation_id):
    approval = client.post(
        f"/api/v1/invitations/{invitation_id}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text
    authorized = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": approval.json()["pass_token"]},
    )
    assert authorized.status_code == 200, authorized.text


def test_pedestrian_entry_confirmation_is_valid_and_idempotent(client, world, tokens, db_session):
    invitation = create_pedestrian_invitation(client, tokens["resident"])
    approve_and_authorize_pedestrian(client, tokens, invitation["id"])

    first = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert first.status_code == 200, first.text
    assert first.json()["occupancy_id"] is None
    assert first.json()["already_confirmed"] is False

    repeated = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["already_confirmed"] is True
    assert (
        db_session.query(EntryExitEvent)
        .filter(
            EntryExitEvent.invitation_id == invitation["id"],
            EntryExitEvent.decision == "CONFIRMED",
        )
        .count()
        == 1
    )


def test_cancellation_blocks_pedestrian_entry_confirmation(client, world, tokens):
    invitation = create_pedestrian_invitation(client, tokens["resident"])
    approve_and_authorize_pedestrian(client, tokens, invitation["id"])

    cancelled = client.post(
        f"/api/v1/invitations/{invitation['id']}/cancel",
        headers=auth(tokens["resident"]),
        json={"reason": "Visitor cancelled after authorization"},
    )
    assert cancelled.status_code == 200, cancelled.text

    blocked = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "invalid_state"


def test_complete_visitor_parking_lifecycle(client, world, tokens, db_session):
    invitation = create_invitation(client, tokens["resident"])
    assert invitation["status"] == "PENDING"

    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text
    approved = approval.json()
    pass_token = approved["pass_token"]
    assert approved["parking_slot_code"] == "V-01"

    # The resident can open the visitor-safe pass view.
    public_pass = client.get(f"/api/v1/qr/pass/{pass_token}")
    assert public_pass.status_code == 200
    assert public_pass.json()["parking_slot_code"] == "V-01"
    assert "phone" not in public_pass.text

    verification = client.post(
        "/api/v1/qr/verify",
        headers=auth(tokens["guard"]),
        json={"token": pass_token, "plate_number": PLATE},
    )
    assert verification.status_code == 200
    assert verification.json()["allowed"] is True

    entry = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": pass_token, "plate_number": PLATE},
    )
    assert entry.status_code == 200, entry.text
    assert entry.json()["parking_slot_code"] == "V-01"

    # A single-use pass cannot authorize a second entry.
    duplicate = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": pass_token, "plate_number": PLATE},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "already_used"

    confirmation = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert confirmation.status_code == 200, confirmation.text
    assert confirmation.json()["slot_status"] == "OCCUPIED"
    occupancy_id = confirmation.json()["occupancy_id"]
    assert occupancy_id is not None

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["occupied"] == 1
    assert availability["reserved"] == 0

    active = client.get("/api/v1/gate/active-visitors", headers=auth(tokens["guard"])).json()
    assert len(active) == 1
    assert active[0]["vehicle_registration"] == PLATE

    exit_response = client.post(
        "/api/v1/gate/exit/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert exit_response.status_code == 200, exit_response.text
    assert exit_response.json()["duration_minutes"] >= 0

    repeated_exit = client.post(
        "/api/v1/gate/exit/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert repeated_exit.status_code == 409
    assert repeated_exit.json()["error"]["code"] == "already_exited"

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["occupied"] == 0
    assert availability["available"] == 4

    final = client.get(
        f"/api/v1/invitations/{invitation['id']}", headers=auth(tokens["resident"])
    ).json()
    assert final["status"] == "COMPLETED"
    assert final["pass_status"] == "CONSUMED"

    # Database invariants: one occupancy, released; slot free; audit trail complete.
    occupancy = db_session.get(ParkingOccupancy, occupancy_id)
    assert occupancy.status == "RELEASED"
    slot = db_session.get(ParkingSlot, world["slot_id"])
    assert slot.status == "AVAILABLE"
    actions = {row.action for row in db_session.query(AuditLog).all()}
    assert {
        "invitation.created",
        "invitation.approved",
        "gate.entry_authorized",
        "gate.entry_confirmed",
        "gate.exit_confirmed",
    }.issubset(actions)
    assert db_session.query(EntryExitEvent).count() >= 3


def test_entry_confirmation_requires_online_authorization(client, world, tokens):
    invitation = create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 200, approval.text

    confirmation = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert confirmation.status_code == 409
    assert confirmation.json()["error"]["code"] == "authorization_required"

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["reserved"] == 1
    assert availability["occupied"] == 0


def test_vehicle_mismatch_is_reported(client, world, tokens):
    invitation = create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    ).json()

    result = client.post(
        "/api/v1/qr/verify",
        headers=auth(tokens["guard"]),
        json={"token": approval["pass_token"], "plate_number": "KA01AB9999"},
    )
    assert result.status_code == 200
    assert result.json()["allowed"] is False
    assert result.json()["reason_code"] == "vehicle_mismatch"

    blocked = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": approval["pass_token"], "plate_number": "KA01AB9999"},
    )
    assert blocked.status_code == 403
    invitation_row = db_session_invitation(client, tokens["resident"], invitation["id"])
    assert invitation_row["status"] == "APPROVED"


def db_session_invitation(client, token, invitation_id):
    return client.get(f"/api/v1/invitations/{invitation_id}", headers=auth(token)).json()


def test_cancellation_revokes_pass_and_releases_slot(client, world, tokens):
    invitation = create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    ).json()

    cancel = client.post(
        f"/api/v1/invitations/{invitation['id']}/cancel",
        headers=auth(tokens["resident"]),
        json={"reason": "Guest cancelled the trip"},
    )
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "CANCELLED"
    assert cancel.json()["pass_status"] == "REVOKED"

    verify = client.post(
        "/api/v1/qr/verify",
        headers=auth(tokens["guard"]),
        json={"token": approval["pass_token"], "plate_number": PLATE},
    ).json()
    assert verify["allowed"] is False
    assert verify["reason_code"] == "revoked"

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["reserved"] == 0
    assert availability["available"] == 4


def test_inactive_property_blocks_pass_verification(client, world, tokens, db_session):
    from app.models import Property

    invitation = create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    ).json()
    prop = db_session.get(Property, world["property_id"])
    prop.is_active = False
    db_session.commit()

    result = client.post(
        "/api/v1/qr/verify",
        headers=auth(tokens["guard"]),
        json={"token": approval["pass_token"], "plate_number": PLATE},
    )
    assert result.status_code == 200
    assert result.json()["reason_code"] == "property_inactive"


def test_no_slot_available_blocks_approval(client, world, tokens, db_session):
    slot = db_session.get(ParkingSlot, world["slot_id"])
    slot.status = "MAINTENANCE"
    db_session.commit()

    invitation = create_invitation(client, tokens["resident"])
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    )
    assert approval.status_code == 409
    assert approval.json()["error"]["code"] == "no_slot_available"

    still_pending = client.get(
        f"/api/v1/invitations/{invitation['id']}", headers=auth(tokens["resident"])
    ).json()
    assert still_pending["status"] == "PENDING"


def test_resident_cannot_approve_another_residents_invitation(client, world, tokens):
    invitation = create_invitation(client, tokens["resident"])
    response = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["neighbour"])
    )
    assert response.status_code == 403


def test_resident_only_sees_own_invitations(client, world, tokens, db_session):
    own = create_invitation(client, tokens["resident"])
    other = create_invitation(client, tokens["neighbour"], plate="KA02CD5678")

    listing = client.get("/api/v1/invitations", headers=auth(tokens["resident"])).json()
    ids = {item["id"] for item in listing["items"]}
    assert own["id"] in ids
    assert other["id"] not in ids

    guard_listing = client.get("/api/v1/invitations", headers=auth(tokens["guard"])).json()
    guard_ids = {item["id"] for item in guard_listing["items"]}
    assert {own["id"], other["id"]}.issubset(guard_ids)


def test_manual_override_rejects_an_unknown_invitation(client, world, tokens):
    from uuid import uuid4

    response = client.post(
        "/api/v1/gate/manual-override",
        headers=auth(tokens["guard"]),
        json={
            "reason": "Resident confirmed by intercom, pass token not working",
            "direction": "ENTRY",
            "invitation_id": str(uuid4()),
        },
    )
    assert response.status_code == 404


def test_manual_override_requires_reason_and_is_audited(client, world, tokens, db_session):
    short_reason = client.post(
        "/api/v1/gate/manual-override",
        headers=auth(tokens["guard"]),
        json={"reason": "short", "direction": "ENTRY"},
    )
    assert short_reason.status_code == 422

    response = client.post(
        "/api/v1/gate/manual-override",
        headers=auth(tokens["guard"]),
        json={
            "reason": "Resident confirmed by intercom, pass token not working",
            "direction": "ENTRY",
            "plate_number": PLATE,
        },
    )
    assert response.status_code == 200, response.text
    event_id = response.json()["event_id"]

    from app.models import AuditLog

    assert event_id
    actions = {row.action for row in db_session.query(AuditLog).all()}
    assert "gate.manual_override" in actions
