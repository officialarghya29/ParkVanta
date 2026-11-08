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


def test_visitor_window_rejects_invalid_clock_values(client, world, tokens):
    response = client.patch(
        f"/api/v1/properties/{world['property_id']}/policy",
        headers=auth(tokens["admin"]),
        json={"visitor_window_start": "25:00"},
    )
    assert response.status_code == 422
