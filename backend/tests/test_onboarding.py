def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_join_code_lookup_registration_and_rotation(client, world, tokens):
    code_response = client.get(
        f"/api/v1/properties/{world['property_id']}/join-code",
        headers=_auth(tokens["admin"]),
    )
    assert code_response.status_code == 200, code_response.text
    join_code = code_response.json()["join_code"]
    assert len(join_code) == 16

    lookup = client.get(f"/api/v1/public/join/{join_code}")
    assert lookup.status_code == 200, lookup.text
    payload = lookup.json()
    assert payload["property_id"] == str(world["property_id"])
    assert payload["name"] == "Skyline Residency"
    assert {apartment["number"] for apartment in payload["apartments"]} == {"A-101", "A-102"}
    apartment = next(item for item in payload["apartments"] if item["number"] == "A-101")
    assert apartment["tower_name"] == "Tower A"

    registration = client.post(
        "/api/v1/auth/register",
        json={
            "email": "new.resident@example.com",
            "password": "Resident123",
            "full_name": "New Resident",
            "phone": "9876543210",
            "property_id": payload["property_id"],
            "apartment_id": apartment["id"],
        },
    )
    assert registration.status_code == 201, registration.text
    resident_id = registration.json()["id"]

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "new.resident@example.com", "password": "Resident123"},
    )
    assert login.status_code == 200, login.text
    profile = client.get("/api/v1/residents/me", headers=_auth(login.json()["access_token"]))
    assert profile.status_code == 200
    assert profile.json()["is_verified"] is False

    verified = client.patch(
        f"/api/v1/residents/{resident_id}",
        headers=_auth(tokens["admin"]),
        json={"is_verified": True},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["is_verified"] is True

    rotated = client.post(
        f"/api/v1/properties/{world['property_id']}/join-code/rotate",
        headers=_auth(tokens["admin"]),
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["join_code"] != join_code
    assert client.get(f"/api/v1/public/join/{join_code}").status_code == 404
    assert client.get(f"/api/v1/public/join/{rotated.json()['join_code']}").status_code == 200


def test_only_admins_can_read_join_code(client, world, tokens):
    forbidden = client.get(
        f"/api/v1/properties/{world['property_id']}/join-code",
        headers=_auth(tokens["guard"]),
    )
    assert forbidden.status_code == 403
    assert client.get("/api/v1/public/join/DOES-NOT-EXIST").status_code == 404
