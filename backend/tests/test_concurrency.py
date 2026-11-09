import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID

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
from app.services import auth_service, gate_service, invitation_service, parking_service


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

    barrier = Barrier(8)
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

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: attempt(), range(8)))

    assert outcomes.count("authorized") == 1
    assert outcomes.count("already_used") == 7

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


def test_concurrent_refresh_calls_issue_at_most_one_successor(client, world):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": world["resident_email"], "password": "TestPass123"},
    ).json()
    raw_refresh = login["refresh_token"]
    barrier = Barrier(8)
    outcomes: list[str] = []

    def rotate() -> None:
        db = SessionLocal()
        try:
            barrier.wait(timeout=10)
            auth_service.rotate_refresh_token(db, raw_refresh)
            outcomes.append("rotated")
        except AuthError:
            outcomes.append("rejected")
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: rotate(), range(8)))

    assert outcomes.count("rotated") == 1
    assert outcomes.count("rejected") == 7

    with SessionLocal() as db:
        replacements = (
            db.query(RefreshToken)
            .filter(RefreshToken.replaced_by_hash.is_not(None))
            .count()
        )
        assert replacements == 1
        assert (
            db.query(RefreshToken)
            .filter(RefreshToken.user_id == db.query(User.id).filter(User.email == world["resident_email"]).scalar_subquery())
            .filter(RefreshToken.revoked_at.is_(None))
            .count()
            == 0
        )


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


def test_approve_and_reject_cannot_both_succeed(client, world, tokens, db_session):
    invitation = _create_pending_invitation(client, tokens["resident"], "KA06IJ4444")
    invitation_id = UUID(invitation["id"])
    resident_id = db_session.scalar(
        select(User.id).where(User.email == world["resident_email"])
    )
    assert resident_id is not None

    locker = SessionLocal()
    locked = locker.scalar(
        select(Invitation).where(Invitation.id == invitation_id).with_for_update()
    )
    assert locked is not None
    outcomes: list[str] = []

    def approve() -> None:
        db = SessionLocal()
        try:
            resident = db.get(User, resident_id)
            invitation_service.approve_invitation(
                db, user=resident, invitation_id=invitation_id
            )
            outcomes.append("approved")
        except AppError as exc:
            outcomes.append(f"error:{exc.code}")
        finally:
            db.close()

    def reject() -> None:
        db = SessionLocal()
        try:
            resident = db.get(User, resident_id)
            invitation_service.reject_invitation(
                db,
                user=resident,
                invitation_id=invitation_id,
                reason="Resident rejected concurrently",
            )
            outcomes.append("rejected")
        except AppError as exc:
            outcomes.append(f"error:{exc.code}")
        finally:
            db.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            approve_future = pool.submit(approve)
            # Both callers must start while the row is locked. The reject path
            # must re-check the state after it acquires the row lock.
            time.sleep(0.2)
            reject_future = pool.submit(reject)
            time.sleep(0.3)
            locker.commit()
            approve_future.result(timeout=10)
            reject_future.result(timeout=10)
    finally:
        locker.rollback()
        locker.close()

    assert sum(outcome in {"approved", "rejected"} for outcome in outcomes) == 1, outcomes

    db_session.expire_all()
    stored = db_session.get(Invitation, invitation_id)
    assert stored is not None
    pass_row = db_session.scalar(
        select(QRPass).where(QRPass.invitation_id == invitation_id)
    )
    if stored.status == "APPROVED":
        assert pass_row is not None
    else:
        assert stored.status == "REJECTED"
        assert pass_row is None


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
