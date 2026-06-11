"""add operational tables

Revision ID: 20260611_0004
Revises: 20260603_0003
Create Date: 2026-06-11 12:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260611_0004"
down_revision = "20260603_0003"
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


def _create_index(bind, name: str, table_name: str, columns: list[str], *, unique: bool = False) -> None:
    if not _index_exists(bind, table_name, name):
        op.create_index(name, table_name, columns, unique=unique)


def upgrade() -> None:
    bind = op.get_bind()

    if not _column_exists(bind, "users", "email_verified"):
        op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
        op.execute("UPDATE users SET email_verified = TRUE WHERE role IN ('admin', 'partner')")
    if not _column_exists(bind, "users", "token_version"):
        op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))

    if not _table_exists(bind, "auth_tokens"):
        op.create_table(
            "auth_tokens",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_auth_tokens_id", "auth_tokens", ["id"])
    _create_index(bind, "ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    _create_index(bind, "ix_auth_tokens_purpose", "auth_tokens", ["purpose"])
    _create_index(bind, "ix_auth_tokens_token_hash", "auth_tokens", ["token_hash"], unique=True)
    _create_index(bind, "ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"])
    _create_index(bind, "ix_auth_tokens_created_at", "auth_tokens", ["created_at"])

    if not _table_exists(bind, "quote_locks"):
        op.create_table(
            "quote_locks",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("token", sa.String(length=64), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("room_type_id", sa.Integer(), nullable=True),
            sa.Column("check_in", sa.Date(), nullable=False),
            sa.Column("check_out", sa.Date(), nullable=False),
            sa.Column("guests", sa.Integer(), nullable=False),
            sa.Column("tariff_plan", sa.String(length=20), nullable=False),
            sa.Column("nightly_price", sa.Float(), nullable=False),
            sa.Column("subtotal", sa.Float(), nullable=False),
            sa.Column("cleaning_fee", sa.Float(), nullable=False),
            sa.Column("service_fee", sa.Float(), nullable=False),
            sa.Column("total", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(length=10), nullable=False, server_default="KZT"),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    elif not _column_exists(bind, "quote_locks", "room_type_id"):
        op.add_column("quote_locks", sa.Column("room_type_id", sa.Integer(), nullable=True))
    _create_index(bind, "ix_quote_locks_id", "quote_locks", ["id"])
    _create_index(bind, "ix_quote_locks_token", "quote_locks", ["token"], unique=True)
    _create_index(bind, "ix_quote_locks_listing_id", "quote_locks", ["listing_id"])
    _create_index(bind, "ix_quote_locks_room_type_id", "quote_locks", ["room_type_id"])
    _create_index(bind, "ix_quote_locks_expires_at", "quote_locks", ["expires_at"])

    if not _table_exists(bind, "reservation_payments"):
        op.create_table(
            "reservation_payments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=False),
            sa.Column("payment_status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("payment_method", sa.String(length=30), nullable=True),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(length=10), nullable=False, server_default="KZT"),
            sa.Column("attempted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_reservation_payments_id", "reservation_payments", ["id"])
    _create_index(bind, "ix_reservation_payments_reservation_id", "reservation_payments", ["reservation_id"], unique=True)
    _create_index(bind, "ix_reservation_payments_payment_status", "reservation_payments", ["payment_status"])

    if not _table_exists(bind, "reservation_payment_attempts"):
        op.create_table(
            "reservation_payment_attempts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=False),
            sa.Column("idempotency_key", sa.String(length=120), nullable=False),
            sa.Column("method", sa.String(length=30), nullable=False),
            sa.Column("force_fail", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("reservation_id", "idempotency_key", name="uq_payment_attempt_idempotency"),
        )
    _create_index(bind, "ix_reservation_payment_attempts_id", "reservation_payment_attempts", ["id"])
    _create_index(bind, "ix_reservation_payment_attempts_reservation_id", "reservation_payment_attempts", ["reservation_id"])
    _create_index(bind, "ix_reservation_payment_attempts_status", "reservation_payment_attempts", ["status"])

    if not _table_exists(bind, "payment_webhook_events"):
        op.create_table(
            "payment_webhook_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("provider", sa.String(length=40), nullable=False),
            sa.Column("event_id", sa.String(length=160), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=True),
            sa.Column("idempotency_key", sa.String(length=120), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="processed"),
            sa.Column("reason", sa.String(length=255), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("processed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("provider", "event_id", name="uq_payment_webhook_event"),
        )
    _create_index(bind, "ix_payment_webhook_events_id", "payment_webhook_events", ["id"])
    _create_index(bind, "ix_payment_webhook_events_provider", "payment_webhook_events", ["provider"])
    _create_index(bind, "ix_payment_webhook_events_reservation_id", "payment_webhook_events", ["reservation_id"])
    _create_index(bind, "ix_payment_webhook_events_status", "payment_webhook_events", ["status"])

    if not _table_exists(bind, "support_tickets"):
        op.create_table(
            "support_tickets",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("source", sa.String(length=30), nullable=False, server_default="ai_chat"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("topic", sa.String(length=20), nullable=False, server_default="other"),
            sa.Column("lang", sa.String(length=10), nullable=False, server_default="ru"),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=True),
            sa.Column("listing_id", sa.Integer(), nullable=True),
            sa.Column("city", sa.String(length=120), nullable=True),
            sa.Column("check_in", sa.Date(), nullable=True),
            sa.Column("check_out", sa.Date(), nullable=True),
            sa.Column("guests", sa.Integer(), nullable=True),
            sa.Column("contact_phone", sa.String(length=50), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        if not _column_exists(bind, "support_tickets", "priority"):
            op.add_column("support_tickets", sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"))
        if not _column_exists(bind, "support_tickets", "topic"):
            op.add_column("support_tickets", sa.Column("topic", sa.String(length=20), nullable=False, server_default="other"))
    _create_index(bind, "ix_support_tickets_id", "support_tickets", ["id"])
    _create_index(bind, "ix_support_tickets_status", "support_tickets", ["status"])
    _create_index(bind, "ix_support_tickets_priority", "support_tickets", ["priority"])
    _create_index(bind, "ix_support_tickets_topic", "support_tickets", ["topic"])
    _create_index(bind, "ix_support_tickets_reservation_id", "support_tickets", ["reservation_id"])
    _create_index(bind, "ix_support_tickets_listing_id", "support_tickets", ["listing_id"])

    if not _table_exists(bind, "menu_items"):
        op.create_table(
            "menu_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False, server_default="main"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_menu_items_id", "menu_items", ["id"])
    _create_index(bind, "ix_menu_items_listing_id", "menu_items", ["listing_id"])

    if not _table_exists(bind, "restaurants"):
        op.create_table(
            "restaurants",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("cuisine", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("open_from", sa.String(length=5), nullable=False, server_default="08:00"),
            sa.Column("open_to", sa.String(length=5), nullable=False, server_default="23:00"),
            sa.Column("avg_check_kzt", sa.Integer(), nullable=False, server_default="8000"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_restaurants_id", "restaurants", ["id"])
    _create_index(bind, "ix_restaurants_listing_id", "restaurants", ["listing_id"])

    if not _table_exists(bind, "restaurant_table_bookings"):
        op.create_table(
            "restaurant_table_bookings",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("restaurant_id", sa.Integer(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=False),
            sa.Column("guest_email", sa.String(length=255), nullable=False),
            sa.Column("guest_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("booking_date", sa.Date(), nullable=False),
            sa.Column("booking_time", sa.String(length=5), nullable=False, server_default="19:00"),
            sa.Column("guests", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.ForeignKeyConstraint(["restaurant_id"], ["restaurants.id"]),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_restaurant_table_bookings_id", "restaurant_table_bookings", ["id"])
    _create_index(bind, "ix_restaurant_table_bookings_listing_id", "restaurant_table_bookings", ["listing_id"])
    _create_index(bind, "ix_restaurant_table_bookings_restaurant_id", "restaurant_table_bookings", ["restaurant_id"])
    _create_index(bind, "ix_restaurant_table_bookings_reservation_id", "restaurant_table_bookings", ["reservation_id"])
    _create_index(bind, "ix_restaurant_table_bookings_guest_email", "restaurant_table_bookings", ["guest_email"])
    _create_index(bind, "ix_restaurant_table_bookings_booking_date", "restaurant_table_bookings", ["booking_date"])
    _create_index(bind, "ix_restaurant_table_bookings_status", "restaurant_table_bookings", ["status"])

    if not _table_exists(bind, "restaurant_booking_events"):
        op.create_table(
            "restaurant_booking_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("booking_id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=False),
            sa.Column("restaurant_id", sa.Integer(), nullable=False),
            sa.Column("guest_email", sa.String(length=255), nullable=False),
            sa.Column("event_type", sa.String(length=50), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("actor_role", sa.String(length=30), nullable=False, server_default="system"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["booking_id"], ["restaurant_table_bookings.id"]),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.ForeignKeyConstraint(["restaurant_id"], ["restaurants.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_restaurant_booking_events_id", "restaurant_booking_events", ["id"])
    _create_index(bind, "ix_restaurant_booking_events_booking_id", "restaurant_booking_events", ["booking_id"])
    _create_index(bind, "ix_restaurant_booking_events_listing_id", "restaurant_booking_events", ["listing_id"])
    _create_index(bind, "ix_restaurant_booking_events_reservation_id", "restaurant_booking_events", ["reservation_id"])
    _create_index(bind, "ix_restaurant_booking_events_restaurant_id", "restaurant_booking_events", ["restaurant_id"])
    _create_index(bind, "ix_restaurant_booking_events_guest_email", "restaurant_booking_events", ["guest_email"])
    _create_index(bind, "ix_restaurant_booking_events_event_type", "restaurant_booking_events", ["event_type"])
    _create_index(bind, "ix_restaurant_booking_events_status", "restaurant_booking_events", ["status"])

    if not _table_exists(bind, "room_service_orders"):
        op.create_table(
            "room_service_orders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("listing_id", sa.Integer(), nullable=False),
            sa.Column("reservation_id", sa.Integer(), nullable=False),
            sa.Column("guest_email", sa.String(length=255), nullable=False),
            sa.Column("guest_name", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("total_price", sa.Float(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(length=10), nullable=False, server_default="KZT"),
            sa.Column("delivery_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
            sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_room_service_orders_id", "room_service_orders", ["id"])
    _create_index(bind, "ix_room_service_orders_listing_id", "room_service_orders", ["listing_id"])
    _create_index(bind, "ix_room_service_orders_reservation_id", "room_service_orders", ["reservation_id"])
    _create_index(bind, "ix_room_service_orders_guest_email", "room_service_orders", ["guest_email"])
    _create_index(bind, "ix_room_service_orders_status", "room_service_orders", ["status"])

    if not _table_exists(bind, "room_service_order_items"):
        op.create_table(
            "room_service_order_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("menu_item_id", sa.Integer(), nullable=False),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("unit_price", sa.Float(), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("line_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.ForeignKeyConstraint(["order_id"], ["room_service_orders.id"]),
            sa.ForeignKeyConstraint(["menu_item_id"], ["menu_items.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_room_service_order_items_id", "room_service_order_items", ["id"])
    _create_index(bind, "ix_room_service_order_items_order_id", "room_service_order_items", ["order_id"])
    _create_index(bind, "ix_room_service_order_items_menu_item_id", "room_service_order_items", ["menu_item_id"])

    if not _table_exists(bind, "chat_session_states"):
        op.create_table(
            "chat_session_states",
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("filters_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("booking_state_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("session_id"),
        )
    elif not _column_exists(bind, "chat_session_states", "booking_state_json"):
        op.add_column("chat_session_states", sa.Column("booking_state_json", sa.Text(), nullable=False, server_default="{}"))
    _create_index(bind, "ix_chat_session_states_session_id", "chat_session_states", ["session_id"])
    _create_index(bind, "ix_chat_session_states_updated_at", "chat_session_states", ["updated_at"])

    if not _table_exists(bind, "analytics_events"):
        op.create_table(
            "analytics_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("event_name", sa.String(length=40), nullable=False),
            sa.Column("session_id", sa.String(length=64), nullable=True),
            sa.Column("listing_id", sa.Integer(), nullable=True),
            sa.Column("reservation_id", sa.Integer(), nullable=True),
            sa.Column("lang", sa.String(length=8), nullable=True),
            sa.Column("currency", sa.String(length=8), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index(bind, "ix_analytics_events_id", "analytics_events", ["id"])
    _create_index(bind, "ix_analytics_events_event_name", "analytics_events", ["event_name"])
    _create_index(bind, "ix_analytics_events_session_id", "analytics_events", ["session_id"])
    _create_index(bind, "ix_analytics_events_listing_id", "analytics_events", ["listing_id"])
    _create_index(bind, "ix_analytics_events_reservation_id", "analytics_events", ["reservation_id"])
    _create_index(bind, "ix_analytics_events_lang", "analytics_events", ["lang"])
    _create_index(bind, "ix_analytics_events_currency", "analytics_events", ["currency"])
    _create_index(bind, "ix_analytics_events_created_at", "analytics_events", ["created_at"])

    if not _table_exists(bind, "partner_notification_reads"):
        op.create_table(
            "partner_notification_reads",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.String(length=40), nullable=False),
            sa.Column("read_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "event_id", name="uq_partner_notification_read"),
        )
    _create_index(bind, "ix_partner_notification_reads_id", "partner_notification_reads", ["id"])
    _create_index(bind, "ix_partner_notification_reads_user_id", "partner_notification_reads", ["user_id"])
    _create_index(bind, "ix_partner_notification_reads_event_id", "partner_notification_reads", ["event_id"])


def downgrade() -> None:
    pass
