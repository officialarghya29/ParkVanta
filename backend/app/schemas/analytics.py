from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import ORMModel


class OverviewOut(BaseModel):
    property_id: UUID
    total_slots: int
    available_slots: int
    reserved_slots: int
    occupied_slots: int
    blocked_slots: int
    maintenance_slots: int
    utilization_percent: float
    visitors_inside: int
    active_reservations: int
    total_visitors_today: int
    rejected_entries_today: int
    manual_overrides_today: int
    overstays: int


class UtilizationRow(BaseModel):
    category: str
    total: int
    available: int
    reserved: int
    occupied: int
    utilization_percent: float


class TrendPoint(BaseModel):
    day: date
    invitations: int
    entries: int
    exits: int


class OverstayRow(BaseModel):
    occupancy_id: UUID
    invitation_id: UUID
    visitor_name: str
    vehicle_registration: str | None
    slot_code: str | None
    entered_at: datetime
    reserved_until: datetime
    overdue_minutes: int


class NotificationOut(ORMModel):
    id: UUID
    title: str
    body: str
    channel: str
    status: str
    created_at: datetime
