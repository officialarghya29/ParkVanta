"""Idempotent background sweeps.

Run on a schedule (cron, Celery beat or a container timer):

    python -m app.workers.expiry

Every sweep is safe to run concurrently: transitions are conditional on the
current state, so a second runner cannot double-release a slot.
"""

import logging
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utcnow
from app.database.session import session_scope
from app.models import (
    Invitation,
    ParkingOccupancy,
    ParkingReservation,
    ParkingSlot,
    QRPass,
    RealtimeEvent,
)
from app.models.enums import (
    InvitationStatus,
    OccupancyStatus,
    PassStatus,
    ReservationStatus,
    SlotStatus,
)
from app.services import (
    event_service,
    notification_service,
    parking_service,
    worker_service,
)

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


def flag_overstays(db: Session, now) -> list[tuple]:
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

    flagged: list[tuple] = []
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
        flagged.append((occupancy.property_id, invitation.id))
    return flagged


def purge_realtime_events(db: Session, now) -> int:
    cutoff = now - timedelta(days=settings.event_retention_days)
    result = db.execute(delete(RealtimeEvent).where(RealtimeEvent.created_at < cutoff))
    return int(result.rowcount or 0)


def run_expiry_sweep(db: Session) -> dict[str, int]:
    now = utcnow()
    overstay_events = flag_overstays(db, now)
    result = {
        "expired_passes": expire_passes(db, now),
        "expired_reservations": expire_reservations(db, now),
        "expired_invitations": expire_pending_invitations(db, now),
        "overstays_flagged": len(overstay_events),
        "realtime_events_purged": purge_realtime_events(db, now),
    }
    worker_service.record_heartbeat(
        db,
        "expiry",
        detail=(
            f"passes={result['expired_passes']} "
            f"reservations={result['expired_reservations']} "
            f"invitations={result['expired_invitations']} "
            f"overstays={result['overstays_flagged']} "
            f"purged={result['realtime_events_purged']}"
        ),
    )
    db.commit()

    # Publish after commit so subscribers never read pre-transaction state.
    for property_id, invitation_id in overstay_events:
        event_service.publish_event(
            "parking.overstay",
            property_id=property_id,
            data={"invitation_id": str(invitation_id)},
        )
    if result["expired_reservations"] or result["expired_passes"]:
        for property_id, in db.execute(
            select(ParkingReservation.property_id)
            .where(ParkingReservation.status == ReservationStatus.EXPIRED.value)
            .distinct()
            .limit(20)
        ).all():
            event_service.publish_event(
                "parking.updated", property_id=property_id, data={"reason": "expiry_sweep"}
            )
    return result


if __name__ == "__main__":  # pragma: no cover - operational entry point
    logging.basicConfig(level=logging.INFO)
    with session_scope() as session:
        logger.info("expiry sweep complete: %s", run_expiry_sweep(session))
