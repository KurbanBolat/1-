"""add room type blocks

Revision ID: 20260603_0003
Revises: 20260602_0002
Create Date: 2026-06-03 09:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260603_0003"
down_revision = "20260602_0002"
branch_labels = None
depends_on = None


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        return False
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        return False
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()

    if not _column_exists(bind, "listing_blocks", "room_type_id"):
        op.add_column("listing_blocks", sa.Column("room_type_id", sa.Integer(), nullable=True))
    if not _column_exists(bind, "listing_blocks", "blocked_inventory"):
        op.add_column("listing_blocks", sa.Column("blocked_inventory", sa.Integer(), nullable=True))
    if not _index_exists(bind, "listing_blocks", "ix_listing_blocks_room_type_id"):
        op.create_index("ix_listing_blocks_room_type_id", "listing_blocks", ["room_type_id"], unique=False)


def downgrade() -> None:
    pass
