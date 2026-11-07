from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import CurrentUser, assert_property_access
from app.core.errors import AuthError
from app.core.security import TokenError, create_stream_token, decode_stream_token
from app.database.session import SessionLocal, get_db
from app.models import User
from app.services import event_service

router = APIRouter(prefix="/events", tags=["Realtime"])


class TicketRequest(BaseModel):
    property_id: UUID


class TicketResponse(BaseModel):
    ticket: str
    expires_in: int


@router.post("/ticket", response_model=TicketResponse, summary="Mint a short-lived SSE ticket")
def issue_ticket(
    payload: TicketRequest,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
) -> TicketResponse:
    assert_property_access(db, user, payload.property_id)
    ticket = create_stream_token(
        user_id=user.id,
        organization_id=user.organization_id,
        property_id=payload.property_id,
    )
    return TicketResponse(
        ticket=ticket, expires_in=settings.stream_ticket_minutes * 60
    )


@router.get(
    "/stream",
    summary="Server-sent events for a property (advisory; REST remains authoritative)",
)
async def stream(
    ticket: str = Query(min_length=20),
    last_event_id: str | None = Query(default=None, max_length=64),
    last_event_id_header: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    try:
        claims = decode_stream_token(ticket)
    except TokenError as exc:
        raise AuthError("Stream ticket is invalid or expired") from exc

    try:
        property_id = UUID(claims["property"])
        user_id = UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise AuthError("Stream ticket is malformed") from exc

    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active or user.is_suspended:
            raise AuthError("Account is not active")
        if claims.get("org") != str(user.organization_id):
            raise AuthError("Stream ticket does not match the account organization")
        assert_property_access(db, user, property_id)

    return StreamingResponse(
        event_service.event_stream(property_id, last_event_id_header or last_event_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
