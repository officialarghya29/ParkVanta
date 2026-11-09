from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import require_roles
from app.core.errors import ValidationError
from app.core.time import ensure_utc
from app.database.session import get_db
from app.models import AuditLog, User
from app.models.enums import Role
from app.schemas.audit import AuditLogOut
from app.schemas.common import Page

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

AuditUser = Annotated[
    User,
    Depends(require_roles(Role.SOCIETY_ADMIN, Role.SUPER_ADMIN)),
]


@router.get("", response_model=Page[AuditLogOut])
def list_audit_logs(
    db: Annotated[Session, Depends(get_db)],
    user: AuditUser,
    action: str | None = Query(default=None, min_length=1, max_length=80),
    entity_type: str | None = Query(default=None, min_length=1, max_length=60),
    actor_user_id: UUID | None = Query(default=None),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[AuditLogOut]:
    if from_at is not None and to_at is not None and ensure_utc(from_at) > ensure_utc(to_at):
        raise ValidationError("The audit window start must be before its end")

    stmt = (
        select(AuditLog, User.full_name.label("actor_name"))
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.organization_id == user.organization_id)
    )
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action, autoescape=True))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if actor_user_id is not None:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if from_at is not None:
        stmt = stmt.where(AuditLog.created_at >= ensure_utc(from_at))
    if to_at is not None:
        stmt = stmt.where(AuditLog.created_at <= ensure_utc(to_at))

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.execute(
        stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return Page[AuditLogOut](
        items=[
            AuditLogOut(
                id=row.id,
                actor_user_id=row.actor_user_id,
                actor_name=actor_name,
                action=row.action,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                ip_address=row.ip_address,
                details=row.details,
                created_at=row.created_at,
            )
            for row, actor_name in ((row[0], row[1]) for row in rows)
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
