from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import sha256_hex
from app.core.time import ensure_utc, local_now, utcnow
from app.models import (
    Invitation,
    ParkingReservation,
    ParkingSlot,
    ParkingZone,
    Property,
    QRPass,
    SocietyPolicy,
    User,
    Vehicle,
    Visitor,
)
from app.models.enums import InvitationStatus, PassStatus, ReservationStatus, Role
from app.services.parking_service import get_policy

ARRIVAL_GRACE_MINUTES = 60


@dataclass
class PassVerdict:
    allowed: bool
    reason_code: str
    message: str
    pass_id: UUID | None = None
    invitation_id: UUID | None = None
    visitor_name: str | None = None
    visitor_type: str | None = None
    vehicle_registration: str | None = None
    expires_at: datetime | None = None
    slot_code: str | None = None
    zone_name: str | None = None
    details: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "reason_code": self.reason_code,
            "message": self.message,
            "invitation_id": str(self.invitation_id) if self.invitation_id else None,
            "visitor_name": self.visitor_name,
            "vehicle_registration": self.vehicle_registration,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "slot_code": self.slot_code,
        }


def normalize_plate(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = "".join(ch for ch in value.upper() if ch.isalnum())
    return cleaned or None


def _deny(reason: str, message: str, **kwargs) -> PassVerdict:
    return PassVerdict(allowed=False, reason_code=reason, message=message, **kwargs)


def within_visitor_window(policy: SocietyPolicy, prop: Property, moment: datetime) -> bool:
    current = local_now(prop.timezone or "Asia/Kolkata").strftime("%H:%M")
    start = policy.visitor_window_start or "00:00"
    end = policy.visitor_window_end or "23:59"
    if start <= end:
        return start <= current <= end
    # Overnight window, e.g. 18:00 -> 06:00.
    return current >= start or current <= end


def verify_pass(
    db: Session,
    *,
    raw_token: str,
    guard: User,
    plate_number: str | None = None,
) -> PassVerdict:
    """Evaluate every gate condition in a fixed order and return a verdict.

    A successful verification is advisory: entry is only authorized after the
    pass is consumed atomically by `consume_pass`.
    """
    token_hash = sha256_hex(raw_token)
    row = db.execute(
        select(QRPass, Invitation, Visitor, Vehicle, Property)
        .join(Invitation, QRPass.invitation_id == Invitation.id)
        .join(Visitor, Invitation.visitor_id == Visitor.id)
        .join(Property, Invitation.property_id == Property.id)
        .outerjoin(Vehicle, Invitation.vehicle_id == Vehicle.id)
        .where(QRPass.token_hash == token_hash)
    ).first()

    if row is None:
        return _deny("invalid_pass", "This QR pass is not recognised by ParkVanta.")

    qr_pass, invitation, visitor, vehicle, prop = row

    if guard.role != Role.SUPER_ADMIN.value:
        if guard.organization_id != invitation.organization_id:
            return _deny("wrong_society", "This pass belongs to another society.")
        if guard.property_id is not None and guard.property_id != invitation.property_id:
            return _deny("wrong_property", "This pass is for a different property.")

    base = dict(
        pass_id=qr_pass.id,
        invitation_id=invitation.id,
        visitor_name=visitor.name,
        visitor_type=invitation.visitor_type,
        vehicle_registration=vehicle.registration_number if vehicle else None,
        expires_at=qr_pass.expires_at,
    )

    if qr_pass.status == PassStatus.REVOKED.value:
        return _deny("revoked", "This pass has been revoked by the resident.", **base)

    if qr_pass.status == PassStatus.CONSUMED.value:
        return _deny("already_used", "This pass has already been used for entry.", **base)

    if qr_pass.status == PassStatus.EXPIRED.value:
        return _deny("expired", "This pass has expired.", **base)

    now = utcnow()
    if ensure_utc(qr_pass.expires_at) <= now:
        return _deny("expired", "This pass has expired.", **base)

    not_before = ensure_utc(invitation.expected_arrival)
    if (not_before - now).total_seconds() > ARRIVAL_GRACE_MINUTES * 60:
        return _deny(
            "not_yet_valid",
            "This pass is not valid yet. Ask the visitor to arrive closer to the scheduled time.",
            **base,
        )

    if invitation.status == InvitationStatus.PENDING.value:
        return _deny("awaiting_approval", "The resident has not approved this visit yet.", **base)
    if invitation.status == InvitationStatus.REJECTED.value:
        return _deny("rejected", "The resident rejected this visit.", **base)
    if invitation.status == InvitationStatus.CANCELLED.value:
        return _deny("cancelled", "This invitation was cancelled.", **base)
    if invitation.status == InvitationStatus.COMPLETED.value:
        return _deny("already_used", "This visit is already complete.", **base)
    if invitation.status != InvitationStatus.APPROVED.value:
        return _deny("not_approved", "This invitation is not in an approvable state.", **base)

    if plate_number:
        presented = normalize_plate(plate_number)
        expected = normalize_plate(vehicle.registration_number) if vehicle else None
        if expected and presented != expected:
            return _deny(
                "vehicle_mismatch",
                "The vehicle at the gate does not match the invited vehicle.",
                **base,
            )

    policy = get_policy(db, property_id=invitation.property_id)
    if not within_visitor_window(policy, prop, now):
        return _deny(
            "outside_visitor_window",
            f"Visitor entry is allowed between {policy.visitor_window_start} and {policy.visitor_window_end}.",
            **base,
        )

    reservation = db.scalar(
        select(ParkingReservation).where(
            ParkingReservation.invitation_id == invitation.id,
            ParkingReservation.status == ReservationStatus.ACTIVE.value,
        )
    )

    slot_code = None
    zone_name = None
    if reservation is not None:
        slot_row = db.execute(
            select(ParkingSlot, ParkingZone)
            .join(ParkingZone, ParkingSlot.zone_id == ParkingZone.id)
            .where(ParkingSlot.id == reservation.slot_id)
        ).first()
        if slot_row is not None:
            slot_code = slot_row[0].code
            zone_name = slot_row[1].name

    if invitation.vehicle_id is not None and reservation is None:
        return _deny(
            "no_slot_available",
            "No parking slot is reserved for this vehicle. Contact the society office.",
            **base,
        )

    return PassVerdict(
        allowed=True,
        reason_code="allowed",
        message="Pass verified. You may authorize entry.",
        slot_code=slot_code,
        zone_name=zone_name,
        **base,
    )


def consume_pass(db: Session, pass_id: UUID) -> bool:
    """Atomically consume a pass. Returns False if another scan won the race."""
    result = db.execute(
        update(QRPass)
        .where(QRPass.id == pass_id, QRPass.status == PassStatus.ACTIVE.value)
        .values(status=PassStatus.CONSUMED.value, consumed_at=utcnow())
    )
    return result.rowcount == 1


def revoke_pass(db: Session, invitation_id: UUID) -> None:
    qr_pass = db.scalar(select(QRPass).where(QRPass.invitation_id == invitation_id))
    if qr_pass is not None and qr_pass.status == PassStatus.ACTIVE.value:
        qr_pass.status = PassStatus.REVOKED.value
        qr_pass.revoked_at = utcnow()
