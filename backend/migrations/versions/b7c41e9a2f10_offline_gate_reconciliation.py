"""offline gate reconciliation

Revision ID: b7c41e9a2f10
Revises: 139d935f5774
Create Date: 2026-11-08 02:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c41e9a2f10"
down_revision: Union[str, None] = "139d935f5774"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "offline_gate_actions",
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=False),
        sa.Column("guard_user_id", sa.Uuid(), nullable=False),
        sa.Column("client_event_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["guard_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "property_id", "client_event_id", name="uq_offline_action_property_client"
        ),
    )
    op.create_index(
        "ix_offline_action_property_synced",
        "offline_gate_actions",
        ["property_id", "synced_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_offline_gate_actions_guard_user_id"),
        "offline_gate_actions",
        ["guard_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_offline_gate_actions_organization_id"),
        "offline_gate_actions",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_offline_gate_actions_property_id"),
        "offline_gate_actions",
        ["property_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_offline_gate_actions_property_id"), table_name="offline_gate_actions")
    op.drop_index(
        op.f("ix_offline_gate_actions_organization_id"), table_name="offline_gate_actions"
    )
    op.drop_index(
        op.f("ix_offline_gate_actions_guard_user_id"), table_name="offline_gate_actions"
    )
    op.drop_index("ix_offline_action_property_synced", table_name="offline_gate_actions")
    op.drop_table("offline_gate_actions")
