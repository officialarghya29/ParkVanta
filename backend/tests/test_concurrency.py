import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import select

from app.core.errors import AppError, AuthError, ValidationError
from app.core.security import generate_pass_token, sha256_hex
from app.core.time import utcnow
from app.database.session import SessionLocal
from app.models import (
    Invitation,
    ParkingReservation,
    PasswordResetToken,
    QRPass,
    RefreshToken,
    User,
)
from app.models.enums import PassStatus, ReservationStatus
from app.services import auth_service, gate_service, parking_service


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_pending_invitation(client, token, plate: str) -> dict:
    arrival = datetime.now(UTC) + timedelta(minutes=5)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": f"Visitor {plate[-4:]}",
            "visitor_phone": None,
            "vehicle_registration": plate,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_single_use_pass_survives_concurrent_authorizations(client, world, tokens):
    invitation = _create_pending_invitation(client, tokens["resident"], "KA03EF1111")
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    ).json()
    raw_token = approval["pass_token"]

    barrier = Barrier(2)
    outcomes: list[str] = []

    def attempt() -> None:
        db = SessionLocal()
        try:
            guard = db.get(User, world["guard_id"])
            barrier.wait(timeout=10)
            gate_service.authorize_entry(
                db,
                guard=guard,
                token=raw_token,
                plate_number="KA03EF1111",
                ip_address="127.0.0.1",
            )
            outcomes.append("authorized")
        except AppError as exc:
            outcomes.append(exc.code)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: attempt(), range(2)))

    assert sorted(outcomes) == ["already_used", "authorized"]

    with SessionLocal() as db:
        pass_row = db.query(QRPass).filter(QRPass.invitation_id == invitation["id"]).one()
        assert pass_row.status == PassStatus.CONSUMED.value
        entries = [
            event
            for event in db.query(gate_service.EntryExitEvent).filter(
                gate_service.EntryExitEvent.invitation_id == invitation["id"],
                gate_service.EntryExitEvent.direction == "ENTRY",
            )
        ]
        assert len(entries) == 1


def test_refresh_rotation_waits_for_an_in_flight_token_lock(client, world, db_session):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    ).json()
    raw_refresh = login["refresh_token"]
    token_hash = sha256_hex(raw_refresh)
    locked = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update()
    )
    assert locked is not None

    def rotate() -> None:
        db = SessionLocal()
        try:
            auth_service.rotate_refresh_token(db, raw_refresh)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(rotate)
        time.sleep(0.25)
        assert not future.done()
        locked.revoked_at = utcnow()
        db_session.commit()
        with pytest.raises(AuthError):
            future.result(timeout=5)


def test_password_reset_token_is_consumed_under_a_row_lock(world, db_session):
    user = db_session.scalar(select(User).where(User.email == world["resident_email"]))
    assert user is not None
    raw_token, token_hash = generate_pass_token()
    db_session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=utcnow() + timedelta(minutes=30),
        )
    )
    db_session.commit()
    locked = db_session.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == token_hash)
        .with_for_update()
    )
    assert locked is not None

    def reset() -> None:
        db = SessionLocal()
        try:
            auth_service.reset_password(db, raw_token, "ChangedPass456")
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(reset)
        time.sleep(0.25)
        assert not future.done()
        locked.used_at = utcnow()
        db_session.commit()
        with pytest.raises(ValidationError):
            future.result(timeout=5)


def test_concurrent_allocations_never_double_book_a_slot(client, world, tokens):
    first = _create_pending_invitation(client, tokens["resident"], "KA04GH2222")
    second = _create_pending_invitation(client, tokens["resident"], "KA04GH3333")

    barrier = Barrier(2)
    outcomes: list[str] = []

    def allocate(invitation_id: str) -> None:
        db = SessionLocal()
        try:
            invitation = db.get(Invitation, invitation_id)
            barrier.wait(timeout=10)
            parking_service.allocate_for_invitation(db, invitation=invitation)
            db.commit()
            outcomes.append("allocated")
        except AppError as exc:
            db.rollback()
            outcomes.append(exc.code)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(allocate, [first["id"], second["id"]]))

    assert sorted(outcomes) == ["allocated", "no_slot_available"]

    with SessionLocal() as db:
        active = (
            db.query(ParkingReservation)
            .filter(ParkingReservation.status == ReservationStatus.ACTIVE.value)
            .all()
        )
        assert len(active) == 1
        assert active[0].slot_id == world["slot_id"]
