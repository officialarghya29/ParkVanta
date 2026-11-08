from datetime import UTC, datetime, timedelta

from sqlalchemy import event

from app.database.session import engine

PLATE = "KA01AB1234"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_invitation(client, token, index: int) -> dict:
    arrival = datetime.now(UTC) + timedelta(minutes=10 + index)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": f"Visitor {index}",
            "visitor_phone": f"90000000{index:02d}",
            "vehicle_registration": f"KA01AB{1000 + index}",
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "purpose": "Efficiency fixture",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=2)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def count_queries(callable_):
    statements: list[str] = []

    def record(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", record)
    try:
        result = callable_()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements), result


def test_invitation_list_uses_bounded_queries(client, tokens):
    for index in range(6):
        create_invitation(client, tokens["resident"], index)

    queries, response = count_queries(
        lambda: client.get("/api/v1/invitations?limit=20", headers=auth(tokens["resident"]))
    )

    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 6
    # Auth, count, page and seven batched lookups; independent of page size.
    assert queries <= 14, f"invitation list used {queries} queries"


def test_analytics_overview_uses_bounded_queries(client, world, tokens):
    queries, response = count_queries(
        lambda: client.get(
            f"/api/v1/analytics/overview?property_id={world['property_id']}",
            headers=auth(tokens["admin"]),
        )
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_slots"] == 4
    assert body["available_slots"] == 4
    # Auth, property authorization and one aggregate query.
    assert queries <= 6, f"analytics overview used {queries} queries"
