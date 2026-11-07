"""join codes and notification read state

Revision ID: c4f2a9d81b70
Revises: b7c41e9a2f10
Create Date: 2026-11-08 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4f2a9d81b70"
down_revision: Union[str, None] = "b7c41e9a2f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("join_code", sa.String(length=16), nullable=True))
    op.execute(
        "UPDATE properties "
        "SET join_code = upper(substr(md5(random()::text || id::text), 1, 16)) "
        "WHERE join_code IS NULL"
    )
    op.alter_column("properties", "join_code", nullable=False)
    op.create_index("ix_properties_join_code", "properties", ["join_code"], unique=True)
    op.add_column(
        "notifications", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("notifications", "read_at")
    op.drop_index("ix_properties_join_code", table_name="properties")
    op.drop_column("properties", "join_code")
