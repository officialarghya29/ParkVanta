from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.time import utcnow
from app.models import (
    EntryExitEvent,
    Invitation,
    ParkingOccupancy,
    ParkingReservation,
    ParkingSlot,
    ParkingZone,
    User,
    Vehicle,
    Visitor,
)
from app.models.enums import (
    EventDecision,
    EventDirection,
    InvitationStatus,
    OccupancyStatus,
    Role,
)
from app.services import audit_service, event_service, notification_service, parking_service, qr_service


def _guard_scope(db: Session, guard: User, invitation: Invitation) -> None:
    if guard.role not in {
        Role.SECURITY_GUARD.value,
        Role.SUPER_ADMIN.value,
        Role.SOCIETY_ADMIN.value,
        Role.PROPERTY_MANAGER.value,
    }:
        raise ForbiddenError("Only gate staff can perform this action")
    if guard.role == Role.SUPER_ADMIN.value:
        return
    if guard.organization_id != invitation.organization_id:
        raise ForbiddenError("Cross-organization access is not permitted")
    if guard.property_id is not None and guard.property_id != invitation.property_id:
        raise ForbiddenError("You are not assigned to this property")


def authorize_entry(
    db: Session,
    *,
    guard: User,
    token: str,
    plate_number: str | None,
    ip_address: str | None,
) -> tuple[EntryExitEvent, Invitation, qr_service.PassVerdict]:
    verdict = qr_service.verify_pass(db, raw_token=token, guard=guard, plate_number=plate_number)

    if not verdict.allowed:
        if verdict.invitation_id is not None:
            invitation = db.get(Invitation, verdict.invitation_id)
            if invitation is not None:
                _guard_scope(db, guard, invitation)
                db.add(
                    EntryExitEvent(
                        organization_id=invitation.organization_id,
                        property_id=invitation.property_id,
                        invitation_id=invitation.id,
                        pass_id=verdict.pass_id,
                        guard_user_id=guard.id,
                        direction=EventDirection.ENTRY.value,
                        decision=EventDecision.DENIED.value,
                        reason=verdict.reason_code,
                        details={"message": verdict.message, "plate": plate_number},
                    )
                )
                audit_service.record(
                    db,
                    action="gate.entry_denied",
                    entity_type="invitation",
                    organization_id=invitation.organization_id,
                    actor_user_id=guard.id,
                    entity_id=invitation.id,
                    details={"reason": verdict.reason_code},
                    ip_address=ip_address,
                )
        db.commit()
        if verdict.invitation_id is not None:
            event_service.publish_event(
                "gate.entry_denied",
                property_id=db.get(Invitation, verdict.invitation_id).property_id,
                data={"invitation_id": str(verdict.invitation_id), "reason": verdict.reason_code},
            )
        status = 409 if verdict.reason_code in {"already_used", "expired"} else 403
        raise AppError(
            verdict.message,
            code=verdict.reason_code,
            status_code=status,
            details=verdict.as_dict(),
        )

    if verdict.pass_id is None or verdict.invitation_id is None:
        raise ConflictError("Pass verification returned incomplete data", code="invalid_pass")

    invitation = db.scalar(
        select(Invitation).where(Invitation.id == verdict.invitation_id).with_for_update()
    )
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _guard_scope(db, guard, invitation)

    if not qr_service.consume_pass(db, verdict.pass_id):
        db.rollback()
        raise ConflictError(
            "This pass was used a moment ago by another scan.",
            code="already_used",
        )

    event = EntryExitEvent(
        organization_id=invitation.organization_id,
        property_id=invitation.property_id,
        invitation_id=invitation.id,
        pass_id=verdict.pass_id,
        guard_user_id=guard.id,
        direction=EventDirection.ENTRY.value,
        decision=EventDecision.AUTHORIZED.value,
        reason="pass_verified",
        details={
            "plate": plate_number,
            "slot_code": verdict.slot_code,
            "authorization": "advisory_only",
        },
    )
    db.add(event)

    audit_service.record(
        db,
        action="gate.entry_authorized",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=guard.id,
        entity_id=invitation.id,
        details={"slot_code": verdict.slot_code, "plate": plate_number},
        ip_address=ip_address,
    )
    notification_service.notify_user(
        db,
        organization_id=invitation.organization_id,
        user_id=invitation.resident_user_id,
        title="Visitor authorized at the gate",
        body=f"{verdict.visitor_name} has been authorized for entry"
        + (f" · slot {verdict.slot_code}" if verdict.slot_code else ""),
    )
    db.commit()
    db.refresh(event)
    event_service.publish_event(
        "gate.entry_authorized",
        property_id=invitation.property_id,
        data={"invitation_id": str(invitation.id), "slot_code": verdict.slot_code},
    )
    return event, invitation, verdict


