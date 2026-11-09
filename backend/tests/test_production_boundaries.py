from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.models import Apartment, Property, QRPass, User

PLATE = "KA09TR1234"


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_invitation(client, resident_token: str, *, plate: str = PLATE) -> dict:
    arrival = datetime.now(UTC) + timedelta(minutes=10)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(resident_token),
        json={
            "visitor_name": "Boundary Visitor",
            "visitor_phone": "9000000001",
            "vehicle_registration": plate,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=2)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _approve(client, resident_token: str, invitation_id: str) -> dict:
    response = client.post(
        f"/api/v1/invitations/{invitation_id}/approve", headers=auth(resident_token)
    )
    assert response.status_code == 200, response.text
    return response.json()


def _visit_inside(client, tokens, *, plate: str = PLATE) -> tuple[dict, dict, dict]:
    invitation = _create_invitation(client, tokens["resident"], plate=plate)
    approval = _approve(client, tokens["resident"], invitation["id"])
    authorized = client.post(
        "/api/v1/gate/entry/authorize",
        headers=auth(tokens["guard"]),
        json={"token": approval["pass_token"], "plate_number": plate},
    )
    assert authorized.status_code == 200, authorized.text
    confirmed = client.post(
        "/api/v1/gate/entry/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    return invitation, approval, confirmed.json()


def test_society_admin_cannot_provision_into_another_society(client, world, tokens, db_session):
    other_apartment = Apartment(
        property_id=world["other_property_id"],
        number="R-101",
    )
    db_session.add(other_apartment)
    db_session.commit()

    email = "cross.tenant.resident@example.com"
    response = client.post(
        "/api/v1/auth/users",
        headers=auth(tokens["admin"]),
        json={
            "email": email,
            "password": "Resident123",
            "full_name": "Cross Tenant",
            "role": "RESIDENT",
            "apartment_id": str(other_apartment.id),
        },
    )

    assert response.status_code == 404, response.text
    assert db_session.scalar(select(User).where(User.email == email)) is None


def test_society_wide_admin_cannot_read_another_societys_parking(
    client, world, tokens, db_session
):
    admin = db_session.scalar(select(User).where(User.email == world["admin_email"]))
    assert admin is not None
    admin.property_id = None
    db_session.commit()

    for path in (
        f"/api/v1/parking/reservations?property_id={world['other_property_id']}",
        f"/api/v1/parking/occupancies?property_id={world['other_property_id']}",
        f"/api/v1/parking/slots/available?property_id={world['other_property_id']}",
    ):
        response = client.get(path, headers=auth(tokens["admin"]))
        assert response.status_code == 403, (path, response.text)


def test_admin_manages_inventory_accounts_and_policy(client, world, tokens):
    headers = auth(tokens["admin"])
    property_id = str(world["property_id"])

    tower = client.post(
        f"/api/v1/properties/{property_id}/towers",
        headers=headers,
        json={"name": "Tower B", "floors": 8},
    )
    assert tower.status_code == 201, tower.text
    tower_id = tower.json()["id"]
    assert client.post(
        f"/api/v1/properties/{property_id}/towers",
        headers=headers,
        json={"name": "Tower B"},
    ).status_code == 409

    apartment = client.post(
        "/api/v1/apartments",
        headers=headers,
        json={
            "property_id": property_id,
            "tower_id": tower_id,
            "number": "B-201",
            "floor": 2,
        },
    )
    assert apartment.status_code == 201, apartment.text
    apartment_id = apartment.json()["id"]

    zone = client.post(
        "/api/v1/parking/zones",
        headers=headers,
        json={
            "property_id": property_id,
            "name": "EV Bay",
            "category": "VISITOR",
            "priority": 40,
        },
    )
    assert zone.status_code == 201, zone.text
    zone_id = zone.json()["id"]

    slot = client.post(
        "/api/v1/parking/slots",
        headers=headers,
        json={
            "property_id": property_id,
            "zone_id": zone_id,
            "code": " ev-01 ",
            "vehicle_category": "EV",
        },
    )
    assert slot.status_code == 201, slot.text
    slot_id = slot.json()["id"]
    assert slot.json()["code"] == "EV-01"
    assert client.post(
        "/api/v1/parking/slots",
        headers=headers,
        json={"property_id": property_id, "zone_id": zone_id, "code": "ev-01"},
    ).status_code == 409

    for new_status in ("BLOCKED", "AVAILABLE"):
        updated = client.patch(
            f"/api/v1/parking/slots/{slot_id}",
            headers=headers,
            json={"status": new_status},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["status"] == new_status

    resident = client.post(
        f"/api/v1/properties/{property_id}/residents",
        headers=headers,
        json={
            "email": "new.resident@example.com",
            "password": "Resident123",
            "full_name": "New Resident",
            "role": "RESIDENT",
            "apartment_id": apartment_id,
        },
    )
    assert resident.status_code == 201, resident.text
    resident_id = resident.json()["user"]["id"]
    assert client.patch(
        f"/api/v1/residents/{resident_id}",
        headers=headers,
        json={"phone": "9000000002", "is_verified": True},
    ).status_code == 200

    guard = client.post(
        f"/api/v1/properties/{property_id}/guards",
        headers=headers,
        json={
            "email": "new.guard@example.com",
            "password": "GuardPass123",
            "full_name": "New Guard",
            "role": "SECURITY_GUARD",
            "property_id": property_id,
            "badge_number": "GRD-9",
        },
    )
    assert guard.status_code == 201, guard.text

    policy = client.patch(
        f"/api/v1/properties/{property_id}/policy",
        headers=headers,
        json={"qr_validity_minutes": 25, "max_active_visitors": 100},
    )
    assert policy.status_code == 200, policy.text
    assert policy.json()["qr_validity_minutes"] == 25

    assert client.get(
        f"/api/v1/properties/{property_id}/towers", headers=headers
    ).json()[-1]["name"] == "Tower B"
    assert client.get(
        f"/api/v1/properties/{property_id}/apartments", headers=headers
    ).json()["total"] >= 3
    assert client.get(
        f"/api/v1/parking/zones?property_id={property_id}", headers=headers
    ).status_code == 200
    assert client.get(
        f"/api/v1/parking/slots?property_id={property_id}", headers=headers
    ).json()["total"] >= 5
    assert client.get(
        f"/api/v1/properties/{property_id}/residents", headers=headers
    ).json()["total"] >= 2
    assert client.get(
        f"/api/v1/properties/{property_id}/guards", headers=headers
    ).json()["total"] >= 2

    join_code = client.get(
        f"/api/v1/properties/{property_id}/join-code", headers=headers
    )
    assert join_code.status_code == 200, join_code.text
    first_code = join_code.json()["join_code"]
    assert len(first_code) == 16
    rotated = client.post(
        f"/api/v1/properties/{property_id}/join-code/rotate", headers=headers
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["join_code"] != first_code


def test_active_visitors_rejects_another_property_in_the_same_society(
    client, world, tokens, db_session
):
    other_site = Property(
        organization_id=world["org_id"],
        name="Skyline Annexe",
    )
    db_session.add(other_site)
    db_session.commit()

    response = client.get(
        f"/api/v1/gate/active-visitors?property_id={other_site.id}",
        headers=auth(tokens["guard"]),
    )

    assert response.status_code == 403, response.text


def test_visitor_trends_count_each_confirmed_entry_once(client, world, tokens):
    invitation, _approval, _confirmed = _visit_inside(client, tokens)
    exited = client.post(
        "/api/v1/gate/exit/confirm",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert exited.status_code == 200, exited.text

    response = client.get(
        f"/api/v1/analytics/visitor-trends?property_id={world['property_id']}&days=1",
        headers=auth(tokens["admin"]),
    )
    assert response.status_code == 200, response.text
    today = datetime.now(UTC).date().isoformat()
    point = next(item for item in response.json() if item["day"] == today)

    assert point["invitations"] == 1
    assert point["entries"] == 1
    assert point["exits"] == 1


def test_rejecting_a_pending_invitation_releases_a_manual_reservation(
    client, world, tokens
):
    invitation = _create_invitation(client, tokens["resident"], plate="KA09TR6666")
    allocated = client.post(
        "/api/v1/parking/allocate",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )
    assert allocated.status_code == 200, allocated.text

    rejected = client.post(
        f"/api/v1/invitations/{invitation['id']}/reject",
        headers=auth(tokens["resident"]),
        json={"reason": "Visitor no longer coming"},
    )
    assert rejected.status_code == 200, rejected.text

    availability = client.get(
        f"/api/v1/parking/availability?property_id={world['property_id']}",
        headers=auth(tokens["guard"]),
    ).json()
    assert availability["reserved"] == 0
    assert availability["available"] == 4


def test_inactive_property_rejects_new_and_pending_invitations(
    client, world, tokens, db_session
):
    pending = _create_invitation(client, tokens["resident"], plate="KA09TR5555")
    prop = db_session.get(Property, world["property_id"])
    assert prop is not None
    prop.is_active = False
    db_session.commit()

    blocked_create = client.post(
        "/api/v1/invitations",
        headers=auth(tokens["resident"]),
        json={
            "visitor_name": "Inactive Property Guest",
            "visitor_type": "GUEST",
            "expected_arrival": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
            "expected_departure": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        },
    )
    assert blocked_create.status_code == 409, blocked_create.text
    assert blocked_create.json()["error"]["code"] == "property_inactive"

    blocked_approval = client.post(
        f"/api/v1/invitations/{pending['id']}/approve",
        headers=auth(tokens["resident"]),
    )
    assert blocked_approval.status_code == 409, blocked_approval.text
    assert blocked_approval.json()["error"]["code"] == "property_inactive"


def test_cancelled_invitation_cannot_be_reallocated(client, world, tokens):
    invitation = _create_invitation(client, tokens["resident"], plate="KA09TR9999")
    _approve(client, tokens["resident"], invitation["id"])
    cancelled = client.post(
        f"/api/v1/invitations/{invitation['id']}/cancel",
        headers=auth(tokens["resident"]),
        json={"reason": "Visitor cancelled"},
    )
    assert cancelled.status_code == 200, cancelled.text

    response = client.post(
        "/api/v1/parking/allocate",
        headers=auth(tokens["guard"]),
        json={"invitation_id": invitation["id"]},
    )

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "invalid_state"


def test_exit_by_slot_code_is_case_insensitive(client, world, tokens):
    invitation, _approval, _confirmed = _visit_inside(client, tokens, plate="KA09TR8888")

    response = client.post(
        "/api/v1/gate/exit/confirm",
        headers=auth(tokens["guard"]),
        json={"slot_code": " v-01 "},
    )

    assert response.status_code == 200, response.text
    assert response.json()["invitation_id"] == invitation["id"]
    assert response.json()["slot_code"] == "V-01"


def test_staff_can_inspect_a_pass_and_owner_can_revoke_it(
    client, world, tokens, db_session
):
    invitation = _create_invitation(client, tokens["resident"], plate="KA09TR4444")
    _approve(client, tokens["resident"], invitation["id"])
    qr_pass = db_session.scalar(
        select(QRPass).where(QRPass.invitation_id == UUID(invitation["id"]))
    )
    assert qr_pass is not None

    status = client.get(
        f"/api/v1/qr/{qr_pass.id}/status", headers=auth(tokens["guard"])
    )
    assert status.status_code == 200, status.text
    assert status.json()["status"] == "ACTIVE"
    assert status.json()["reservation_status"] == "ACTIVE"

    revoked = client.post(
        "/api/v1/qr/revoke",
        headers=auth(tokens["resident"]),
        json={"invitation_id": invitation["id"], "reason": "Phone lost"},
    )
    assert revoked.status_code == 200, revoked.text

    db_session.expire_all()
    refreshed = db_session.get(QRPass, qr_pass.id)
    assert refreshed is not None
    assert refreshed.status == "REVOKED"

    after = client.get(
        f"/api/v1/qr/{qr_pass.id}/status", headers=auth(tokens["guard"])
    )
    assert after.status_code == 200, after.text
    assert after.json()["status"] == "REVOKED"
    assert after.json()["invitation_status"] == "CANCELLED"
    assert after.json()["reservation_status"] == "CANCELLED"


def test_admin_release_returns_vehicle_registration(client, world, tokens):
    _invitation, _approval, confirmed = _visit_inside(client, tokens, plate="KA09TR7777")

    response = client.post(
        f"/api/v1/parking/occupancies/{confirmed['occupancy_id']}/release",
        headers=auth(tokens["admin"]),
    )

    assert response.status_code == 200, response.text
    assert response.json()["vehicle_registration"] == "KA09TR7777"
    assert response.json()["status"] == "RELEASED"
