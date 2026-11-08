"""worker heartbeats

Revision ID: f3b8d1c6a902
Revises: d7e3b1c9a240
Create Date: 2026-11-08 17:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8d1c6a902"
down_revision: Union[str, None] = "d7e3b1c9a240"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "worker_heartbeats",
        sa.Column("worker", sa.String(length=40), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_status", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("worker"),
    )


def downgrade() -> None:
    op.drop_table("worker_heartbeats")