def confirm_entry(
    db: Session,
    *,
    guard: User,
    invitation_id: UUID,
    ip_address: str | None,
) -> tuple[ParkingOccupancy | None, ParkingSlot | None, bool]:
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id).with_for_update()
    )
    if invitation is None:
        raise NotFoundError("Invitation not found")
    _guard_scope(db, guard, invitation)

    if invitation.status == InvitationStatus.COMPLETED.value:
        raise ConflictError("This visit is already complete", code="already_exited")
    if invitation.status != InvitationStatus.APPROVED.value:
        raise ConflictError(
            "Only an approved invitation can be confirmed at the gate",
            code="invalid_state",
        )

    # Physical entry is only a confirmation of an authorization that already
    # happened online. Without this check a caller could create an occupancy
    # directly, bypassing the single-use pass entirely.
    authorized = db.scalar(
        select(EntryExitEvent.id).where(
            EntryExitEvent.invitation_id == invitation.id,
            EntryExitEvent.direction == EventDirection.ENTRY.value,
            EntryExitEvent.decision == EventDecision.AUTHORIZED.value,
        )
    )
    if authorized is None:
        raise ConflictError(
            "Entry has not been authorized online. Verify the pass first.",
            code="authorization_required",
        )

    occupancy: ParkingOccupancy | None = None
    slot: ParkingSlot | None = None
    already = False
    if invitation.vehicle_id is not None:
        occupancy, slot, already = parking_service.confirm_entry(db, invitation=invitation)
    else:
        # Pedestrian visits have no occupancy row, so their confirmation needs
        # its own idempotency check to avoid duplicate events on retries.
        already = (
            db.scalar(
                select(EntryExitEvent.id).where(
                    EntryExitEvent.invitation_id == invitation.id,
                    EntryExitEvent.direction == EventDirection.ENTRY.value,
                    EntryExitEvent.decision == EventDecision.CONFIRMED.value,
                )
            )
            is not None
        )

    if not already:
        db.add(
            EntryExitEvent(
                organization_id=invitation.organization_id,
                property_id=invitation.property_id,
                invitation_id=invitation.id,
                guard_user_id=guard.id,
                direction=EventDirection.ENTRY.value,
                decision=EventDecision.CONFIRMED.value,
                reason="vehicle_inside" if occupancy else "pedestrian_entry",
                details={"slot_code": slot.code if slot else None},
            )
        )
        audit_service.record(
            db,
            action="gate.entry_confirmed",
            entity_type="invitation",
            organization_id=invitation.organization_id,
            actor_user_id=guard.id,
            entity_id=invitation.id,
            details={"slot_code": slot.code if slot else None},
            ip_address=ip_address,
        )
        notification_service.notify_user(
            db,
            organization_id=invitation.organization_id,
            user_id=invitation.resident_user_id,
            title="Visitor entered",
            body=f"{invitation.visitor_type.lower()} visitor is now inside"
            + (f" · parked at {slot.code}" if slot else ""),
        )

    db.commit()
    if occupancy is not None:
        db.refresh(occupancy)
    if slot is not None:
        db.refresh(slot)
    event_service.publish_event(
        "gate.entry_confirmed",
        property_id=invitation.property_id,
        data={
            "invitation_id": str(invitation.id),
            "slot_code": slot.code if slot else None,
            "slot_status": slot.status if slot else None,
        },
    )
    event_service.publish_event(
        "parking.updated",
        property_id=invitation.property_id,
        data={"reason": "occupancy_confirmed"},
    )
    return occupancy, slot, already


