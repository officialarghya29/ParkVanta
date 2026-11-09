from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.security import generate_pass_token
from app.core.time import ensure_utc, utcnow
from app.models import (
    Apartment,
    Invitation,
    ParkingReservation,
    ParkingSlot,
    ParkingZone,
    Property,
    QRPass,
    ResidentProfile,
    User,
    Vehicle,
    Visitor,
)
from app.models.enums import (
    InvitationStatus,
    PassStatus,
    ReservationStatus,
    Role,
)
from app.schemas.visitors import InvitationCreate
from app.services import audit_service, event_service, notification_service, parking_service, qr_service


def get_resident_profile(db: Session, user_id: UUID) -> ResidentProfile | None:
    return db.scalar(select(ResidentProfile).where(ResidentProfile.user_id == user_id))


def _permission_check(db: Session, user: User, invitation: Invitation) -> None:
    if user.role == Role.SUPER_ADMIN.value:
        return
    if user.organization_id != invitation.organization_id:
        raise ForbiddenError("Cross-organization access is not permitted")
    if user.role == Role.RESIDENT.value:
        if invitation.resident_user_id != user.id:
            raise ForbiddenError("You can only manage your own invitations")
        return
    if user.property_id is not None and user.property_id != invitation.property_id:
        raise ForbiddenError("You are not assigned to this property")


def get_invitation(db: Session, user: User, invitation_id: UUID) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _permission_check(db, user, invitation)
    return invitation


def _scope_query(user: User, status: str | None, search: str | None):
    stmt = select(Invitation)
    if user.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(Invitation.organization_id == user.organization_id)
    if user.role == Role.RESIDENT.value:
        stmt = stmt.where(Invitation.resident_user_id == user.id)
    elif user.property_id is not None:
        stmt = stmt.where(Invitation.property_id == user.property_id)
    if status:
        stmt = stmt.where(Invitation.status == status)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.join(Visitor, Invitation.visitor_id == Visitor.id).where(
            func.lower(Visitor.name).like(like)
        )
    return stmt


def list_invitations(
    db: Session,
    user: User,
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[Invitation], int]:
    stmt = _scope_query(user, status, search)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    items = list(
        db.scalars(stmt.order_by(Invitation.created_at.desc()).limit(limit).offset(offset))
    )
    return items, total


