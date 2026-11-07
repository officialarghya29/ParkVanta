from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, client_ip
from app.database.session import get_db
from app.schemas.common import Page
from app.schemas.visitors import (
    ApproveResponse,
    CancelRequest,
    InvitationCreate,
    InvitationOut,
    RejectRequest,
)
from app.services import invitation_service

router = APIRouter(prefix="/invitations", tags=["Visitors & Invitations"])


@router.post("", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: InvitationCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> InvitationOut:
    invitation = invitation_service.create_invitation(
        db, resident=user, payload=payload, ip_address=client_ip(request)
    )
    return InvitationOut(**invitation_service.serialize_invitation(db, invitation))


@router.get("", response_model=Page[InvitationOut])
def list_invitations(
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[InvitationOut]:
    items, total = invitation_service.list_invitations(
        db, user, status=status_filter, search=search, limit=limit, offset=offset
    )
    return Page[InvitationOut](
        items=[InvitationOut(**invitation_service.serialize_invitation(db, inv)) for inv in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{invitation_id}", response_model=InvitationOut)
def get_invitation(
    invitation_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> InvitationOut:
    invitation = invitation_service.get_invitation(db, user, invitation_id)
    return InvitationOut(**invitation_service.serialize_invitation(db, invitation))


@router.post("/{invitation_id}/approve", response_model=ApproveResponse)
def approve_invitation(
    invitation_id: UUID,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> ApproveResponse:
    invitation, raw_token, slot = invitation_service.approve_invitation(
        db, user=user, invitation_id=invitation_id, ip_address=client_ip(request)
    )
    data = invitation_service.serialize_invitation(db, invitation)
    return ApproveResponse(
        invitation=InvitationOut(**data),
        pass_token=raw_token,
        pass_expires_at=data["pass_expires_at"],
        pass_url=f"/pass/{raw_token}",
        parking_slot_code=slot.code if slot else None,
    )


@router.post("/{invitation_id}/reject", response_model=InvitationOut)
def reject_invitation(
    invitation_id: UUID,
    payload: RejectRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> InvitationOut:
    invitation = invitation_service.reject_invitation(
        db, user=user, invitation_id=invitation_id, reason=payload.reason
    )
    return InvitationOut(**invitation_service.serialize_invitation(db, invitation))


@router.post("/{invitation_id}/cancel", response_model=InvitationOut)
def cancel_invitation(
    invitation_id: UUID,
    payload: CancelRequest,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> InvitationOut:
    invitation = invitation_service.cancel_invitation(
        db, user=user, invitation_id=invitation_id, reason=payload.reason
    )
    return InvitationOut(**invitation_service.serialize_invitation(db, invitation))
