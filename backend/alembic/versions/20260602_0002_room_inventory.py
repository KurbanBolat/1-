"""add room inventory

Revision ID: 20260602_0002
Revises: 20260420_0001
Create Date: 2026-06-02 12:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260602_0002"
down_revision = "20260420_0001"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return inspect(bind).has_table(table_name)


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

    if not _table_exists(bind, "room_types"):
        op.create_table(
            "room_types",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("nightly_price", sa.Float(), nullable=False),
            sa.Column("total_inventory", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("max_guests", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("bedrooms", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("bathrooms", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("amenities", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_room_types_id", "room_types", ["id"], unique=False)
        op.create_index("ix_room_types_listing_id", "room_types", ["listing_id"], unique=False)
        op.create_index("ix_room_types_is_active", "room_types", ["is_active"], unique=False)

    if not _column_exists(bind, "reservations", "room_type_id"):
        op.add_column("reservations", sa.Column("room_type_id", sa.Integer(), nullable=True))
    if not _index_exists(bind, "reservations", "ix_reservations_room_type_id"):
        op.create_index("ix_reservations_room_type_id", "reservations", ["room_type_id"], unique=False)

    if _table_exists(bind, "quote_locks") and not _column_exists(bind, "quote_locks", "room_type_id"):
        op.add_column("quote_locks", sa.Column("room_type_id", sa.Integer(), nullable=True))
    if _table_exists(bind, "quote_locks") and not _index_exists(bind, "quote_locks", "ix_quote_locks_room_type_id"):
        op.create_index("ix_quote_locks_room_type_id", "quote_locks", ["room_type_id"], unique=False)


def downgrade() -> None:
    pass