def serialize_invitations(db: Session, invitations: list[Invitation]) -> list[dict[str, Any]]:
    """Serialize a page with a fixed number of queries instead of per-row lookups."""
    if not invitations:
        return []

    invitation_ids = {invitation.id for invitation in invitations}
    visitor_ids = {invitation.visitor_id for invitation in invitations}
    vehicle_ids = {invitation.vehicle_id for invitation in invitations if invitation.vehicle_id}
    resident_ids = {invitation.resident_user_id for invitation in invitations}

    visitors = {row.id: row for row in db.scalars(select(Visitor).where(Visitor.id.in_(visitor_ids)))}
    vehicles = (
        {row.id: row for row in db.scalars(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))}
        if vehicle_ids
        else {}
    )
    residents = {row.id: row for row in db.scalars(select(User).where(User.id.in_(resident_ids)))}
    passes = {
        row.invitation_id: row
        for row in db.scalars(select(QRPass).where(QRPass.invitation_id.in_(invitation_ids)))
    }
    reservation_rows = db.scalars(
        select(ParkingReservation)
        .where(ParkingReservation.invitation_id.in_(invitation_ids))
        .order_by(ParkingReservation.created_at.desc())
    )
    reservations: dict[UUID, ParkingReservation] = {}
    for reservation in reservation_rows:
        reservations.setdefault(reservation.invitation_id, reservation)

    slot_ids = {reservation.slot_id for reservation in reservations.values()}
    slots = (
        {row.id: row for row in db.scalars(select(ParkingSlot).where(ParkingSlot.id.in_(slot_ids)))}
        if slot_ids
        else {}
    )
    zone_ids = {slot.zone_id for slot in slots.values()}
    zones = (
        {row.id: row for row in db.scalars(select(ParkingZone).where(ParkingZone.id.in_(zone_ids)))}
        if zone_ids
        else {}
    )

    serialized = []
    for invitation in invitations:
        visitor = visitors.get(invitation.visitor_id)
        vehicle = vehicles.get(invitation.vehicle_id) if invitation.vehicle_id else None
        resident = residents.get(invitation.resident_user_id)
        qr_pass = passes.get(invitation.id)
        reservation = reservations.get(invitation.id)
        slot = slots.get(reservation.slot_id) if reservation else None
        zone = zones.get(slot.zone_id) if slot else None
        serialized.append(
            {
                "id": invitation.id,
                "property_id": invitation.property_id,
                "resident_user_id": invitation.resident_user_id,
                "resident_name": resident.full_name if resident else "Resident",
                "visitor_name": visitor.name if visitor else "Visitor",
                "visitor_phone": visitor.phone if visitor else None,
                "vehicle_registration": vehicle.registration_number if vehicle else None,
                "vehicle_category": vehicle.category if vehicle else None,
                "visitor_type": invitation.visitor_type,
                "purpose": invitation.purpose,
                "expected_arrival": invitation.expected_arrival,
                "expected_departure": invitation.expected_departure,
                "status": invitation.status,
                "rejection_reason": invitation.rejection_reason,
                "approved_at": invitation.approved_at,
                "parking_slot_code": slot.code if slot else None,
                "parking_zone": zone.name if zone else None,
                "pass_expires_at": qr_pass.expires_at if qr_pass else None,
                "pass_status": qr_pass.status if qr_pass else None,
                "created_at": invitation.created_at,
            }
        )
    return serialized


def serialize_invitation(db: Session, invitation: Invitation) -> dict[str, Any]:
    return serialize_invitations(db, [invitation])[0]


def create_invitation(
    db: Session,
    *,
    resident: User,
    payload: InvitationCreate,
    ip_address: str | None = None,
) -> Invitation:
    if resident.role != Role.RESIDENT.value:
        raise ForbiddenError("Only residents can create visitor invitations")

    profile = get_resident_profile(db, resident.id)
    if profile is None:
        raise ForbiddenError("Resident profile is missing")
    if not profile.is_verified:
        raise ForbiddenError("Your resident account is not verified yet")

    prop = (
        db.scalar(
            select(Property).where(Property.id == resident.property_id).with_for_update()
        )
        if resident.property_id
        else None
    )
    if prop is None:
        raise ValidationError("Resident is not assigned to a property")
    if not prop.is_active:
        raise ConflictError(
            "This property is not accepting visitor invitations.",
            code="property_inactive",
        )

    arrival = ensure_utc(payload.expected_arrival)
    departure = ensure_utc(payload.expected_departure)
    now = utcnow()
    if arrival < now - timedelta(minutes=30):
        raise ValidationError("Expected arrival cannot be in the past")
    if arrival > now + timedelta(days=30):
        raise ValidationError("Invitations can be created at most 30 days in advance")

    policy = parking_service.get_policy(db, property_id=prop.id)
    active_count = int(
        db.scalar(
            select(func.count(Invitation.id)).where(
                Invitation.property_id == prop.id,
                Invitation.status.in_(
                    [InvitationStatus.PENDING.value, InvitationStatus.APPROVED.value]
                ),
                Invitation.expected_departure > now,
            )
        )
        or 0
    )
    if policy.max_active_visitors and active_count >= policy.max_active_visitors:
        raise ConflictError(
            "This property has reached its active visitor limit. Try again later.",
            code="visitor_limit_reached",
        )

    visitor: Visitor | None = None
    if payload.visitor_phone:
        visitor = db.scalar(
            select(Visitor).where(
                Visitor.property_id == prop.id, Visitor.phone == payload.visitor_phone
            )
        )
    if visitor is None:
        visitor = Visitor(
            organization_id=prop.organization_id,
            property_id=prop.id,
            name=payload.visitor_name.strip(),
            phone=payload.visitor_phone,
        )
        db.add(visitor)
        db.flush()

    vehicle: Vehicle | None = None
    if payload.vehicle_registration:
        registration = qr_service.normalize_plate(payload.vehicle_registration)
        assert registration is not None
        vehicle = db.scalar(
            select(Vehicle).where(
                Vehicle.organization_id == prop.organization_id,
                Vehicle.registration_number == registration,
            )
        )
        if vehicle is None:
            vehicle = Vehicle(
                organization_id=prop.organization_id,
                registration_number=registration,
                category=payload.vehicle_category.value,
            )
            db.add(vehicle)
            db.flush()

    invitation = Invitation(
        organization_id=prop.organization_id,
        property_id=prop.id,
        resident_user_id=resident.id,
        apartment_id=profile.apartment_id,
        visitor_id=visitor.id,
        vehicle_id=vehicle.id if vehicle else None,
        visitor_type=payload.visitor_type.value,
        purpose=payload.purpose,
        expected_arrival=arrival,
        expected_departure=departure,
        status=InvitationStatus.PENDING.value,
    )
    db.add(invitation)
    db.flush()

    audit_service.record(
        db,
        action="invitation.created",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=resident.id,
        entity_id=invitation.id,
        details={"visitor_type": invitation.visitor_type, "vehicle": bool(vehicle)},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(invitation)
    event_service.publish_event(
        "invitation.created",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "status": invitation.status},
    )
    return invitation


