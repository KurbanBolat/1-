"""baseline schema

Revision ID: 20260420_0001
Revises:
Create Date: 2026-04-20 16:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260420_0001"
down_revision = None
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

    if not _table_exists(bind, "properties"):
        op.create_table(
            "properties",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("city", sa.String(length=120), nullable=False),
            sa.Column("district", sa.String(length=120), nullable=False),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("area_m2", sa.Float(), nullable=False),
            sa.Column("rooms", sa.Integer(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_properties_city", "properties", ["city"], unique=False)
        op.create_index("ix_properties_id", "properties", ["id"], unique=False)

    if not _table_exists(bind, "users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("hashed_password", sa.String(length=255), nullable=False),
            sa.Column("full_name", sa.String(length=255), nullable=False),
            sa.Column("role", sa.String(length=50), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)
        op.create_index("ix_users_id", "users", ["id"], unique=False)

    if not _table_exists(bind, "listings"):
        op.create_table(
            "listings",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("city", sa.String(length=120), nullable=False),
            sa.Column("district", sa.String(length=120), nullable=False),
            sa.Column("property_type", sa.String(length=50), nullable=False),
            sa.Column("nightly_price", sa.Float(), nullable=False),
            sa.Column("cleaning_fee", sa.Float(), nullable=False, server_default="7000"),
            sa.Column("service_fee_percent", sa.Float(), nullable=False, server_default="10"),
            sa.Column("cancellation_policy", sa.String(length=20), nullable=False, server_default="flexible"),
            sa.Column("rating", sa.Float(), nullable=False),
            sa.Column("max_guests", sa.Integer(), nullable=False),
            sa.Column("bedrooms", sa.Integer(), nullable=False),
            sa.Column("bathrooms", sa.Integer(), nullable=False),
            sa.Column("amenities", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("owner_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_listings_city", "listings", ["city"], unique=False)
        op.create_index("ix_listings_id", "listings", ["id"], unique=False)
        op.create_index("ix_listings_owner_id", "listings", ["owner_id"], unique=False)
    else:
        if not _column_exists(bind, "listings", "cleaning_fee"):
            op.add_column("listings", sa.Column("cleaning_fee", sa.Float(), nullable=False, server_default="7000"))
        if not _column_exists(bind, "listings", "service_fee_percent"):
            op.add_column("listings", sa.Column("service_fee_percent", sa.Float(), nullable=False, server_default="10"))
        if not _column_exists(bind, "listings", "cancellation_policy"):
            op.add_column(
                "listings",
                sa.Column("cancellation_policy", sa.String(length=20), nullable=False, server_default="flexible"),
            )
        if not _column_exists(bind, "listings", "owner_id"):
            op.add_column("listings", sa.Column("owner_id", sa.Integer(), nullable=True))
        if not _column_exists(bind, "listings", "created_at"):
            op.add_column("listings", sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))
        if not _index_exists(bind, "listings", "ix_listings_owner_id"):
            op.create_index("ix_listings_owner_id", "listings", ["owner_id"], unique=False)

    if not _table_exists(bind, "reservations"):
        op.create_table(
            "reservations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("guest_name", sa.String(length=255), nullable=False),
            sa.Column("guest_email", sa.String(length=255), nullable=False),
            sa.Column("guest_phone", sa.String(length=50), nullable=False),
            sa.Column("check_in", sa.Date(), nullable=False),
            sa.Column("check_out", sa.Date(), nullable=False),
            sa.Column("guests", sa.Integer(), nullable=False),
            sa.Column("tariff_plan", sa.String(length=20), nullable=False, server_default="smart"),
            sa.Column("total_price", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="confirmed"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_reservations_check_in", "reservations", ["check_in"], unique=False)
        op.create_index("ix_reservations_check_out", "reservations", ["check_out"], unique=False)
        op.create_index("ix_reservations_guest_email", "reservations", ["guest_email"], unique=False)
        op.create_index("ix_reservations_id", "reservations", ["id"], unique=False)
        op.create_index("ix_reservations_listing_id", "reservations", ["listing_id"], unique=False)
        op.create_index("ix_reservations_status", "reservations", ["status"], unique=False)
    else:
        if not _column_exists(bind, "reservations", "tariff_plan"):
            op.add_column("reservations", sa.Column("tariff_plan", sa.String(length=20), nullable=False, server_default="smart"))
        if not _column_exists(bind, "reservations", "total_price"):
            op.add_column("reservations", sa.Column("total_price", sa.Float(), nullable=False, server_default="0"))
        if not _column_exists(bind, "reservations", "status"):
            op.add_column(
                "reservations",
                sa.Column("status", sa.String(length=30), nullable=False, server_default="confirmed"),
            )
        if not _column_exists(bind, "reservations", "created_at"):
            op.add_column(
                "reservations",
                sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            )

    if not _table_exists(bind, "listing_blocks"):
        op.create_table(
            "listing_blocks",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("check_in", sa.Date(), nullable=False),
            sa.Column("check_out", sa.Date(), nullable=False),
            sa.Column("reason", sa.String(length=255), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_listing_blocks_check_in", "listing_blocks", ["check_in"], unique=False)
        op.create_index("ix_listing_blocks_check_out", "listing_blocks", ["check_out"], unique=False)
        op.create_index("ix_listing_blocks_created_by", "listing_blocks", ["created_by"], unique=False)
        op.create_index("ix_listing_blocks_id", "listing_blocks", ["id"], unique=False)
        op.create_index("ix_listing_blocks_listing_id", "listing_blocks", ["listing_id"], unique=False)

    if not _table_exists(bind, "listing_photos"):
        op.create_table(
            "listing_photos",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("file_path", sa.String(length=500), nullable=False),
            sa.Column("file_url", sa.String(length=500), nullable=False),
            sa.Column("is_cover", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_listing_photos_id", "listing_photos", ["id"], unique=False)
        op.create_index("ix_listing_photos_listing_id", "listing_photos", ["listing_id"], unique=False)

    if not _table_exists(bind, "leads"):
        op.create_table(
            "leads",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("property_id", sa.Integer(), nullable=False),
            sa.Column("client_name", sa.String(length=255), nullable=False),
            sa.Column("phone", sa.String(length=50), nullable=False),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("manager_comment", sa.Text(), nullable=False),
            sa.ForeignKeyConstraint(["property_id"], ["properties.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_leads_id", "leads", ["id"], unique=False)
        op.create_index("ix_leads_property_id", "leads", ["property_id"], unique=False)
        op.create_index("ix_leads_status", "leads", ["status"], unique=False)


def downgrade() -> None:
    # SQLite-safe no-op downgrade. This migration normalizes historical schemas.
    pass
