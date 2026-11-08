from sqlalchemy import func, update

from app.core.config import settings
from app.models import User
from app.pilot_preflight import main
from app.services import preflight_service, worker_service


def test_preflight_blocks_demo_data_and_missing_workers(world, db_session):
    report = preflight_service.run_preflight(db_session)

    assert report["ready"] is False
    assert any("demo" in blocker.lower() for blocker in report["blockers"])
    assert any("stale/missing" in blocker.lower() for blocker in report["blockers"])
    assert main([]) == 1


def test_preflight_passes_production_ready_state(world, db_session, monkeypatch):
    db_session.execute(
        update(User).values(
            email=func.replace(User.email, "@skyline.dev", "@pilot.example")
        )
    )
    worker_service.record_heartbeat(db_session, "expiry")
    worker_service.record_heartbeat(db_session, "notifications")
    db_session.commit()

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "jwt_secret", "p" * 48)
    monkeypatch.setattr(settings, "cors_origins", "https://pilot.example.com")
    monkeypatch.setattr(settings, "app_public_url", "https://pilot.example.com")
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from", "ParkVanta <no-reply@example.com>")
    monkeypatch.setattr(settings, "metrics_token", "scrape-token")

    report = preflight_service.run_preflight(db_session)

    assert report["ready"] is True, report["blockers"]
    assert main([]) == 0