def approve_invitation(
    db: Session,
    *,
    user: User,
    invitation_id: UUID,
    ip_address: str | None = None,
) -> tuple[Invitation, str, ParkingSlot | None]:
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id).with_for_update()
    )
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _permission_check(db, user, invitation)

    prop = db.get(Property, invitation.property_id)
    if prop is None or not prop.is_active:
        raise ConflictError(
            "This property is not accepting visitor invitations.",
            code="property_inactive",
        )

    if invitation.status == InvitationStatus.APPROVED.value:
        raise ConflictError(
            "This invitation is already approved. The QR token is only shown once for security reasons.",
            code="already_approved",
        )
    if invitation.status != InvitationStatus.PENDING.value:
        raise ConflictError(
            f"An invitation in state {invitation.status} cannot be approved.",
            code="invalid_state",
        )

    policy = parking_service.get_policy(db, property_id=invitation.property_id)
    slot: ParkingSlot | None = None
    if invitation.vehicle_id is not None:
        _, slot, _ = parking_service.allocate_for_invitation(db, invitation=invitation)

    raw_token, token_hash = generate_pass_token()
    expires_at = min(
        ensure_utc(invitation.expected_departure),
        ensure_utc(invitation.expected_arrival) + timedelta(minutes=policy.qr_validity_minutes),
    )
    qr_pass = QRPass(
        organization_id=invitation.organization_id,
        invitation_id=invitation.id,
        token_hash=token_hash,
        status=PassStatus.ACTIVE.value,
        expires_at=expires_at,
    )
    db.add(qr_pass)

    invitation.status = InvitationStatus.APPROVED.value
    invitation.approved_at = utcnow()

    audit_service.record(
        db,
        action="invitation.approved",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        entity_id=invitation.id,
        details={"slot_code": slot.code if slot else None},
        ip_address=ip_address,
    )
    notification_service.notify_user(
        db,
        organization_id=invitation.organization_id,
        user_id=invitation.resident_user_id,
        title="Visitor pass issued",
        body=f"Pass issued for {invitation.visitor_type.lower()} visit"
        + (f" · slot {slot.code}" if slot else ""),
    )
    db.commit()
    db.refresh(invitation)
    event_service.publish_event(
        "invitation.approved",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "slot_code": slot.code if slot else None},
    )
    event_service.publish_event(
        "parking.updated",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "reason": "reservation_created"},
    )
    return invitation, raw_token, slot


