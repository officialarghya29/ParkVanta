from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.deps import assert_property_access, get_current_user, require_roles
from app.core.errors import NotFoundError, ValidationError
from app.core.time import utcnow
from app.database.session import get_db
from app.models import Notification, User
from app.models.enums import Role
from app.schemas.analytics import (
    NotificationOut,
    OverstayRow,
    OverviewOut,
    TrendPoint,
    UnreadCountOut,
    UtilizationRow,
)
from app.schemas.common import Message, Page
from app.services import analytics_service

router = APIRouter(tags=["Analytics & Notifications"])

AnalyticsUser = Annotated[
    User,
    Depends(
        require_roles(
            Role.SOCIETY_ADMIN, Role.PROPERTY_MANAGER, Role.SECURITY_GUARD, Role.SUPER_ADMIN
        )
    ),
]


def _resolve_property(db: Session, user: User, property_id: UUID | None) -> UUID:
    target = property_id or user.property_id
    if target is None:
        raise ValidationError("property_id is required for society-wide accounts")
    assert_property_access(db, user, target)
    return target


@router.get("/analytics/overview", response_model=OverviewOut)
def overview(
    db: Annotated[Session, Depends(get_db)],
    user: AnalyticsUser,
    property_id: UUID | None = Query(default=None),
) -> OverviewOut:
    target = _resolve_property(db, user, property_id)
    return OverviewOut(**analytics_service.overview(db, property_id=target))


@router.get("/analytics/parking-utilization", response_model=list[UtilizationRow])
def parking_utilization(
    db: Annotated[Session, Depends(get_db)],
    user: AnalyticsUser,
    property_id: UUID | None = Query(default=None),
) -> list[UtilizationRow]:
    target = _resolve_property(db, user, property_id)
    return [UtilizationRow(**row) for row in analytics_service.utilization_by_zone(db, property_id=target)]


@router.get("/analytics/visitor-trends", response_model=list[TrendPoint])
def visitor_trends(
    db: Annotated[Session, Depends(get_db)],
    user: AnalyticsUser,
    property_id: UUID | None = Query(default=None),
    days: int = Query(default=14, ge=1, le=90),
) -> list[TrendPoint]:
    target = _resolve_property(db, user, property_id)
    return [
        TrendPoint(**row)
        for row in analytics_service.visitor_trends(db, property_id=target, days=days)
    ]


@router.get("/analytics/overstays", response_model=list[OverstayRow])
def overstays(
    db: Annotated[Session, Depends(get_db)],
    user: AnalyticsUser,
    property_id: UUID | None = Query(default=None),
) -> list[OverstayRow]:
    target = _resolve_property(db, user, property_id)
    return [OverstayRow(**row) for row in analytics_service.overstays(db, property_id=target)]


@router.get("/notifications", response_model=Page[NotificationOut])
def my_notifications(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
) -> Page[NotificationOut]:
    base = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(base.order_by(Notification.created_at.desc()).limit(limit).offset(offset))
    )
    return Page[NotificationOut](
        items=[NotificationOut.model_validate(n) for n in items], total=total, limit=limit, offset=offset
    )


@router.get("/notifications/unread-count", response_model=UnreadCountOut)
def unread_notification_count(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> UnreadCountOut:
    count = int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id, Notification.read_at.is_(None)
            )
        )
        or 0
    )
    return UnreadCountOut(count=count)


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationOut:
    note = db.get(Notification, notification_id)
    if note is None or note.user_id != user.id:
        raise NotFoundError("Notification not found")
    if note.read_at is None:
        note.read_at = utcnow()
        db.commit()
        db.refresh(note)
    return NotificationOut.model_validate(note)


@router.post("/notifications/read-all", response_model=Message)
def mark_all_notifications_read(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Message:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    db.commit()
    return Message(message=f"{int(result.rowcount or 0)} notifications marked read")
