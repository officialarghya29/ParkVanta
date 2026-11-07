from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, assert_property_access, client_ip, require_roles
from app.core.errors import ConflictError, NotFoundError
from app.database.session import get_db
from app.models import (
    Invitation,
    ParkingOccupancy,
    ParkingReservation,
    ParkingSlot,
    User,
    Vehicle,
    Visitor,
)
from app.models.enums import Role, SlotStatus
from app.schemas.common import Page
from app.schemas.parking import (
    AvailabilityOut,
    ManualAllocationRequest,
    OccupancyOut,
    ReservationOut,
)
from app.services import audit_service, event_service, parking_service

router = APIRouter(prefix="/parking", tags=["Parking"])

StaffUser = Annotated[
    User,
    Depends(
        require_roles(
            Role.SECURITY_GUARD, Role.SOCIETY_ADMIN, Role.PROPERTY_MANAGER, Role.SUPER_ADMIN
        )
    ),
]


def _scope(user: User, property_id: UUID | None) -> UUID | None:
    if user.role == Role.SUPER_ADMIN.value:
        return property_id
    if user.property_id is not None:
        return user.property_id
    return property_id


@router.get("/availability", response_model=AvailabilityOut)
def availability(
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    property_id: UUID = Query(),
) -> AvailabilityOut:
    assert_property_access(db, user, property_id)
    return AvailabilityOut(**parking_service.availability(db, property_id=property_id))


@router.post("/allocate", response_model=ReservationOut)
def allocate(
    payload: ManualAllocationRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
) -> ReservationOut:
    invitation = db.get(Invitation, payload.invitation_id)
    if invitation is None:
        raise NotFoundError("Invitation not found")
    assert_property_access(db, user, invitation.property_id)

    reservation, slot, _zone = parking_service.allocate_for_invitation(
        db, invitation=invitation, slot_id=payload.slot_id
    )
    audit_service.record(
        db,
        action="parking.allocated",
        entity_type="parking_reservation",
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        entity_id=reservation.id,
        details={"slot_code": slot.code, "invitation_id": str(invitation.id)},
        ip_address=client_ip(request),
    )
    db.commit()
    event_service.publish_event(
        "parking.updated",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "slot_code": slot.code, "reason": "allocation"},
    )
    visitor = db.get(Visitor, invitation.visitor_id)
    return ReservationOut(
        id=reservation.id,
        slot_id=slot.id,
        slot_code=slot.code,
        invitation_id=invitation.id,
        visitor_name=visitor.name if visitor else "Visitor",
        status=reservation.status,
        reserved_from=reservation.reserved_from,
        reserved_until=reservation.reserved_until,
        released_at=reservation.released_at,
    )


@router.get("/reservations", response_model=Page[ReservationOut])
def list_reservations(
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
    property_id: UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ReservationOut]:
    target = _scope(user, property_id)
    base = (
        select(ParkingReservation, ParkingSlot, Visitor)
        .join(ParkingSlot, ParkingReservation.slot_id == ParkingSlot.id)
        .join(Invitation, ParkingReservation.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
    )
    if target is not None:
        base = base.where(ParkingReservation.property_id == target)
    elif user.role != Role.SUPER_ADMIN.value:
        base = base.where(ParkingReservation.organization_id == user.organization_id)
    if status_filter:
        base = base.where(ParkingReservation.status == status_filter)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = db.execute(
        base.order_by(ParkingReservation.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return Page[ReservationOut](
        items=[
            ReservationOut(
                id=r.id,
                slot_id=s.id,
                slot_code=s.code,
                invitation_id=r.invitation_id,
                visitor_name=v.name,
                status=r.status,
                reserved_from=r.reserved_from,
                reserved_until=r.reserved_until,
                released_at=r.released_at,
            )
            for r, s, v in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/occupancies", response_model=Page[OccupancyOut])
def list_occupancies(
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
    property_id: UUID | None = Query(default=None),
    active_only: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[OccupancyOut]:
    target = _scope(user, property_id)
    base = (
        select(ParkingOccupancy, ParkingSlot, Visitor, Vehicle)
        .join(ParkingSlot, ParkingOccupancy.slot_id == ParkingSlot.id)
        .join(Invitation, ParkingOccupancy.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
        .outerjoin(Vehicle, Invitation.vehicle_id == Vehicle.id)
    )
    if target is not None:
        base = base.where(ParkingOccupancy.property_id == target)
    elif user.role != Role.SUPER_ADMIN.value:
        base = base.where(ParkingOccupancy.organization_id == user.organization_id)
    if active_only:
        base = base.where(ParkingOccupancy.status == "ACTIVE")
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = db.execute(
        base.order_by(ParkingOccupancy.entered_at.desc()).limit(limit).offset(offset)
    ).all()
    return Page[OccupancyOut](
        items=[
            OccupancyOut(
                id=o.id,
                slot_id=s.id,
                slot_code=s.code,
                invitation_id=o.invitation_id,
                visitor_name=v.name,
                vehicle_registration=vehicle.registration_number if vehicle else None,
                status=o.status,
                entered_at=o.entered_at,
                exited_at=o.exited_at,
                overstay=o.overstay,
            )
            for o, s, v, vehicle in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/occupancies/{occupancy_id}/release", response_model=OccupancyOut)
def release_occupancy(
    occupancy_id: UUID,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
) -> OccupancyOut:
    occupancy = db.get(ParkingOccupancy, occupancy_id)
    if occupancy is None:
        raise NotFoundError("Occupancy not found")
    assert_property_access(db, user, occupancy.property_id)
    if occupancy.status != "ACTIVE":
        raise ConflictError("This occupancy has already been released", code="already_exited")

    released, slot, duration, overstay = parking_service.release_occupancy(
        db, property_id=occupancy.property_id, invitation_id=occupancy.invitation_id
    )
    audit_service.record(
        db,
        action="parking.occupancy_released",
        entity_type="parking_occupancy",
        organization_id=occupancy.organization_id,
        actor_user_id=user.id,
        entity_id=occupancy.id,
        details={"slot_code": slot.code, "duration_minutes": duration, "overstay": overstay},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(released)
    visitor = db.scalar(
        select(Visitor).join(Invitation, Visitor.id == Invitation.visitor_id).where(
            Invitation.id == released.invitation_id
        )
    )
    return OccupancyOut(
        id=released.id,
        slot_id=slot.id,
        slot_code=slot.code,
        invitation_id=released.invitation_id,
        visitor_name=visitor.name if visitor else "Visitor",
        vehicle_registration=None,
        status=released.status,
        entered_at=released.entered_at,
        exited_at=released.exited_at,
        overstay=released.overstay,
    )


@router.get("/slots/available", response_model=list[dict])
def available_slots(
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
    property_id: UUID | None = Query(default=None),
) -> list[dict]:
    target = _scope(user, property_id)
    stmt = select(ParkingSlot).where(ParkingSlot.status == SlotStatus.AVAILABLE.value)
    if target is not None:
        stmt = stmt.where(ParkingSlot.property_id == target)
    slots = list(db.scalars(stmt.order_by(ParkingSlot.code).limit(100)))
    return [
        {
            "id": str(slot.id),
            "code": slot.code,
            "category": slot.category,
            "vehicle_category": slot.vehicle_category,
        }
        for slot in slots
    ]
