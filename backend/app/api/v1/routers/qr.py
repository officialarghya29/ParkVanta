from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, client_ip, require_roles
from app.core.errors import ForbiddenError, NotFoundError
from app.database.session import get_db
from app.models import Invitation, ParkingReservation, QRPass, User
from app.models.enums import Role
from app.schemas.gate import VerifyRequest, VerifyResponse
from app.schemas.visitors import VisitorPassOut
from app.services import audit_service, invitation_service, qr_service

router = APIRouter(prefix="/qr", tags=["QR Passes"])

StaffUser = Annotated[
    User,
    Depends(
        require_roles(
            Role.SECURITY_GUARD, Role.SOCIETY_ADMIN, Role.PROPERTY_MANAGER, Role.SUPER_ADMIN
        )
    ),
]


class RevokeRequest(BaseModel):
    invitation_id: UUID
    reason: str | None = Field(default=None, max_length=255)


@router.post("/verify", response_model=VerifyResponse)
def verify_qr(
    payload: VerifyRequest,
    db: Annotated[Session, Depends(get_db)],
    guard: StaffUser,
) -> VerifyResponse:
    verdict = qr_service.verify_pass(
        db, raw_token=payload.token, guard=guard, plate_number=payload.plate_number
    )
    return VerifyResponse(
        allowed=verdict.allowed,
        reason_code=verdict.reason_code,
        message=verdict.message,
        invitation_id=verdict.invitation_id,
        visitor_name=verdict.visitor_name,
        visitor_type=verdict.visitor_type,
        vehicle_registration=verdict.vehicle_registration,
        pass_expires_at=verdict.expires_at,
        parking_slot_code=verdict.slot_code,
        parking_zone=verdict.zone_name,
        requires_confirmation=verdict.allowed,
    )


@router.get("/pass/{token}", response_model=VisitorPassOut)
def public_pass_view(token: str, db: Annotated[Session, Depends(get_db)]) -> VisitorPassOut:
    """Visitor-safe view. Possession of the unguessable token is the credential."""
    return VisitorPassOut(**invitation_service.visitor_pass_view(db, token))


@router.get("/{pass_id}/status", response_model=dict)
def pass_status(
    pass_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: StaffUser,
) -> dict:
    qr_pass = db.get(QRPass, pass_id)
    if qr_pass is None:
        raise NotFoundError("Pass not found")
    invitation = db.get(Invitation, qr_pass.invitation_id)
    if invitation is None:
        raise NotFoundError("Invitation not found")
    if user.role != Role.SUPER_ADMIN.value:
        if invitation.organization_id != user.organization_id:
            raise ForbiddenError("Cross-organization access is not permitted")
        if user.property_id is not None and user.property_id != invitation.property_id:
            raise ForbiddenError("You are not assigned to this property")
    reservation = db.scalar(
        select(ParkingReservation).where(ParkingReservation.invitation_id == invitation.id)
    )
    return {
        "pass_id": str(qr_pass.id),
        "status": qr_pass.status,
        "expires_at": qr_pass.expires_at.isoformat(),
        "invitation_id": str(invitation.id),
        "invitation_status": invitation.status,
        "reservation_status": reservation.status if reservation else None,
    }


@router.post("/revoke", response_model=dict, status_code=status.HTTP_200_OK)
def revoke_pass(
    payload: RevokeRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> dict:
    invitation = invitation_service.get_invitation(db, user, payload.invitation_id)
    invitation_service.cancel_invitation(
        db, user=user, invitation_id=invitation.id, reason=payload.reason or "Pass revoked"
    )
    audit_service.record(
        db,
        action="qr.pass_revoked",
        entity_type="invitation",
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        entity_id=invitation.id,
        details={"reason": payload.reason},
        ip_address=client_ip(request),
    )
    db.commit()
    return {"message": "Pass revoked and parking reservation released", "invitation_id": str(invitation.id)}
