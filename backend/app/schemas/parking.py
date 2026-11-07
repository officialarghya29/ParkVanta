from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AvailabilityOut(BaseModel):
    property_id: UUID
    total_slots: int
    available: int
    reserved: int
    occupied: int
    blocked: int
    maintenance: int
    utilization_percent: float
    by_category: dict[str, dict[str, int]]


class AllocationRequest(BaseModel):
    invitation_id: UUID


class ReservationOut(BaseModel):
    id: UUID
    slot_id: UUID
    slot_code: str
    invitation_id: UUID
    visitor_name: str
    status: str
    reserved_from: datetime
    reserved_until: datetime
    released_at: datetime | None


class OccupancyOut(BaseModel):
    id: UUID
    slot_id: UUID
    slot_code: str
    invitation_id: UUID
    visitor_name: str
    vehicle_registration: str | None
    status: str
    entered_at: datetime
    exited_at: datetime | None
    overstay: bool


class SlotCreateResponse(BaseModel):
    id: UUID
    code: str
    status: str
    category: str


class ManualAllocationRequest(BaseModel):
    invitation_id: UUID
    slot_id: UUID | None = Field(
        default=None, description="Optional explicit slot; otherwise the engine picks the best compatible slot"
    )
