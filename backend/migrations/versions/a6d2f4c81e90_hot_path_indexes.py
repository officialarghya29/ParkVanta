"""hot-path indexes

Revision ID: a6d2f4c81e90
Revises: f3b8d1c6a902
Create Date: 2026-11-08 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a6d2f4c81e90"
down_revision: Union[str, None] = "f3b8d1c6a902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_notification_outbox",
        "notifications",
        ["channel", "status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        "ix_notification_user_created",
        "notifications",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_realtime_created_at",
        "realtime_events",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_pass_status_expires",
        "qr_passes",
        ["status", "expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_reservation_status_until",
        "parking_reservations",
        ["status", "reserved_until"],
        unique=False,
    )
    op.create_index(
        "ix_invitation_status_departure",
        "invitations",
        ["status", "expected_departure"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_invitation_status_departure", table_name="invitations")
    op.drop_index("ix_reservation_status_until", table_name="parking_reservations")
    op.drop_index("ix_pass_status_expires", table_name="qr_passes")
    op.drop_index("ix_realtime_created_at", table_name="realtime_events")
    op.drop_index("ix_notification_user_created", table_name="notifications")
    op.drop_index("ix_notification_outbox", table_name="notifications")
