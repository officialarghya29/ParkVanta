from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import InvitationStatus, VehicleCategory, VisitorType


class InvitationCreate(BaseModel):
    visitor_name: str = Field(min_length=2, max_length=160)
    visitor_phone: str | None = Field(default=None, max_length=20)
    vehicle_registration: str | None = Field(default=None, max_length=20)
    vehicle_category: VehicleCategory = VehicleCategory.FOUR_WHEELER
    visitor_type: VisitorType = VisitorType.GUEST
    purpose: str | None = Field(default=None, max_length=500)
    expected_arrival: datetime
    expected_departure: datetime

    @field_validator("vehicle_registration")
    @classmethod
    def _normalize_plate(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = "".join(value.split()).upper()
        if len(cleaned) < 4:
            raise ValueError("Vehicle registration looks too short")
        return cleaned

    @model_validator(mode="after")
    def _check_window(self) -> "InvitationCreate":
        if self.expected_departure <= self.expected_arrival:
            raise ValueError("Expected departure must be after expected arrival")
        if (self.expected_departure - self.expected_arrival).total_seconds() > 72 * 3600:
            raise ValueError("A single invitation cannot exceed 72 hours")
        return self


class InvitationOut(BaseModel):
    id: UUID
    property_id: UUID
    resident_user_id: UUID
    resident_name: str
    visitor_name: str
    visitor_phone: str | None
    vehicle_registration: str | None
    vehicle_category: str | None
    visitor_type: VisitorType
    purpose: str | None
    expected_arrival: datetime
    expected_departure: datetime
    status: InvitationStatus
    rejection_reason: str | None
    approved_at: datetime | None
    parking_slot_code: str | None
    parking_zone: str | None
    pass_expires_at: datetime | None
    pass_status: str | None
    created_at: datetime


class ApproveResponse(BaseModel):
    invitation: InvitationOut
    pass_token: str
    pass_expires_at: datetime
    pass_url: str
    parking_slot_code: str | None


class RejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class CancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class VisitorPassOut(BaseModel):
    """Visitor-safe projection. Deliberately excludes resident and contact data."""

    visitor_name: str
    visitor_type: VisitorType
    property_name: str
    property_address: str
    expected_arrival: datetime
    expected_departure: datetime
    status: InvitationStatus
    vehicle_registration: str | None
    parking_slot_code: str | None
    parking_zone: str | None
    pass_expires_at: datetime | None
    pass_status: str | None
