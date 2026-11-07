from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, assert_org_access, assert_property_access, client_ip, require_roles
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.database.session import get_db
from app.models import (
    Apartment,
    GuardProfile,
    Organization,
    ParkingSlot,
    ParkingZone,
    Property,
    ResidentProfile,
    Tower,
    User,
)
from app.models.enums import Role, SlotStatus
from app.schemas.auth import ResidentUpdateRequest, StaffCreateRequest, UserOut
from app.schemas.common import Page
from app.schemas.tenancy import (
    ApartmentCreate,
    ApartmentOut,
    GuardOut,
    OrganizationCreate,
    OrganizationOut,
    PolicyOut,
    PolicyUpdate,
    PropertyCreate,
    PropertyOut,
    ResidentOut,
    SlotCreate,
    SlotOut,
    SlotUpdate,
    TowerCreate,
    TowerOut,
    ZoneCreate,
    ZoneOut,
)
from app.services import audit_service, auth_service, parking_service

router = APIRouter(tags=["Society & Property"])

AdminUser = Annotated[User, Depends(require_roles(Role.SOCIETY_ADMIN, Role.PROPERTY_MANAGER))]
SocietyAdmin = Annotated[User, Depends(require_roles(Role.SOCIETY_ADMIN))]
SuperAdmin = Annotated[User, Depends(require_roles(Role.SUPER_ADMIN))]


def _property_for(db: Session, user: User, property_id: UUID) -> Property:
    return assert_property_access(db, user, property_id)


