import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    EventDecision,
    EventDirection,
    InvitationStatus,
    NotificationChannel,
    NotificationStatus,
    OccupancyStatus,
    PassStatus,
    ReservationStatus,
    Role,
    SlotStatus,
    VehicleCategory,
    VisitorType,
    ZoneCategory,
)


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Property(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "properties"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    address_line: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    city: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    pincode: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Tower(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "towers"
    __table_args__ = (UniqueConstraint("property_id", "name", name="uq_tower_property_name"),)

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    floors: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Apartment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "apartments"
    __table_args__ = (UniqueConstraint("property_id", "number", name="uq_apartment_property_number"),)

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tower_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("towers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    number: Mapped[str] = mapped_column(String(30), nullable=False)
    floor: Mapped[int | None] = mapped_column(Integer, nullable=True)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("properties.id", ondelete="SET NULL"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=Role.RESIDENT.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResidentProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "resident_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    apartment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("apartments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class GuardProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "guard_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    badge_number: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Visitor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "visitors"
    __table_args__ = (Index("ix_visitor_org_phone", "organization_id", "phone"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Vehicle(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("organization_id", "registration_number", name="uq_vehicle_org_registration"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    registration_number: Mapped[str] = mapped_column(String(20), nullable=False)
    category: Mapped[str] = mapped_column(
        String(32), nullable=False, default=VehicleCategory.FOUR_WHEELER.value
    )


class Invitation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invitations"
    __table_args__ = (
        Index("ix_invitation_property_status", "property_id", "status"),
        Index("ix_invitation_resident", "resident_user_id", "created_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resident_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    apartment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("apartments.id", ondelete="SET NULL"), nullable=True
    )
    visitor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visitors.id", ondelete="RESTRICT"), nullable=False
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True
    )
    visitor_type: Mapped[str] = mapped_column(String(32), nullable=False, default=VisitorType.GUEST.value)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_arrival: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expected_departure: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=InvitationStatus.PENDING.value, index=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visited_on: Mapped[datetime | None] = mapped_column(Date, nullable=True)


class QRPass(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "qr_passes"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invitation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invitations.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=PassStatus.ACTIVE.value)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ParkingZone(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "parking_zones"
    __table_args__ = (UniqueConstraint("property_id", "name", name="uq_zone_property_name"),)

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    level: Mapped[str | None] = mapped_column(String(40), nullable=True)
    category: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ZoneCategory.VISITOR.value
    )
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ParkingSlot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "parking_slots"
    __table_args__ = (
        UniqueConstraint("property_id", "code", name="uq_slot_property_code"),
        Index("ix_slot_property_status", "property_id", "status"),
    )

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_zones.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    vehicle_category: Mapped[str] = mapped_column(String(32), nullable=False, default="ANY")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=SlotStatus.AVAILABLE.value, index=True
    )
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ParkingReservation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "parking_reservations"
    __table_args__ = (
        Index("uq_active_reservation_slot", "slot_id", unique=True, postgresql_where=text("status = 'ACTIVE'")),
        Index("ix_reservation_property_status", "property_id", "status"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_slots.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    invitation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invitations.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ReservationStatus.ACTIVE.value, index=True
    )
    reserved_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reserved_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ParkingOccupancy(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "parking_occupancies"
    __table_args__ = (
        Index("uq_active_occupancy_slot", "slot_id", unique=True, postgresql_where=text("status = 'ACTIVE'")),
        Index("ix_occupancy_property_status", "property_id", "status"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_slots.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_reservations.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    invitation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invitations.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=OccupancyStatus.ACTIVE.value, index=True
    )
    entered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    overstay: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class EntryExitEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "entry_exit_events"
    __table_args__ = (
        Index("ix_event_property_created", "property_id", "created_at"),
        Index("ix_event_invitation", "invitation_id", "created_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invitation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("invitations.id", ondelete="SET NULL"), nullable=True
    )
    pass_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("qr_passes.id", ondelete="SET NULL"), nullable=True
    )
    guard_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    decision: Mapped[str] = mapped_column(String(32), nullable=False, default=EventDecision.AUTHORIZED.value)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class OfflineGateAction(UUIDPrimaryKeyMixin, Base):
    """Idempotency ledger for gate actions queued while a device was offline."""

    __tablename__ = "offline_gate_actions"
    __table_args__ = (
        UniqueConstraint(
            "property_id", "client_event_id", name="uq_offline_action_property_client"
        ),
        Index("ix_offline_action_property_synced", "property_id", "synced_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    guard_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    client_event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="APPLIED")
    device_id: Mapped[str] = mapped_column(String(80), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    result: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_org_created", "organization_id", "created_at"),)

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Notification(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "notifications"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    channel: Mapped[str] = mapped_column(
        String(20), nullable=False, default=NotificationChannel.IN_APP.value
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=NotificationStatus.PENDING.value
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SocietyPolicy(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "society_policies"

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    qr_validity_minutes: Mapped[int] = mapped_column(Integer, default=240, nullable=False)
    overstay_grace_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    max_active_visitors: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    allow_manual_override: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_vehicle_for_entry: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    visitor_window_start: Mapped[str] = mapped_column(String(5), default="00:00", nullable=False)
    visitor_window_end: Mapped[str] = mapped_column(String(5), default="23:59", nullable=False)


class RefreshToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PasswordResetToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DailyVisitSummary(UUIDPrimaryKeyMixin, Base):
    """Database-backed rollup used by analytics to avoid scanning raw events repeatedly."""

    __tablename__ = "daily_visit_summaries"
    __table_args__ = (
        UniqueConstraint("property_id", "visit_date", name="uq_summary_property_date"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    visit_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    approved_visits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    entries: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    overstays: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
