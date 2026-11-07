from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.time import ensure_utc, minutes_between, utcnow
from app.models import (
    Invitation,
    ParkingOccupancy,
    ParkingReservation,
    ParkingSlot,
    ParkingZone,
    SocietyPolicy,
    Vehicle,
)
from app.models.enums import (
    SLOT_ANY_VEHICLE,
    InvitationStatus,
    OccupancyStatus,
    ReservationStatus,
    SlotStatus,
    VehicleCategory,
    VisitorType,
    ZoneCategory,
)


def get_policy(db: Session, *, property_id: UUID) -> SocietyPolicy:
    policy = db.scalar(select(SocietyPolicy).where(SocietyPolicy.property_id == property_id))
    if policy is not None:
        return policy
    # Transient defaults: a property without an explicit policy still behaves safely.
    return SocietyPolicy(
        property_id=property_id,
        qr_validity_minutes=settings.default_qr_validity_minutes,
        overstay_grace_minutes=settings.default_overstay_grace_minutes,
    )


def ensure_policy(db: Session, *, property_id: UUID) -> SocietyPolicy:
    policy = db.scalar(select(SocietyPolicy).where(SocietyPolicy.property_id == property_id))
    if policy is None:
        policy = SocietyPolicy(property_id=property_id)
        db.add(policy)
        db.flush()
    return policy


def _zone_categories_for(visitor_type: str) -> list[str]:
    if visitor_type == VisitorType.EMERGENCY.value:
        return [ZoneCategory.EMERGENCY.value, ZoneCategory.VISITOR.value]
    if visitor_type in {
        VisitorType.SERVICE_TECHNICIAN.value,
        VisitorType.MAINTENANCE.value,
        VisitorType.DELIVERY.value,
    }:
        return [ZoneCategory.SERVICE.value, ZoneCategory.VISITOR.value]
    return [ZoneCategory.VISITOR.value, ZoneCategory.TEMPORARY.value]


def _vehicle_category(db: Session, invitation: Invitation) -> str:
    if invitation.vehicle_id is None:
        return VehicleCategory.FOUR_WHEELER.value
    vehicle = db.get(Vehicle, invitation.vehicle_id)
    return vehicle.category if vehicle else VehicleCategory.FOUR_WHEELER.value


def allocate_for_invitation(
    db: Session,
    *,
    invitation: Invitation,
    slot_id: UUID | None = None,
) -> tuple[ParkingReservation, ParkingSlot, ParkingZone]:
    """Reserve exactly one compatible slot, with row-level locking.

    `FOR UPDATE SKIP LOCKED` ensures two concurrent allocations can never claim
    the same slot; the partial unique index on active reservations is the
    database-level backstop.
    """
    existing = db.scalar(
        select(ParkingReservation).where(
            ParkingReservation.invitation_id == invitation.id,
            ParkingReservation.status == ReservationStatus.ACTIVE.value,
        )
    )
    if existing is not None:
        slot = db.get(ParkingSlot, existing.slot_id)
        zone = db.get(ParkingZone, slot.zone_id) if slot else None
        if slot is None or zone is None:
            raise ConflictError("The existing reservation is inconsistent")
        return existing, slot, zone

    if invitation.vehicle_id is None:
        raise ValidationError("A parking slot can only be allocated to a vehicle-backed invitation")

    vehicle_category = _vehicle_category(db, invitation)

    stmt = (
        select(ParkingSlot, ParkingZone)
        .join(ParkingZone, ParkingSlot.zone_id == ParkingZone.id)
        .where(
            ParkingSlot.property_id == invitation.property_id,
            ParkingSlot.status == SlotStatus.AVAILABLE.value,
            ParkingZone.is_active.is_(True),
            ParkingSlot.vehicle_category.in_([SLOT_ANY_VEHICLE, vehicle_category]),
        )
    )
    if slot_id is not None:
        stmt = stmt.where(ParkingSlot.id == slot_id)
    else:
        stmt = stmt.where(ParkingZone.category.in_(_zone_categories_for(invitation.visitor_type)))

    stmt = stmt.order_by(ParkingZone.priority.asc(), ParkingZone.name.asc(), ParkingSlot.code.asc())
    stmt = stmt.limit(1).with_for_update(of=ParkingSlot, skip_locked=True)

    row = db.execute(stmt).first()
    if row is None:
        raise ConflictError(
            "No compatible parking slot is currently available.",
            code="no_slot_available",
        )

    slot, zone = row
    slot.status = SlotStatus.RESERVED.value

    reservation = ParkingReservation(
        organization_id=invitation.organization_id,
        property_id=invitation.property_id,
        slot_id=slot.id,
        invitation_id=invitation.id,
        vehicle_id=invitation.vehicle_id,
        status=ReservationStatus.ACTIVE.value,
        reserved_from=ensure_utc(invitation.expected_arrival),
        reserved_until=ensure_utc(invitation.expected_departure),
    )
    db.add(reservation)
    db.flush()
    return reservation, slot, zone