@router.post("/organizations", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(payload: OrganizationCreate, db: Annotated[Session, Depends(get_db)], user: SuperAdmin) -> OrganizationOut:
    if db.scalar(select(Organization.id).where(Organization.slug == payload.slug)):
        raise ConflictError("An organization with this slug already exists")
    org = Organization(name=payload.name, slug=payload.slug)
    db.add(org)
    db.flush()
    audit_service.record(
        db,
        action="organization.created",
        entity_type="organization",
        organization_id=org.id,
        actor_user_id=user.id,
        entity_id=org.id,
    )
    db.commit()
    db.refresh(org)
    return OrganizationOut.model_validate(org)


@router.get("/organizations", response_model=list[OrganizationOut])
def list_organizations(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> list[OrganizationOut]:
    if user.role == Role.SUPER_ADMIN.value:
        orgs = auth_service.list_organizations(db)
    else:
        orgs = list(db.scalars(select(Organization).where(Organization.id == user.organization_id)))
    return [OrganizationOut.model_validate(org) for org in orgs]


@router.post("/properties", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(
    payload: PropertyCreate,
    db: Annotated[Session, Depends(get_db)],
    user: SocietyAdmin,
    organization_id: UUID | None = Query(default=None),
) -> PropertyOut:
    target_org = organization_id or user.organization_id
    assert_org_access(user, target_org)
    org = db.get(Organization, target_org)
    if org is None:
        raise NotFoundError("Organization not found")

    duplicate = db.scalar(
        select(Property.id).where(
            Property.organization_id == target_org, func.lower(Property.name) == payload.name.lower()
        )
    )
    if duplicate:
        raise ConflictError("A property with this name already exists in the organization")

    prop = Property(organization_id=target_org, **payload.model_dump())
    db.add(prop)
    db.flush()
    parking_service.ensure_policy(db, property_id=prop.id)
    audit_service.record(
        db,
        action="property.created",
        entity_type="property",
        organization_id=target_org,
        actor_user_id=user.id,
        entity_id=prop.id,
    )
    db.commit()
    db.refresh(prop)
    return PropertyOut.model_validate(prop)


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> list[PropertyOut]:
    stmt = select(Property).where(Property.is_active.is_(True))
    if user.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(Property.organization_id == user.organization_id)
    if user.property_id is not None and user.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(Property.id == user.property_id)
    return [PropertyOut.model_validate(p) for p in db.scalars(stmt.order_by(Property.name))]


@router.get("/properties/{property_id}", response_model=PropertyOut)
def get_property(property_id: UUID, db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> PropertyOut:
    return PropertyOut.model_validate(_property_for(db, user, property_id))


@router.post("/properties/{property_id}/towers", response_model=TowerOut, status_code=status.HTTP_201_CREATED)
def create_tower(
    property_id: UUID,
    payload: TowerCreate,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> TowerOut:
    prop = _property_for(db, user, property_id)
    if db.scalar(select(Tower.id).where(Tower.property_id == prop.id, Tower.name == payload.name)):
        raise ConflictError("A tower with this name already exists")
    tower = Tower(property_id=prop.id, **payload.model_dump())
    db.add(tower)
    db.commit()
    db.refresh(tower)
    return TowerOut.model_validate(tower)


@router.get("/properties/{property_id}/towers", response_model=list[TowerOut])
def list_towers(property_id: UUID, db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> list[TowerOut]:
    _property_for(db, user, property_id)
    return [
        TowerOut.model_validate(t)
        for t in db.scalars(select(Tower).where(Tower.property_id == property_id).order_by(Tower.name))
    ]


@router.post("/apartments", response_model=ApartmentOut, status_code=status.HTTP_201_CREATED)
def create_apartment(
    payload: ApartmentCreate,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> ApartmentOut:
    prop = _property_for(db, user, payload.property_id)
    if payload.tower_id is not None:
        tower = db.get(Tower, payload.tower_id)
        if tower is None or tower.property_id != prop.id:
            raise ValidationError("Tower does not belong to the property")
    if db.scalar(
        select(Apartment.id).where(
            Apartment.property_id == prop.id, Apartment.number == payload.number
        )
    ):
        raise ConflictError("An apartment with this number already exists")
    apartment = Apartment(**payload.model_dump())
    db.add(apartment)
    db.commit()
    db.refresh(apartment)
    return ApartmentOut.model_validate(apartment)


@router.get("/properties/{property_id}/apartments", response_model=Page[ApartmentOut])
def list_apartments(
    property_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ApartmentOut]:
    _property_for(db, user, property_id)
    base = select(Apartment).where(Apartment.property_id == property_id)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(base.order_by(Apartment.number).limit(limit).offset(offset))
    )
    return Page[ApartmentOut](
        items=[ApartmentOut.model_validate(a) for a in items], total=total, limit=limit, offset=offset
    )


@router.post("/properties/{property_id}/residents", response_model=ResidentOut, status_code=status.HTTP_201_CREATED)
def create_resident(
    property_id: UUID,
    payload: StaffCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> ResidentOut:
    _property_for(db, user, property_id)
    if payload.role != Role.RESIDENT:
        raise ValidationError("Use the staff provisioning endpoint for non-resident roles")
    payload = payload.model_copy(update={"property_id": property_id})
    created = auth_service.create_staff_account(db, user, payload)
    profile = db.scalar(select(ResidentProfile).where(ResidentProfile.user_id == created.id))
    assert profile is not None
    return ResidentOut(
        user=UserOut.model_validate(created), apartment_id=profile.apartment_id, is_verified=profile.is_verified
    )


@router.get("/properties/{property_id}/residents", response_model=Page[ResidentOut])
def list_residents(
    property_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ResidentOut]:
    _property_for(db, user, property_id)
    base = (
        select(User, ResidentProfile)
        .join(ResidentProfile, ResidentProfile.user_id == User.id)
        .where(User.property_id == property_id, User.role == Role.RESIDENT.value)
    )
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = db.execute(base.order_by(User.full_name).limit(limit).offset(offset)).all()
    return Page[ResidentOut](
        items=[
            ResidentOut(
                user=UserOut.model_validate(u), apartment_id=p.apartment_id, is_verified=p.is_verified
            )
            for u, p in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/residents/me", response_model=ResidentOut)
def my_resident_profile(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> ResidentOut:
    profile = db.scalar(select(ResidentProfile).where(ResidentProfile.user_id == user.id))
    if profile is None:
        raise NotFoundError("Resident profile not found")
    return ResidentOut(
        user=UserOut.model_validate(user), apartment_id=profile.apartment_id, is_verified=profile.is_verified
    )


@router.patch("/residents/{user_id}", response_model=ResidentOut)
def update_resident(
    user_id: UUID,
    payload: ResidentUpdateRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> ResidentOut:
    target = db.get(User, user_id)
    if target is None or target.role != Role.RESIDENT.value:
        raise NotFoundError("Resident not found")
    if target.property_id is None:
        raise ForbiddenError("Resident is not attached to a property")
    _property_for(db, user, target.property_id)

    profile = db.scalar(select(ResidentProfile).where(ResidentProfile.user_id == target.id))
    if profile is None:
        raise NotFoundError("Resident profile not found")

    if payload.full_name is not None:
        target.full_name = payload.full_name
    if payload.phone is not None:
        target.phone = payload.phone
    if payload.is_verified is not None:
        profile.is_verified = payload.is_verified
    if payload.is_suspended is not None:
        target.is_suspended = payload.is_suspended

    audit_service.record(
        db,
        action="resident.updated",
        entity_type="user",
        organization_id=target.organization_id,
        actor_user_id=user.id,
        entity_id=target.id,
        details=payload.model_dump(exclude_none=True),
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(target)
    db.refresh(profile)
    return ResidentOut(
        user=UserOut.model_validate(target), apartment_id=profile.apartment_id, is_verified=profile.is_verified
    )


@router.post("/properties/{property_id}/guards", response_model=GuardOut, status_code=status.HTTP_201_CREATED)
def create_guard(
    property_id: UUID,
    payload: StaffCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> GuardOut:
    _property_for(db, user, property_id)
    if payload.role != Role.SECURITY_GUARD:
        raise ValidationError("This endpoint provisions security guard accounts")
    payload = payload.model_copy(update={"property_id": property_id})
    created = auth_service.create_staff_account(db, user, payload)
    profile = db.scalar(select(GuardProfile).where(GuardProfile.user_id == created.id))
    assert profile is not None
    return GuardOut(
        user=UserOut.model_validate(created),
        property_id=profile.property_id,
        badge_number=profile.badge_number,
    )


@router.get("/properties/{property_id}/guards", response_model=Page[GuardOut])
def list_guards(
    property_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[GuardOut]:
    _property_for(db, user, property_id)
    base = (
        select(User, GuardProfile)
        .join(GuardProfile, GuardProfile.user_id == User.id)
        .where(User.role == Role.SECURITY_GUARD.value, GuardProfile.property_id == property_id)
    )
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = db.execute(base.order_by(User.full_name).limit(limit).offset(offset)).all()
    return Page[GuardOut](
        items=[
            GuardOut(
                user=UserOut.model_validate(u), property_id=g.property_id, badge_number=g.badge_number
            )
            for u, g in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/parking/zones", response_model=ZoneOut, status_code=status.HTTP_201_CREATED)
def create_zone(payload: ZoneCreate, db: Annotated[Session, Depends(get_db)], user: AdminUser) -> ZoneOut:
    _property_for(db, user, payload.property_id)
    if db.scalar(
        select(ParkingZone.id).where(
            ParkingZone.property_id == payload.property_id, ParkingZone.name == payload.name
        )
    ):
        raise ConflictError("A parking zone with this name already exists")
    zone = ParkingZone(**payload.model_dump())
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return ZoneOut.model_validate(zone)


@router.get("/parking/zones", response_model=list[ZoneOut])
def list_zones(
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    property_id: UUID = Query(),
) -> list[ZoneOut]:
    _property_for(db, user, property_id)
    return [
        ZoneOut.model_validate(z)
        for z in db.scalars(
            select(ParkingZone)
            .where(ParkingZone.property_id == property_id)
            .order_by(ParkingZone.priority)
        )
    ]


@router.post("/parking/slots", response_model=SlotOut, status_code=status.HTTP_201_CREATED)
def create_slot(payload: SlotCreate, db: Annotated[Session, Depends(get_db)], user: AdminUser) -> SlotOut:
    _property_for(db, user, payload.property_id)
    zone = db.get(ParkingZone, payload.zone_id)
    if zone is None or zone.property_id != payload.property_id:
        raise ValidationError("Parking zone does not belong to the property")
    vehicle_category = payload.vehicle_category
    if hasattr(vehicle_category, "value"):
        vehicle_category = vehicle_category.value
    if vehicle_category not in {"ANY", "TWO_WHEELER", "FOUR_WHEELER", "EV", "OVERSIZED"}:
        raise ValidationError("Unsupported vehicle category")

    if db.scalar(
        select(ParkingSlot.id).where(
            ParkingSlot.property_id == payload.property_id, ParkingSlot.code == payload.code
        )
    ):
        raise ConflictError("A slot with this code already exists")

    slot = ParkingSlot(
        property_id=payload.property_id,
        zone_id=zone.id,
        code=payload.code.upper(),
        category=zone.category,
        vehicle_category=vehicle_category,
        notes=payload.notes,
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return SlotOut.model_validate(slot)


@router.get("/parking/slots", response_model=Page[SlotOut])
def list_slots(
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    property_id: UUID = Query(),
    status_filter: str | None = Query(default=None, alias="status"),
    zone_id: UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Page[SlotOut]:
    _property_for(db, user, property_id)
    base = select(ParkingSlot).where(ParkingSlot.property_id == property_id)
    if status_filter:
        base = base.where(ParkingSlot.status == status_filter)
    if zone_id:
        base = base.where(ParkingSlot.zone_id == zone_id)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(db.scalars(base.order_by(ParkingSlot.code).limit(limit).offset(offset)))
    return Page[SlotOut](
        items=[SlotOut.model_validate(s) for s in items], total=total, limit=limit, offset=offset
    )


@router.patch("/parking/slots/{slot_id}", response_model=SlotOut)
def update_slot(
    slot_id: UUID,
    payload: SlotUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> SlotOut:
    slot = db.get(ParkingSlot, slot_id)
    if slot is None:
        raise NotFoundError("Parking slot not found")
    _property_for(db, user, slot.property_id)

    if payload.status is not None:
        if slot.status in {SlotStatus.OCCUPIED.value, SlotStatus.RESERVED.value}:
            raise ConflictError("An occupied or reserved slot cannot be manually reclassified")
        slot.status = payload.status
    if payload.vehicle_category is not None:
        value = payload.vehicle_category
        slot.vehicle_category = value.value if hasattr(value, "value") else value
    if payload.notes is not None:
        slot.notes = payload.notes

    audit_service.record(
        db,
        action="parking.slot_updated",
        entity_type="parking_slot",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=slot.id,
        details=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(slot)
    return SlotOut.model_validate(slot)


@router.get("/properties/{property_id}/policy", response_model=PolicyOut)
def get_policy(property_id: UUID, db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> PolicyOut:
    _property_for(db, user, property_id)
    policy = parking_service.get_policy(db, property_id=property_id)
    return PolicyOut.model_validate(policy)


@router.patch("/properties/{property_id}/policy", response_model=PolicyOut)
def update_policy(
    property_id: UUID,
    payload: PolicyUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: AdminUser,
) -> PolicyOut:
    _property_for(db, user, property_id)
    policy = parking_service.ensure_policy(db, property_id=property_id)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(policy, field, value)
    if policy.visitor_window_start >= policy.visitor_window_end:
        raise ValidationError("Visitor window start must be earlier than the end time")
    audit_service.record(
        db,
        action="policy.updated",
        entity_type="society_policy",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=policy.id,
        details=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(policy)
    return PolicyOut.model_validate(policy)
