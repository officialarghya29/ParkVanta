from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    actor_user_id: UUID | None
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: str | None
    ip_address: str | None
    details: dict[str, Any]
    created_at: datetime