def confirm_entry(db: Session, *, invitation: Invitation) -> tuple[ParkingOccupancy, ParkingSlot, bool]:
    """Convert a reservation into an occupancy. Idempotent for repeated confirms."""
    existing = db.scalar(
        select(ParkingOccupancy).where(
            ParkingOccupancy.invitation_id == invitation.id,
            ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
        )
    )
    if existing is not None:
        slot = db.get(ParkingSlot, existing.slot_id)
        assert slot is not None
        return existing, slot, True

    reservation = db.scalar(
        select(ParkingReservation)
        .where(
            ParkingReservation.invitation_id == invitation.id,
            ParkingReservation.status == ReservationStatus.ACTIVE.value,
        )
        .with_for_update()
    )
    if reservation is None:
        raise ConflictError(
            "There is no active reservation for this invitation.",
            code="no_active_reservation",
        )

    slot = db.scalar(
        select(ParkingSlot).where(ParkingSlot.id == reservation.slot_id).with_for_update()
    )
    if slot is None:
        raise ConflictError("The reserved slot no longer exists", code="slot_missing")

    slot.status = SlotStatus.OCCUPIED.value
    reservation.status = ReservationStatus.CONSUMED.value

    occupancy = ParkingOccupancy(
        organization_id=invitation.organization_id,
        property_id=invitation.property_id,
        slot_id=slot.id,
        reservation_id=reservation.id,
        invitation_id=invitation.id,
        status=OccupancyStatus.ACTIVE.value,
        entered_at=utcnow(),
    )
    db.add(occupancy)
    db.flush()
    return occupancy, slot, False


def release_occupancy(
    db: Session,
    *,
    property_id: UUID,
    invitation_id: UUID | None = None,
    slot_code: str | None = None,
) -> tuple[ParkingOccupancy, ParkingSlot, int, bool]:
    stmt = (
        select(ParkingOccupancy, ParkingSlot)
        .join(ParkingSlot, ParkingOccupancy.slot_id == ParkingSlot.id)
        .where(
            ParkingOccupancy.property_id == property_id,
            ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
        )
        .with_for_update(of=ParkingOccupancy)
    )
    if invitation_id is not None:
        stmt = stmt.where(ParkingOccupancy.invitation_id == invitation_id)
    elif slot_code is not None:
        stmt = stmt.where(ParkingSlot.code == slot_code)
    else:
        raise ValidationError("Provide an invitation or a slot code")

    row = db.execute(stmt).first()
    if row is None:
        raise ConflictError(
            "This vehicle is not currently parked inside the property.",
            code="already_exited",
        )

    occupancy, slot = row
    reservation = db.get(ParkingReservation, occupancy.reservation_id)
    invitation = db.get(Invitation, occupancy.invitation_id)
    if reservation is None or invitation is None:
        raise ConflictError("Occupancy data is inconsistent", code="occupancy_inconsistent")

    now = utcnow()
    reserved_until = ensure_utc(reservation.reserved_until)
    policy = get_policy(db, property_id=property_id)
    overstay = now > reserved_until and minutes_between(reserved_until, now) > policy.overstay_grace_minutes

    occupancy.status = OccupancyStatus.RELEASED.value
    occupancy.exited_at = now
    occupancy.overstay = overstay

    slot.status = SlotStatus.AVAILABLE.value
    reservation.status = ReservationStatus.RELEASED.value
    reservation.released_at = now
    invitation.status = InvitationStatus.COMPLETED.value

    duration = minutes_between(occupancy.entered_at, now)
    return occupancy, slot, duration, overstay


def release_reservation(db: Session, *, invitation_id: UUID) -> None:
    reservation = db.scalar(
        select(ParkingReservation)
        .where(
            ParkingReservation.invitation_id == invitation_id,
            ParkingReservation.status == ReservationStatus.ACTIVE.value,
        )
        .with_for_update()
    )
    if reservation is None:
        return
    slot = db.get(ParkingSlot, reservation.slot_id)
    if slot is not None and slot.status == SlotStatus.RESERVED.value:
        slot.status = SlotStatus.AVAILABLE.value
    reservation.status = ReservationStatus.CANCELLED.value
    reservation.released_at = utcnow()


def availability(db: Session, *, property_id: UUID) -> dict:
    rows = db.execute(
        select(ParkingSlot.status, ParkingZone.category, func.count(ParkingSlot.id))
        .join(ParkingZone, ParkingSlot.zone_id == ParkingZone.id)
        .where(ParkingSlot.property_id == property_id)
        .group_by(ParkingSlot.status, ParkingZone.category)
    ).all()

    totals = {status.value: 0 for status in SlotStatus}
    by_category: dict[str, dict[str, int]] = {}
    for status_value, category, count in rows:
        totals[status_value] = totals.get(status_value, 0) + count
        bucket = by_category.setdefault(category, {})
        bucket[status_value] = count

    total = sum(totals.values())
    utilized = totals.get(SlotStatus.RESERVED.value, 0) + totals.get(SlotStatus.OCCUPIED.value, 0)
    return {
        "property_id": property_id,
        "total_slots": total,
        "available": totals.get(SlotStatus.AVAILABLE.value, 0),
        "reserved": totals.get(SlotStatus.RESERVED.value, 0),
        "occupied": totals.get(SlotStatus.OCCUPIED.value, 0),
        "blocked": totals.get(SlotStatus.BLOCKED.value, 0),
        "maintenance": totals.get(SlotStatus.MAINTENANCE.value, 0),
        "utilization_percent": round((utilized / total) * 100, 2) if total else 0.0,
        "by_category": by_category,
    }


def get_slot_for_property(db: Session, *, slot_id: UUID, property_id: UUID) -> ParkingSlot:
    slot = db.get(ParkingSlot, slot_id)
    if slot is None or slot.property_id != property_id:
        raise NotFoundError("Parking slot not found")
    return slot
