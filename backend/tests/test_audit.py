def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_audit_console_is_society_scoped_and_role_protected(client, tokens):
    admin = client.get("/api/v1/audit-logs?limit=50", headers=auth(tokens["admin"]))
    assert admin.status_code == 200, admin.text
    body = admin.json()
    assert body["total"] > 0
    assert len(body["items"]) <= 50
    assert body["items"][0]["created_at"]
    assert body["items"][0]["actor_name"]
    admin_ids = {item["id"] for item in body["items"]}

    assert client.get("/api/v1/audit-logs", headers=auth(tokens["manager"])).status_code == 403
    assert client.get("/api/v1/audit-logs", headers=auth(tokens["guard"])).status_code == 403
    assert client.get("/api/v1/audit-logs", headers=auth(tokens["resident"])).status_code == 403

    other = client.get("/api/v1/audit-logs?limit=50", headers=auth(tokens["other_admin"]))
    assert other.status_code == 200, other.text
    other_ids = {item["id"] for item in other.json()["items"]}
    assert admin_ids.isdisjoint(other_ids)


def test_audit_console_filters_and_paginates(client, tokens):
    first = client.get(
        "/api/v1/audit-logs?action=auth.login&limit=2&offset=0",
        headers=auth(tokens["admin"]),
    )
    assert first.status_code == 200, first.text
    page = first.json()
    assert page["total"] >= 2
    assert len(page["items"]) == 2
    assert all(item["action"] == "auth.login" for item in page["items"])

    second = client.get(
        "/api/v1/audit-logs?action=auth.login&limit=2&offset=2",
        headers=auth(tokens["admin"]),
    )
    assert second.status_code == 200, second.text
    assert {item["id"] for item in page["items"]}.isdisjoint(
        {item["id"] for item in second.json()["items"]}
    )

    empty = client.get(
        "/api/v1/audit-logs?action=does.not.exist",
        headers=auth(tokens["admin"]),
    )
    assert empty.status_code == 200
    assert empty.json()["total"] == 0


def test_audit_console_rejects_an_inverted_time_window(client, tokens):
    response = client.get(
        "/api/v1/audit-logs?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z",
        headers=auth(tokens["admin"]),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
