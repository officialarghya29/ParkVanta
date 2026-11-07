from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AuditLog


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    organization_id: UUID | None = None,
    actor_user_id: UUID | None = None,
    entity_id: str | UUID | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Stage an audit event inside the caller's transaction.

    Audit rows must commit atomically with the operation they describe, so this
    helper never commits on its own.
    """
    entry = AuditLog(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        ip_address=ip_address,
        details=details or {},
    )
    db.add(entry)
    return entry
