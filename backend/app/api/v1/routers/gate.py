from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, require_roles
from app.core.errors import ValidationError
from app.database.session import get_db
from app.models import User
from app.models.enums import Role
from app.schemas.gate import (
    ActiveVisitorOut,
    ConfirmEntryRequest,
    ConfirmEntryResponse,
    EntryAuthorizeRequest,
    EntryAuthorizeResponse,
    ExitConfirmRequest,
    ExitConfirmResponse,
    GateEventOut,
    ManualOverrideRequest,
    ManualOverrideResponse,
)
from app.schemas.offline import OfflineReconcileRequest, OfflineReconcileResponse
from app.services import gate_service, offline_service

router = APIRouter(prefix="/gate", tags=["Gate Operations"])

GateUser = Annotated[
    User,
    Depends(
        require_roles(
            Role.SECURITY_GUARD, Role.SOCIETY_ADMIN, Role.PROPERTY_MANAGER, Role.SUPER_ADMIN
        )
    ),
]


@router.post("/entry/authorize", response_model=EntryAuthorizeResponse)
def authorize_entry(
    payload: EntryAuthorizeRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
) -> EntryAuthorizeResponse:
    event, invitation, verdict = gate_service.authorize_entry(
        db, guard=guard, token=payload.token, plate_number=payload.plate_number, ip_address=client_ip(request)
    )
    return EntryAuthorizeResponse(
        entry_event_id=event.id,
        invitation_id=invitation.id,
        visitor_name=verdict.visitor_name or "Visitor",
        parking_slot_code=verdict.slot_code,
        authorized_at=event.created_at,
        gate_opening_requested=False,
        next_step="Confirm the vehicle physically entered the gate to occupy the slot",
    )


@router.post("/entry/confirm", response_model=ConfirmEntryResponse)
def confirm_entry(
    payload: ConfirmEntryRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
) -> ConfirmEntryResponse:
    occupancy, slot, already = gate_service.confirm_entry(
        db, guard=guard, invitation_id=payload.invitation_id, ip_address=client_ip(request)
    )
    return ConfirmEntryResponse(
        occupancy_id=occupancy.id if occupancy else None,
        slot_code=slot.code if slot else None,
        slot_status=slot.status if slot else None,
        entered_at=occupancy.entered_at if occupancy else None,
        already_confirmed=already,
    )


@router.post("/exit/confirm", response_model=ExitConfirmResponse)
def confirm_exit(
    payload: ExitConfirmRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
) -> ExitConfirmResponse:
    occupancy, slot, duration, overstay = gate_service.confirm_exit(
        db,
        guard=guard,
        invitation_id=payload.invitation_id,
        slot_code=payload.slot_code,
        property_id=payload.property_id,
        ip_address=client_ip(request),
    )
    return ExitConfirmResponse(
        occupancy_id=occupancy.id,
        invitation_id=occupancy.invitation_id,
        slot_code=slot.code,
        released_at=occupancy.exited_at,
        duration_minutes=duration,
        overstay=overstay,
    )


@router.post("/manual-override", response_model=ManualOverrideResponse)
def manual_override(
    payload: ManualOverrideRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
) -> ManualOverrideResponse:
    event = gate_service.manual_override(
        db,
        guard=guard,
        reason=payload.reason,
        direction=payload.direction,
        invitation_id=payload.invitation_id,
        plate_number=payload.plate_number,
        ip_address=client_ip(request),
    )
    return ManualOverrideResponse(
        event_id=event.id,
        recorded_at=event.created_at,
        message="Manual override recorded in the audit trail",
    )


@router.post("/offline/reconcile", response_model=OfflineReconcileResponse)
def reconcile_offline(
    payload: OfflineReconcileRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
) -> OfflineReconcileResponse:
    results = offline_service.reconcile(
        db,
        guard=guard,
        property_id=payload.property_id,
        device_id=payload.device_id,
        actions=payload.actions,
        ip_address=client_ip(request),
    )
    return OfflineReconcileResponse(
        device_id=payload.device_id,
        received=len(results),
        applied=sum(1 for row in results if row["status"] in {"applied", "already_applied"}),
        duplicates=sum(1 for row in results if row["status"] == "duplicate"),
        rejected=sum(1 for row in results if row["status"] == "rejected"),
        results=results,
    )


@router.get("/active-visitors", response_model=list[ActiveVisitorOut])
def active_visitors(
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
    property_id: UUID | None = Query(default=None),
) -> list[ActiveVisitorOut]:
    if guard.property_id is None and property_id is None and guard.role != Role.SUPER_ADMIN.value:
        raise ValidationError("property_id is required for society-wide accounts")
    rows = gate_service.active_visitors(db, guard=guard, property_id=property_id)
    return [ActiveVisitorOut(**row) for row in rows]


@router.get("/recent-activity", response_model=list[GateEventOut])
def recent_activity(
    db: Annotated[Session, Depends(get_db)],
    guard: GateUser,
    limit: int = Query(default=25, ge=1, le=100),
) -> list[GateEventOut]:
    rows = gate_service.recent_activity(db, guard=guard, limit=limit)
    return [GateEventOut(**row) for row in rows]
