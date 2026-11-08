from datetime import timedelta

from sqlalchemy import select

from app.core.config import settings
from app.core.time import utcnow
from app.models import (
    Invitation,
    Notification,
    ParkingOccupancy,
    ParkingReservation,
    RealtimeEvent,
    User,
    Visitor,
)
from app.models.enums import (
    InvitationStatus,
    NotificationChannel,
    NotificationStatus,
    OccupancyStatus,
    ReservationStatus,
)
from app.services import mail_service, notification_service, worker_service
from app.workers import expiry as expiry_worker
from app.workers import health as health_worker
from app.workers import notifications as notifications_worker


def _resident(db_session, world):
    recipient = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    assert recipient is not None
    return recipient


def test_expiry_sweep_purges_archive_past_retention(world, db_session):
    now = utcnow()
    stale = RealtimeEvent(
        property_id=world["property_id"],
        event_type="archive.test",
        payload={"index": 0},
        occurred_at=now - timedelta(days=31),
        created_at=now - timedelta(days=31),
    )
    fresh = RealtimeEvent(
        property_id=world["property_id"],
        event_type="archive.test",
        payload={"index": 1},
        occurred_at=now,
        created_at=now,
    )
    db_session.add_all([stale, fresh])
    db_session.commit()
    fresh_id = fresh.id

    result = expiry_worker.run_expiry_sweep(db_session)

    assert result["realtime_events_purged"] == 1
    remaining = list(db_session.scalars(select(RealtimeEvent)))
    assert [row.id for row in remaining] == [fresh_id]


def test_expiry_sweep_flags_overstay_and_queues_resident_notification(world, db_session):
    now = utcnow()
    resident = _resident(db_session, world)

    visitor = Visitor(
        organization_id=world["org_id"],
        property_id=world["property_id"],
        name="Overstay Guest",
    )
    db_session.add(visitor)
    db_session.flush()

    invitation = Invitation(
        organization_id=world["org_id"],
        property_id=world["property_id"],
        resident_user_id=resident.id,
        apartment_id=world["apartment_id"],
        visitor_id=visitor.id,
        visitor_type="GUEST",
        expected_arrival=now - timedelta(hours=3),
        expected_departure=now - timedelta(hours=2),
        status=InvitationStatus.APPROVED.value,
        approved_at=now - timedelta(hours=3),
    )
    db_session.add(invitation)
    db_session.flush()

    reservation = ParkingReservation(
        organization_id=world["org_id"],
        property_id=world["property_id"],
        slot_id=world["slot_id"],
        invitation_id=invitation.id,
        status=ReservationStatus.ACTIVE.value,
        reserved_from=now - timedelta(hours=3),
        reserved_until=now - timedelta(hours=2),
    )
    db_session.add(reservation)
    db_session.flush()

    occupancy = ParkingOccupancy(
        organization_id=world["org_id"],
        property_id=world["property_id"],
        slot_id=world["slot_id"],
        reservation_id=reservation.id,
        invitation_id=invitation.id,
        status=OccupancyStatus.ACTIVE.value,
        entered_at=now - timedelta(hours=3),
        overstay=False,
    )
    db_session.add(occupancy)
    db_session.commit()

    result = expiry_worker.run_expiry_sweep(db_session)

    db_session.refresh(occupancy)
    assert occupancy.overstay is True
    assert result["overstays_flagged"] == 1

    notes = list(
        db_session.scalars(
            select(Notification).where(Notification.user_id == resident.id)
        )
    )
    email = [note for note in notes if note.channel == NotificationChannel.EMAIL.value]
    in_app = [note for note in notes if note.channel == NotificationChannel.IN_APP.value]
    assert len(email) == 1
    assert email[0].status == NotificationStatus.PENDING.value
    assert len(in_app) == 1
    assert "overstay" in in_app[0].title.lower()


def test_health_check_fails_on_stale_outbox_and_recovers_after_worker_run(
    world, db_session, monkeypatch
):
    resident = _resident(db_session, world)
    notification_service.notify_user(
        db_session,
        organization_id=world["org_id"],
        user_id=resident.id,
        title="Queued reminder",
        body="This should not stay pending.",
    )
    db_session.commit()

    email = db_session.scalar(
        select(Notification).where(
            Notification.user_id == resident.id,
            Notification.channel == NotificationChannel.EMAIL.value,
        )
    )
    assert email is not None
    email.created_at = utcnow() - timedelta(minutes=20)
    worker_service.record_heartbeat(db_session, "expiry")
    worker_service.record_heartbeat(db_session, "notifications")
    db_session.commit()

    report = worker_service.check_health(db_session, max_pending_minutes=10)
    assert report["healthy"] is False
    assert any("pending" in problem.lower() for problem in report["problems"])
    assert health_worker.main(["--max-pending-minutes", "10"]) == 1

    def unavailable(**_):
        raise mail_service.MailNotConfigured("SMTP is not configured")

    monkeypatch.setattr(mail_service, "send_email", unavailable)
    result = notifications_worker.dispatch_notifications(db_session)
    assert result["skipped"] == 1

    report = worker_service.check_health(
        db_session, max_pending_minutes=10, max_worker_age_minutes=5
    )
    assert report["healthy"] is True, report["problems"]


def test_metrics_expose_outbox_and_worker_freshness(
    client, world, tokens, db_session, monkeypatch
):
    resident = _resident(db_session, world)
    notification_service.notify_user(
        db_session,
        organization_id=world["org_id"],
        user_id=resident.id,
        title="Metrics check",
        body="Queued for the outbox.",
    )
    worker_service.record_heartbeat(db_session, "expiry")
    worker_service.record_heartbeat(db_session, "notifications")
    db_session.commit()

    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert 'parkvanta_notification_outbox_rows{status="PENDING"} 1' in response.text
    assert 'parkvanta_worker_up{worker="expiry"} 1' in response.text
    assert "parkvanta_worker_age_seconds" in response.text

    monkeypatch.setattr(settings, "metrics_token", "scrape-secret")
    assert client.get("/metrics").status_code == 401
    assert (
        client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code
        == 401
    )
    assert (
        client.get(
            "/metrics", headers={"Authorization": "Bearer scrape-secret"}
        ).status_code
        == 200
    )
