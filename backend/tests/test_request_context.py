def test_request_id_is_generated_and_safe_values_are_echoed(client):
    generated = client.get("/health")
    assert generated.status_code == 200
    assert len(generated.headers["x-request-id"]) == 32

    echoed = client.get("/health", headers={"X-Request-ID": "trace-abc-12345"})
    assert echoed.headers["x-request-id"] == "trace-abc-12345"

    rejected = client.get("/health", headers={"X-Request-ID": "bad id"})
    assert rejected.headers["x-request-id"] not in {"bad id", ""}
    assert len(rejected.headers["x-request-id"]) == 32
