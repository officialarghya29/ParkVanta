"""Idempotent background sweeps.

Run on a schedule (cron, Celery beat or a container timer):

    python -m app.workers.expiry

Every sweep is safe to run concurrently: transitions are conditional on the
current state, so a second runner cannot double-release a slot.
"""

import logging
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.database.session import session_scope
from app.models import Invitation, ParkingOccupancy, ParkingReservation, ParkingSlot, QRPass
from app.models.enums import (
    InvitationStatus,
    OccupancyStatus,
    PassStatus,
    ReservationStatus,
    SlotStatus,
)
from app.services import notification_service, parking_service

logger = logging.getLogger("parkvanta.workers.expiry")


def expire_passes(db: Session, now) -> int:
    result = db.execute(
        update(QRPass)
        .where(QRPass.status == PassStatus.ACTIVE.value, QRPass.expires_at < now)
        .values(status=PassStatus.EXPIRED.value)
    )
    return int(result.rowcount or 0)


def expire_reservations(db: Session, now) -> int:
    expired = list(
        db.scalars(
            select(ParkingReservation).where(
                ParkingReservation.status == ReservationStatus.ACTIVE.value,
                ParkingReservation.reserved_until < now,
            )
        )
    )
    count = 0
    for reservation in expired:
        has_occupancy = db.scalar(
            select(ParkingOccupancy.id).where(
                ParkingOccupancy.reservation_id == reservation.id,
                ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
            )
        )
        if has_occupancy:
            continue
        reservation.status = ReservationStatus.EXPIRED.value
        reservation.released_at = now
        slot = db.get(ParkingSlot, reservation.slot_id)
        if slot is not None and slot.status == SlotStatus.RESERVED.value:
            slot.status = SlotStatus.AVAILABLE.value
        invitation = db.get(Invitation, reservation.invitation_id)
        if invitation is not None and invitation.status == InvitationStatus.APPROVED.value:
            invitation.status = InvitationStatus.EXPIRED.value
        count += 1
    return count


def expire_pending_invitations(db: Session, now) -> int:
    """Expire invitations that were never approved and whose window has passed."""
    stale = list(
        db.scalars(
            select(Invitation).where(
                Invitation.status == InvitationStatus.PENDING.value,
                Invitation.expected_departure < now - timedelta(minutes=30),
            )
        )
    )
    for invitation in stale:
        invitation.status = InvitationStatus.EXPIRED.value
    return len(stale)


def flag_overstays(db: Session, now) -> int:
    rows = db.execute(
        select(ParkingOccupancy, ParkingReservation, Invitation)
        .join(ParkingReservation, ParkingOccupancy.reservation_id == ParkingReservation.id)
        .join(Invitation, ParkingOccupancy.invitation_id == Invitation.id)
        .where(
            ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
            ParkingOccupancy.overstay.is_(False),
            ParkingReservation.reserved_until < now,
        )
    ).all()

    count = 0
    for occupancy, reservation, invitation in rows:
        policy = parking_service.get_policy(db, property_id=occupancy.property_id)
        grace = timedelta(minutes=policy.overstay_grace_minutes)
        if now <= reservation.reserved_until + grace:
            continue
        occupancy.overstay = True
        notification_service.notify_user(
            db,
            organization_id=occupancy.organization_id,
            user_id=invitation.resident_user_id,
            title="Visitor overstay",
            body="Your visitor has exceeded the expected departure time. Please contact the gate.",
        )
        count += 1
    return count


def run_expiry_sweep(db: Session) -> dict[str, int]:
    now = utcnow()
    result = {
        "expired_passes": expire_passes(db, now),
        "expired_reservations": expire_reservations(db, now),
        "expired_invitations": expire_pending_invitations(db, now),
        "overstays_flagged": flag_overstays(db, now),
    }
    db.commit()
    return result


if __name__ == "__main__":  # pragma: no cover - operational entry point
    logging.basicConfig(level=logging.INFO)
    with session_scope() as session:
        logger.info("expiry sweep complete: %s", run_expiry_sweep(session))
