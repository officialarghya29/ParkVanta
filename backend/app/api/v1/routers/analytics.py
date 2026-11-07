from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import assert_property_access, get_current_user, require_roles
from app.core.errors import ValidationError
from app.database.session import get_db
from app.models import Notification, User
from app.models.enums import Role
from app.schemas.analytics import (
    NotificationOut,
    OverstayRow,
    OverviewOut,
    TrendPoint,
    UtilizationRow,
)
from app.schemas.common import Page
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
) -> Page[NotificationOut]:
    base = select(Notification).where(Notification.user_id == user.id)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(base.order_by(Notification.created_at.desc()).limit(limit).offset(offset))
    )
    return Page[NotificationOut](
        items=[NotificationOut.model_validate(n) for n in items], total=total, limit=limit, offset=offset
    )
