"""Reconcile gate actions recorded while a device was offline.

Trust boundary: an offline device may not authorize entry. It may queue an exit
confirmation, an audited manual override, or the physical entry confirmation of
a pass that was already authorized online. Every queued action carries a client
event id; the unique ledger constraint makes replay harmless.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import assert_property_access
from app.core.errors import AppError, ConflictError, ForbiddenError, ValidationError
from app.core.time import utcnow
from app.models import EntryExitEvent, OfflineGateAction, User
from app.models.enums import EventDecision, EventDirection, Role
from app.services import gate_service

ALLOWED_ROLES = {
    Role.SECURITY_GUARD.value,
    Role.SOCIETY_ADMIN.value,
    Role.PROPERTY_MANAGER.value,
    Role.SUPER_ADMIN.value,
}

MAX_CLOCK_SKEW = timedelta(minutes=5)
MAX_OFFLINE_AGE = timedelta(days=7)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _rejected(action, code: str, message: str) -> dict:
    return {
        "client_event_id": action.client_event_id,
        "action": action.action,
        "status": "rejected",
        "code": code,
        "message": message,
        "result": {},
    }


def _duplicate(action) -> dict:
    return {
        "client_event_id": action.client_event_id,
        "action": action.action,
        "status": "duplicate",
        "message": "This client event id was already reconciled",
        "result": {},
    }


def _apply(
    db: Session, guard: User, action, ip_address: str | None, property_id: UUID
) -> dict:
    if action.action == "ENTRY_CONFIRM":
        if action.invitation_id is None:
            raise ValidationError("invitation_id is required for an offline entry confirmation")
        authorized = db.scalar(
            select(EntryExitEvent.id).where(
                EntryExitEvent.invitation_id == action.invitation_id,
                EntryExitEvent.direction == EventDirection.ENTRY.value,
                EntryExitEvent.decision == EventDecision.AUTHORIZED.value,
            )
        )
        if authorized is None:
            raise ConflictError(
                "Entry was not authorized online; an offline device cannot authorize a pass",
                code="authorization_required",
            )
        occupancy, slot, already = gate_service.confirm_entry(
            db,
            guard=guard,
            invitation_id=action.invitation_id,
            ip_address=ip_address,
        )
        return {
            "status": "applied",
            "occupancy_id": str(occupancy.id) if occupancy else None,
            "slot_code": slot.code if slot else None,
            "already_confirmed": already,
        }

    if action.action == "EXIT_CONFIRM":
        try:
            occupancy, slot, duration, overstay = gate_service.confirm_exit(
                db,
                guard=guard,
                invitation_id=action.invitation_id,
                slot_code=action.slot_code,
                property_id=property_id,
                ip_address=ip_address,
            )
        except ConflictError as exc:
            if getattr(exc, "code", None) == "already_exited":
                return {
                    "status": "already_applied",
                    "message": "This exit was already recorded by another request",
                }
            raise
        return {
            "status": "applied",
            "occupancy_id": str(occupancy.id),
            "invitation_id": str(occupancy.invitation_id),
            "slot_code": slot.code,
            "duration_minutes": duration,
            "overstay": overstay,
        }

    if action.action == "MANUAL_OVERRIDE":
        if direction := (action.direction or EventDirection.ENTRY.value):
            if direction not in {EventDirection.ENTRY.value, EventDirection.EXIT.value}:
                raise ValidationError("direction must be ENTRY or EXIT")
        if not action.reason or len(action.reason.strip()) < 10:
            raise ValidationError("A specific reason of at least 10 characters is required")
        event = gate_service.manual_override(
            db,
            guard=guard,
            reason=action.reason,
            direction=action.direction or EventDirection.ENTRY.value,
            invitation_id=action.invitation_id,
            plate_number=action.plate_number,
            ip_address=ip_address,
        )
        return {"status": "applied", "event_id": str(event.id)}

    raise ValidationError("Unsupported offline gate action")


def reconcile(
    db: Session,
    *,
    guard: User,
    property_id: UUID,
    device_id: str,
    actions: list,
    ip_address: str | None,
) -> list[dict]:
    if guard.role not in ALLOWED_ROLES:
        raise ForbiddenError("Only gate staff can reconcile offline actions")

    prop = assert_property_access(db, guard, property_id)
    now = utcnow()
    results: list[dict] = []

    for action in actions:
        recorded_at = _as_utc(action.recorded_at)
        if recorded_at > now + MAX_CLOCK_SKEW:
            results.append(
                _rejected(action, "clock_mismatch", "Device timestamp is ahead of the server clock")
            )
            continue
        if recorded_at < now - MAX_OFFLINE_AGE:
            results.append(
                _rejected(action, "stale_action", "Offline action is older than the 7-day replay window")
            )
            continue

        existing = db.scalar(
            select(OfflineGateAction.id).where(
                OfflineGateAction.property_id == property_id,
                OfflineGateAction.client_event_id == action.client_event_id,
            )
        )
        if existing is not None:
            results.append(_duplicate(action))
            continue

        try:
            outcome = _apply(db, guard, action, ip_address, property_id)
        except AppError as exc:
            db.rollback()
            results.append(
                _rejected(
                    action,
                    getattr(exc, "code", "rejected"),
                    getattr(exc, "message", str(exc)),
                )
            )
            continue

        status = outcome.pop("status", "applied")
        db.add(
            OfflineGateAction(
                organization_id=prop.organization_id,
                property_id=property_id,
                guard_user_id=guard.id,
                client_event_id=action.client_event_id,
                action=action.action,
                status=status.upper(),
                device_id=device_id,
                recorded_at=recorded_at,
                result=outcome,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            results.append(_duplicate(action))
            continue

        results.append(
            {
                "client_event_id": action.client_event_id,
                "action": action.action,
                "status": status,
                "result": outcome,
            }
        )

    return results
