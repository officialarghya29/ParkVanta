from datetime import UTC, datetime, timedelta


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_visitor_window_supports_overnight_hours(client, world, tokens):
    response = client.patch(
        f"/api/v1/properties/{world['property_id']}/policy",
        headers=auth(tokens["admin"]),
        json={"visitor_window_start": "22:00", "visitor_window_end": "06:00"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["visitor_window_start"] == "22:00"
    assert response.json()["visitor_window_end"] == "06:00"

    equal = client.patch(
        f"/api/v1/properties/{world['property_id']}/policy",
        headers=auth(tokens["admin"]),
        json={"visitor_window_start": "10:00", "visitor_window_end": "10:00"},
    )
    assert equal.status_code == 422


def test_vehicle_required_policy_blocks_pedestrian_entry(client, world, tokens):
    policy = client.patch(
        f"/api/v1/properties/{world['property_id']}/policy",
        headers=auth(tokens["admin"]),
        json={"require_vehicle_for_entry": True},
    )
    assert policy.status_code == 200, policy.text

    arrival = datetime.now(UTC) + timedelta(minutes=10)
    invitation = client.post(
        "/api/v1/invitations",
        headers=auth(tokens["resident"]),
        json={
            "visitor_name": "Pedestrian Guest",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=1)).isoformat(),
        },
    )
    assert invitation.status_code == 201, invitation.text
    approval = client.post(
        f"/api/v1/invitations/{invitation.json()['id']}/approve",
        headers=auth(tokens["resident"]),
    )
    assert approval.status_code == 200, approval.text

    verdict = client.post(
        "/api/v1/qr/verify",
        headers=auth(tokens["guard"]),
        json={"token": approval.json()["pass_token"]},
    )
    assert verdict.status_code == 200, verdict.text
    assert verdict.json()["allowed"] is False
    assert verdict.json()["reason_code"] == "vehicle_required"


def test_slot_codes_are_case_insensitive_and_vehicle_class_is_validated(client, world, tokens):
    zones = client.get(
        f"/api/v1/parking/zones?property_id={world['property_id']}",
        headers=auth(tokens["admin"]),
    ).json()
    zone_id = next(zone["id"] for zone in zones if zone["name"] == "Visitor Bay")

    duplicate = client.post(
        "/api/v1/parking/slots",
        headers=auth(tokens["admin"]),
        json={
            "property_id": str(world["property_id"]),
            "zone_id": zone_id,
            "code": "v-01",
            "vehicle_category": "ANY",
        },
    )
    assert duplicate.status_code == 409

    created = client.post(
        "/api/v1/parking/slots",
        headers=auth(tokens["admin"]),
        json={
            "property_id": str(world["property_id"]),
            "zone_id": zone_id,
            "code": "v-99",
            "vehicle_category": "ANY",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["code"] == "V-99"

    invalid = client.patch(
        f"/api/v1/parking/slots/{created.json()['id']}",
        headers=auth(tokens["admin"]),
        json={"vehicle_category": "SPACESHIP"},
    )
    assert invalid.status_code == 422


def test_visitor_window_rejects_invalid_clock_values(client, world, tokens):
    response = client.patch(
        f"/api/v1/properties/{world['property_id']}/policy",
        headers=auth(tokens["admin"]),
        json={"visitor_window_start": "25:00"},
    )
    assert response.status_code == 422
