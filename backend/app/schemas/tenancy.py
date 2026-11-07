from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import VehicleCategory, ZoneCategory
from app.schemas.auth import UserOut
from app.schemas.common import ORMModel


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")


class OrganizationOut(ORMModel):
    id: UUID
    name: str
    slug: str
    is_active: bool


class PropertyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    address_line: str = Field(default="", max_length=255)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=80)
    pincode: str = Field(default="", max_length=12)
    timezone: str = Field(default="Asia/Kolkata", max_length=64)


class PropertyOut(ORMModel):
    id: UUID
    organization_id: UUID
    name: str
    address_line: str
    city: str
    state: str
    pincode: str
    timezone: str
    is_active: bool


class TowerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    floors: int | None = Field(default=None, ge=1, le=200)


class TowerOut(ORMModel):
    id: UUID
    property_id: UUID
    name: str
    floors: int | None


class ApartmentCreate(BaseModel):
    property_id: UUID
    tower_id: UUID | None = None
    number: str = Field(min_length=1, max_length=30)
    floor: int | None = Field(default=None, ge=-5, le=200)


class ApartmentOut(ORMModel):
    id: UUID
    property_id: UUID
    tower_id: UUID | None
    number: str
    floor: int | None


class ResidentCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=20)
    apartment_id: UUID


class ResidentOut(BaseModel):
    user: UserOut
    apartment_id: UUID
    is_verified: bool


class GuardOut(BaseModel):
    user: UserOut
    property_id: UUID
    badge_number: str | None


class ZoneCreate(BaseModel):
    property_id: UUID
    name: str = Field(min_length=1, max_length=80)
    level: str | None = Field(default=None, max_length=40)
    category: ZoneCategory = ZoneCategory.VISITOR
    priority: int = Field(default=100, ge=1, le=1000)


class ZoneOut(ORMModel):
    id: UUID
    property_id: UUID
    name: str
    level: str | None
    category: ZoneCategory
    priority: int
    is_active: bool


class SlotCreate(BaseModel):
    property_id: UUID
    zone_id: UUID
    code: str = Field(min_length=1, max_length=30)
    vehicle_category: VehicleCategory | str = Field(default="ANY")
    notes: str | None = Field(default=None, max_length=255)


class SlotUpdate(BaseModel):
    vehicle_category: VehicleCategory | str | None = None
    status: str | None = Field(default=None, pattern=r"^(AVAILABLE|BLOCKED|MAINTENANCE)$")
    notes: str | None = Field(default=None, max_length=255)


class SlotOut(ORMModel):
    id: UUID
    property_id: UUID
    zone_id: UUID
    code: str
    category: ZoneCategory
    vehicle_category: str
    status: str
    notes: str | None


class PolicyOut(ORMModel):
    id: UUID
    property_id: UUID
    qr_validity_minutes: int
    overstay_grace_minutes: int
    max_active_visitors: int
    allow_manual_override: bool
    require_vehicle_for_entry: bool
    visitor_window_start: str
    visitor_window_end: str


class PolicyUpdate(BaseModel):
    qr_validity_minutes: int | None = Field(default=None, ge=5, le=1440)
    overstay_grace_minutes: int | None = Field(default=None, ge=0, le=720)
    max_active_visitors: int | None = Field(default=None, ge=0, le=5000)
    allow_manual_override: bool | None = None
    require_vehicle_for_entry: bool | None = None
    visitor_window_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    visitor_window_end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