def reject_invitation(
    db: Session,
    *,
    user: User,
    invitation_id: UUID,
    reason: str | None,
) -> Invitation:
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id).with_for_update()
    )
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _permission_check(db, user, invitation)
    if invitation.status != InvitationStatus.PENDING.value:
        raise ConflictError("Only pending invitations can be rejected", code="invalid_state")

    # A pending invitation can carry a manually allocated reservation. Rejecting
    # it must release that bay immediately instead of waiting for expiry.
    qr_service.revoke_pass(db, invitation.id)
    parking_service.release_reservation(db, invitation_id=invitation.id)
    invitation.status = InvitationStatus.REJECTED.value
    invitation.rejection_reason = reason
    audit_service.record(
        db,
        action="invitation.rejected",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        entity_id=invitation.id,
        details={"reason": reason},
    )
    db.commit()
    db.refresh(invitation)
    event_service.publish_event(
        "invitation.rejected",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id)},
    )
    event_service.publish_event(
        "parking.updated",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "reason": "invitation_rejected"},
    )
    return invitation


def cancel_invitation(
    db: Session,
    *,
    user: User,
    invitation_id: UUID,
    reason: str | None,
) -> Invitation:
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id).with_for_update()
    )
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _permission_check(db, user, invitation)

    if invitation.status not in {
        InvitationStatus.PENDING.value,
        InvitationStatus.APPROVED.value,
    }:
        raise ConflictError("This invitation can no longer be cancelled", code="invalid_state")

    qr_service.revoke_pass(db, invitation.id)
    parking_service.release_reservation(db, invitation_id=invitation.id)
    invitation.status = InvitationStatus.CANCELLED.value
    invitation.rejection_reason = reason

    audit_service.record(
        db,
        action="invitation.cancelled",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        entity_id=invitation.id,
        details={"reason": reason},
    )
    notification_service.notify_user(
        db,
        organization_id=invitation.organization_id,
        user_id=invitation.resident_user_id,
        title="Invitation cancelled",
        body="The visitor invitation and its parking reservation have been released.",
    )
    db.commit()
    db.refresh(invitation)
    event_service.publish_event(
        "invitation.cancelled",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id)},
    )
    event_service.publish_event(
        "parking.updated",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "reason": "reservation_released"},
    )
    return invitation


def visitor_pass_view(db: Session, raw_token: str) -> dict[str, Any]:
    from app.core.security import sha256_hex

    row = db.execute(
        select(QRPass, Invitation, Visitor, Vehicle, Property, Apartment)
        .join(Invitation, QRPass.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
        .join(Property, Invitation.property_id == Property.id)
        .outerjoin(Vehicle, Invitation.vehicle_id == Vehicle.id)
        .outerjoin(Apartment, Invitation.apartment_id == Apartment.id)
        .where(QRPass.token_hash == sha256_hex(raw_token))
    ).first()
    if row is None:
        raise NotFoundError("Pass not found")

    qr_pass, invitation, visitor, vehicle, prop, _apartment = row
    reservation = db.scalar(
        select(ParkingReservation).where(
            ParkingReservation.invitation_id == invitation.id,
            ParkingReservation.status == ReservationStatus.ACTIVE.value,
        )
    )
    slot = db.get(ParkingSlot, reservation.slot_id) if reservation else None
    zone = db.get(ParkingZone, slot.zone_id) if slot else None

    return {
        "visitor_name": visitor.name,
        "visitor_type": invitation.visitor_type,
        "property_name": prop.name,
        "property_address": ", ".join(
            [part for part in [prop.address_line, prop.city, prop.state, prop.pincode] if part]
        ),
        "expected_arrival": invitation.expected_arrival,
        "expected_departure": invitation.expected_departure,
        "status": invitation.status,
        "vehicle_registration": vehicle.registration_number if vehicle else None,
        "parking_slot_code": slot.code if slot else None,
        "parking_zone": zone.name if zone else None,
        "pass_expires_at": qr_pass.expires_at,
        "pass_status": qr_pass.status,
    }