def confirm_exit(
    db: Session,
    *,
    guard: User,
    invitation_id: UUID | None,
    slot_code: str | None,
    property_id: UUID | None,
    ip_address: str | None,
) -> tuple[ParkingOccupancy, ParkingSlot, int, bool]:
    target_property = property_id or guard.property_id
    invitation: Invitation | None = None

    if invitation_id is not None:
        invitation = db.get(Invitation, invitation_id)
        if invitation is None:
            raise NotFoundError("Invitation not found")
        _guard_scope(db, guard, invitation)
        target_property = invitation.property_id
    elif slot_code is not None:
        if target_property is None:
            raise ValidationError("Property is required when exiting by slot code")
    else:
        raise ValidationError("Provide either an invitation or a slot code")

    assert target_property is not None
    if guard.property_id is not None and guard.property_id != target_property:
        raise ForbiddenError("You are not assigned to this property")

    occupancy, slot, duration, overstay = parking_service.release_occupancy(
        db, property_id=target_property, invitation_id=invitation_id, slot_code=slot_code
    )

    resolved_id = invitation.id if invitation else occupancy.invitation_id
    db.add(
        EntryExitEvent(
            organization_id=occupancy.organization_id,
            property_id=occupancy.property_id,
            invitation_id=resolved_id,
            guard_user_id=guard.id,
            direction=EventDirection.EXIT.value,
            decision=EventDecision.RELEASED.value,
            reason="overstay" if overstay else "exit_confirmed",
            details={"slot_code": slot.code, "duration_minutes": duration},
        )
    )
    audit_service.record(
        db,
        action="gate.exit_confirmed",
        entity_type="invitation",
        organization_id=occupancy.organization_id,
        actor_user_id=guard.id,
        entity_id=resolved_id,
        details={"slot_code": slot.code, "duration_minutes": duration, "overstay": overstay},
        ip_address=ip_address,
    )
    resident = db.get(Invitation, resolved_id)
    if resident is not None:
        notification_service.notify_user(
            db,
            organization_id=occupancy.organization_id,
            user_id=resident.resident_user_id,
            title="Visitor exited",
            body=f"Slot {slot.code} has been released after {duration} minutes.",
        )
    db.commit()
    db.refresh(occupancy)
    db.refresh(slot)
    event_service.publish_event(
        "gate.exit_confirmed",
        property_id=occupancy.property_id,
        data={"invitation_id": str(occupancy.invitation_id), "slot_code": slot.code},
    )
    event_service.publish_event(
        "parking.updated",
        property_id=occupancy.property_id,
        data={"reason": "occupancy_released"},
    )
    return occupancy, slot, duration, overstay


