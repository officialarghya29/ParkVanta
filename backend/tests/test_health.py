from sqlalchemy.exc import OperationalError

import app.main as main_module


class BrokenEngine:
    def connect(self):
        raise OperationalError("SELECT 1", {}, Exception("database down"))


def test_ready_returns_503_when_database_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(main_module, "engine", BrokenEngine())

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}
