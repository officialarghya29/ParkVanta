"""durable events and notification outbox

Revision ID: d7e3b1c9a240
Revises: c4f2a9d81b70
Create Date: 2026-11-08 14:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7e3b1c9a240"
down_revision: Union[str, None] = "c4f2a9d81b70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "realtime_events",
        sa.Column("sequence", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("sequence"),
        sa.UniqueConstraint("id"),
    )
    op.create_index(
        op.f("ix_realtime_events_property_id"), "realtime_events", ["property_id"], unique=False
    )
    op.create_index(
        "ix_realtime_property_sequence",
        "realtime_events",
        ["property_id", "sequence"],
        unique=False,
    )
    op.add_column(
        "notifications",
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "notifications",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "next_attempt_at")
    op.drop_column("notifications", "attempts")
    op.drop_index("ix_realtime_property_sequence", table_name="realtime_events")
    op.drop_index(op.f("ix_realtime_events_property_id"), table_name="realtime_events")
    op.drop_table("realtime_events")
