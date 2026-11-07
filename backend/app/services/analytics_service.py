from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import (
    EntryExitEvent,
    Invitation,
    ParkingOccupancy,
    ParkingReservation,
    ParkingSlot,
    ParkingZone,
    Vehicle,
    Visitor,
)
from app.models.enums import EventDecision, EventDirection, OccupancyStatus, SlotStatus


def _start_of_today() -> datetime:
    now = utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def overview(db: Session, *, property_id: UUID) -> dict:
    slot_rows = db.execute(
        select(ParkingSlot.status, func.count(ParkingSlot.id))
        .where(ParkingSlot.property_id == property_id)
        .group_by(ParkingSlot.status)
    ).all()
    counts = {status: int(count) for status, count in slot_rows}
    total = sum(counts.values())
    reserved = counts.get(SlotStatus.RESERVED.value, 0)
    occupied = counts.get(SlotStatus.OCCUPIED.value, 0)
    utilized = reserved + occupied

    start = _start_of_today()
    visitors_inside = int(
        db.scalar(
            select(func.count(ParkingOccupancy.id)).where(
                ParkingOccupancy.property_id == property_id,
                ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
            )
        )
        or 0
    )
    active_reservations = int(
        db.scalar(
            select(func.count(ParkingReservation.id)).where(
                ParkingReservation.property_id == property_id,
                ParkingReservation.status == "ACTIVE",
            )
        )
        or 0
    )
    visitors_today = int(
        db.scalar(
            select(func.count(Invitation.id)).where(
                Invitation.property_id == property_id, Invitation.created_at >= start
            )
        )
        or 0
    )
    rejected_today = int(
        db.scalar(
            select(func.count(EntryExitEvent.id)).where(
                EntryExitEvent.property_id == property_id,
                EntryExitEvent.created_at >= start,
                EntryExitEvent.direction == EventDirection.ENTRY.value,
                EntryExitEvent.decision == EventDecision.DENIED.value,
            )
        )
        or 0
    )
    overrides_today = int(
        db.scalar(
            select(func.count(EntryExitEvent.id)).where(
                EntryExitEvent.property_id == property_id,
                EntryExitEvent.created_at >= start,
                EntryExitEvent.decision == EventDecision.MANUAL_OVERRIDE.value,
            )
        )
        or 0
    )
    overstays = int(
        db.scalar(
            select(func.count(ParkingOccupancy.id))
            .join(ParkingReservation, ParkingOccupancy.reservation_id == ParkingReservation.id)
            .where(
                ParkingOccupancy.property_id == property_id,
                ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
                ParkingReservation.reserved_until < utcnow(),
            )
        )
        or 0
    )

    return {
        "property_id": property_id,
        "total_slots": total,
        "available_slots": counts.get(SlotStatus.AVAILABLE.value, 0),
        "reserved_slots": reserved,
        "occupied_slots": occupied,
        "blocked_slots": counts.get(SlotStatus.BLOCKED.value, 0),
        "maintenance_slots": counts.get(SlotStatus.MAINTENANCE.value, 0),
        "utilization_percent": round(utilized / total * 100, 2) if total else 0.0,
        "visitors_inside": visitors_inside,
        "active_reservations": active_reservations,
        "total_visitors_today": visitors_today,
        "rejected_entries_today": rejected_today,
        "manual_overrides_today": overrides_today,
        "overstays": overstays,
    }


def utilization_by_zone(db: Session, *, property_id: UUID) -> list[dict]:
    rows = db.execute(
        select(ParkingZone.category, ParkingSlot.status, func.count(ParkingSlot.id))
        .join(ParkingZone, ParkingSlot.zone_id == ParkingZone.id)
        .where(ParkingSlot.property_id == property_id)
        .group_by(ParkingZone.category, ParkingSlot.status)
    ).all()

    buckets: dict[str, dict[str, int]] = {}
    for category, status, count in rows:
        bucket = buckets.setdefault(category, {})
        bucket[status] = int(count)

    result = []
    for category, statuses in sorted(buckets.items()):
        total = sum(statuses.values())
        used = statuses.get(SlotStatus.RESERVED.value, 0) + statuses.get(SlotStatus.OCCUPIED.value, 0)
        result.append(
            {
                "category": category,
                "total": total,
                "available": statuses.get(SlotStatus.AVAILABLE.value, 0),
                "reserved": statuses.get(SlotStatus.RESERVED.value, 0),
                "occupied": statuses.get(SlotStatus.OCCUPIED.value, 0),
                "utilization_percent": round(used / total * 100, 2) if total else 0.0,
            }
        )
    return result


def visitor_trends(db: Session, *, property_id: UUID, days: int = 14) -> list[dict]:
    days = max(1, min(days, 90))
    today = utcnow().date()
    start_day = today - timedelta(days=days - 1)
    start_dt = datetime.combine(start_day, datetime.min.time(), tzinfo=utcnow().tzinfo)

    invitation_rows = db.execute(
        select(func.date(Invitation.created_at), func.count(Invitation.id))
        .where(Invitation.property_id == property_id, Invitation.created_at >= start_dt)
        .group_by(func.date(Invitation.created_at))
    ).all()
    event_rows = db.execute(
        select(
            func.date(EntryExitEvent.created_at),
            EntryExitEvent.direction,
            func.count(EntryExitEvent.id),
        )
        .where(
            EntryExitEvent.property_id == property_id,
            EntryExitEvent.created_at >= start_dt,
            EntryExitEvent.decision.in_(
                [EventDecision.AUTHORIZED.value, EventDecision.CONFIRMED.value, EventDecision.RELEASED.value]
            ),
        )
        .group_by(func.date(EntryExitEvent.created_at), EntryExitEvent.direction)
    ).all()

    invitations = {str(day): int(count) for day, count in invitation_rows}
    entries = {str(day): int(count) for day, direction, count in event_rows if direction == "ENTRY"}
    exits = {str(day): int(count) for day, direction, count in event_rows if direction == "EXIT"}

    points = []
    for offset in range(days):
        day = start_day + timedelta(days=offset)
        key = day.isoformat()
        points.append(
            {
                "day": day,
                "invitations": invitations.get(key, 0),
                "entries": entries.get(key, 0),
                "exits": exits.get(key, 0),
            }
        )
    return points


def overstays(db: Session, *, property_id: UUID) -> list[dict]:
    rows = db.execute(
        select(
            ParkingOccupancy,
            ParkingReservation,
            Visitor,
            Vehicle,
            ParkingSlot,
        )
        .join(ParkingReservation, ParkingOccupancy.reservation_id == ParkingReservation.id)
        .join(Invitation, ParkingOccupancy.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
        .outerjoin(Vehicle, Invitation.vehicle_id == Vehicle.id)
        .join(ParkingSlot, ParkingOccupancy.slot_id == ParkingSlot.id)
        .where(
            ParkingOccupancy.property_id == property_id,
            ParkingOccupancy.status == OccupancyStatus.ACTIVE.value,
            ParkingReservation.reserved_until < utcnow(),
        )
        .order_by(ParkingReservation.reserved_until.asc())
    ).all()

    now = utcnow()
    return [
        {
            "occupancy_id": occupancy.id,
            "invitation_id": occupancy.invitation_id,
            "visitor_name": visitor.name,
            "vehicle_registration": vehicle.registration_number if vehicle else None,
            "slot_code": slot.code,
            "entered_at": occupancy.entered_at,
            "reserved_until": reservation.reserved_until,
            "overdue_minutes": int((now - reservation.reserved_until).total_seconds() // 60),
        }
        for occupancy, reservation, visitor, vehicle, slot in rows
    ]