def manual_override(
    db: Session,
    *,
    guard: User,
    reason: str,
    direction: str,
    invitation_id: UUID | None,
    plate_number: str | None,
    ip_address: str | None,
) -> EntryExitEvent:
    if guard.role not in {
        Role.SECURITY_GUARD.value,
        Role.SOCIETY_ADMIN.value,
        Role.PROPERTY_MANAGER.value,
        Role.SUPER_ADMIN.value,
    }:
        raise ForbiddenError("Only gate staff can record a manual override")

    invitation = db.get(Invitation, invitation_id) if invitation_id else None
    if invitation_id is not None and invitation is None:
        raise NotFoundError("Invitation not found")
    if invitation is not None:
        _guard_scope(db, guard, invitation)
        policy = parking_service.get_policy(db, property_id=invitation.property_id)
        organization_id = invitation.organization_id
        property_id = invitation.property_id
    else:
        if guard.property_id is None:
            raise ValidationError("An invitation or an assigned property is required")
        policy = parking_service.get_policy(db, property_id=guard.property_id)
        organization_id = guard.organization_id
        property_id = guard.property_id

    if not policy.allow_manual_override:
        raise ForbiddenError("Manual override is disabled for this property")

    if len(reason.strip()) < 10:
        raise ValidationError("A specific reason of at least 10 characters is required")

    if direction == EventDirection.EXIT.value and invitation is not None:
        try:
            parking_service.release_occupancy(
                db, property_id=invitation.property_id, invitation_id=invitation.id
            )
        except ConflictError:
            pass  # The vehicle was already released; the override still needs to be recorded.

    event = EntryExitEvent(
        organization_id=organization_id,
        property_id=property_id,
        invitation_id=invitation.id if invitation else None,
        guard_user_id=guard.id,
        direction=direction,
        decision=EventDecision.MANUAL_OVERRIDE.value,
        reason=reason.strip(),
        details={"plate": plate_number, "override": True},
    )
    db.add(event)
    audit_service.record(
        db,
        action="gate.manual_override",
        entity_type="invitation" if invitation else "property",
        organization_id=organization_id,
        actor_user_id=guard.id,
        entity_id=invitation.id if invitation else property_id,
        details={"reason": reason.strip(), "direction": direction, "plate": plate_number},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(event)
    event_service.publish_event(
        "gate.manual_override",
        property_id=property_id,
        data={"event_id": str(event.id), "direction": direction, "reason": reason.strip()},
    )
    return event


def active_visitors(db: Session, *, guard: User, property_id: UUID | None) -> list[dict]:
    target = property_id or guard.property_id
    stmt = (
        select(
            ParkingOccupancy,
            Invitation,
            Visitor,
            Vehicle,
            ParkingSlot,
            ParkingZone,
            ParkingReservation,
        )
        .join(Invitation, ParkingOccupancy.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
        .outerjoin(Vehicle, Invitation.vehicle_id == Vehicle.id)
        .join(ParkingSlot, ParkingOccupancy.slot_id == ParkingSlot.id)
        .join(ParkingZone, ParkingSlot.zone_id == ParkingZone.id)
        .join(ParkingReservation, ParkingOccupancy.reservation_id == ParkingReservation.id)
        .where(ParkingOccupancy.status == OccupancyStatus.ACTIVE.value)
    )
    if guard.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(ParkingOccupancy.organization_id == guard.organization_id)
    if target is not None:
        stmt = stmt.where(ParkingOccupancy.property_id == target)

    rows = db.execute(stmt.order_by(ParkingOccupancy.entered_at.desc())).all()
    return [
        {
            "invitation_id": invitation.id,
            "visitor_name": visitor.name,
            "vehicle_registration": vehicle.registration_number if vehicle else None,
            "slot_code": slot.code,
            "zone_name": zone.name,
            "entered_at": occupancy.entered_at,
            "expected_departure": reservation.reserved_until,
            "overstay": occupancy.overstay
            or reservation.reserved_until < utcnow(),
        }
        for occupancy, invitation, visitor, vehicle, slot, zone, reservation in rows
    ]


def recent_activity(db: Session, *, guard: User, limit: int = 25) -> list[dict]:
    stmt = (
        select(EntryExitEvent, Visitor, User)
        .outerjoin(Invitation, EntryExitEvent.invitation_id == Invitation.id)
        .outerjoin(Visitor, Invitation.visitor_id == Visitor.id)
        .join(User, EntryExitEvent.guard_user_id == User.id)
    )
    if guard.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(EntryExitEvent.organization_id == guard.organization_id)
    if guard.property_id is not None:
        stmt = stmt.where(EntryExitEvent.property_id == guard.property_id)
    rows = db.execute(stmt.order_by(EntryExitEvent.created_at.desc()).limit(limit)).all()
    return [
        {
            "id": event.id,
            "direction": event.direction,
            "decision": event.decision,
            "reason": event.reason,
            "visitor_name": visitor.name if visitor else None,
            "guard_name": personnel.full_name,
            "created_at": event.created_at,
        }
        for event, visitor, personnel in rows
    ]
