from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class OfflineGateActionIn(BaseModel):
    client_event_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    action: Literal["ENTRY_CONFIRM", "EXIT_CONFIRM", "MANUAL_OVERRIDE"]
    invitation_id: UUID | None = None
    slot_code: str | None = Field(default=None, max_length=30)
    plate_number: str | None = Field(default=None, max_length=20)
    reason: str | None = Field(default=None, max_length=255)
    direction: Literal["ENTRY", "EXIT"] | None = None
    recorded_at: datetime


class OfflineReconcileRequest(BaseModel):
    property_id: UUID
    device_id: str = Field(min_length=4, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    actions: list[OfflineGateActionIn] = Field(min_length=1, max_length=50)


class OfflineGateActionResult(BaseModel):
    client_event_id: str
    action: str
    status: Literal["applied", "already_applied", "duplicate", "rejected"]
    code: str | None = None
    message: str | None = None
    result: dict = Field(default_factory=dict)


class OfflineReconcileResponse(BaseModel):
    device_id: str
    received: int
    applied: int
    duplicates: int
    rejected: int
    results: list[OfflineGateActionResult]
