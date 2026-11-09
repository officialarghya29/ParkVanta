from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class VerifyRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    plate_number: str | None = Field(default=None, max_length=20)


class VerifyResponse(BaseModel):
    allowed: bool
    reason_code: str
    message: str
    invitation_id: UUID | None = None
    visitor_name: str | None = None
    visitor_type: str | None = None
    vehicle_registration: str | None = None
    pass_expires_at: datetime | None = None
    parking_slot_code: str | None = None
    parking_zone: str | None = None
    requires_confirmation: bool = False


class EntryAuthorizeRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    plate_number: str | None = Field(default=None, max_length=20)


class EntryAuthorizeResponse(BaseModel):
    entry_event_id: UUID
    invitation_id: UUID
    visitor_name: str
    parking_slot_code: str | None
    authorized_at: datetime
    gate_opening_requested: bool = False
    next_step: str = "Confirm the vehicle physically entered the gate"


class ConfirmEntryRequest(BaseModel):
    invitation_id: UUID


class ConfirmEntryResponse(BaseModel):
    occupancy_id: UUID | None
    slot_code: str | None
    slot_status: str | None
    entered_at: datetime | None
    already_confirmed: bool = False


class ExitConfirmRequest(BaseModel):
    invitation_id: UUID | None = None
    slot_code: str | None = Field(default=None, max_length=30)
    property_id: UUID | None = None


class ExitConfirmResponse(BaseModel):
    occupancy_id: UUID
    invitation_id: UUID
    slot_code: str | None
    released_at: datetime
    duration_minutes: int
    overstay: bool


class ManualOverrideRequest(BaseModel):
    reason: str = Field(min_length=10, max_length=255)
    direction: Literal["ENTRY", "EXIT"] = "ENTRY"
    invitation_id: UUID | None = None
    plate_number: str | None = Field(default=None, max_length=20)


class ManualOverrideResponse(BaseModel):
    event_id: UUID
    recorded_at: datetime
    message: str


class ActiveVisitorOut(BaseModel):
    invitation_id: UUID
    visitor_name: str
    vehicle_registration: str | None
    slot_code: str | None
    zone_name: str | None
    entered_at: datetime | None
    expected_departure: datetime
    overstay: bool


class GateEventOut(BaseModel):
    id: UUID
    direction: str
    decision: str
    reason: str | None
    visitor_name: str | None
    guard_name: str
    created_at: datetime
