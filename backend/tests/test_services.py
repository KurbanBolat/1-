from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import json
import hashlib

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import Base
from app.api.chat import chat_recommend
from app.api.analytics import get_partner_funnel
from app.api.listings import list_listings
from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.listing_photo import ListingPhoto
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.models.reservation_payment_attempt import ReservationPaymentAttempt
from app.models.payment_webhook_event import PaymentWebhookEvent
from app.models.room_type import RoomType
from app.models.menu_item import MenuItem
from app.models.analytics_event import AnalyticsEvent
from app.models.chat_session_state import ChatSessionState
from app.models.restaurant import Restaurant
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.api.instay import create_restaurant_booking, create_room_service_order
from app.api.ai_concierge import in_stay_concierge
from app.api.listings import create_block, create_room_type, delete_room_type, get_quote, get_room_availability, list_my_room_types, update_room_type
from app.api.reservations import get_guest_reservation, list_my_reservations
from app.schemas.listing_block import ListingBlockCreate
from app.schemas.listing import RoomTypeCreate, RoomTypeUpdate
from app.schemas.ai_concierge import AiConciergeMessageIn
from app.schemas.instay import RestaurantTableBookingCreate, RoomServiceOrderCreate
from app.schemas.payment import PaymentWebhookIn
from app.schemas.chat import ChatRecommendIn
from app.schemas.reservation import ReservationCreate
from app.schemas.support_ticket import SupportTicketStatusUpdate
from app.api.support import list_support_tickets, update_support_ticket_status
from app.services.payment_service import attempt_mock_payment, process_payment_webhook, queue_mock_payment_attempt
from app.services.listing_service import get_cover_photo_map
from app.services.pricing import dynamic_multiplier_for_range, quote_price
from app.services.reservation_lifecycle import expire_stale_pending_reservations
from app.services.reservation_service import create_reservation
from app.services.reservation_service import calculate_cancellation_terms
from app.services.reservation_service import cancel_reservation_by_guest_email
from app.services.reservation_service import list_partner_notifications
from app.services.reservation_service import mark_partner_notifications_read
from app.services.reservation_service import list_partner_communication_events
from app.services.reservation_service import retry_partner_communication_event
from app.services.reservation_service import retry_partner_communication_events_batch
from app.services.notification_service import _dispatch_with_retries
from app.core.config import settings
from app.core.reservation_access import create_reservation_access_token


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_get_cover_photo_map_prefers_cover(db_session: Session):
    listing = Listing(
        title="Test",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=25000,
        cleaning_fee=7000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    db_session.add_all(
        [
            ListingPhoto(listing_id=listing.id, file_path="a.jpg", file_url="/media/a.jpg", is_cover=False, sort_order=1),
            ListingPhoto(listing_id=listing.id, file_path="b.jpg", file_url="/media/b.jpg", is_cover=True, sort_order=2),
        ]
    )
    db_session.commit()

    result = get_cover_photo_map(db_session, [listing])
    assert result[listing.id] == "/media/b.jpg"


def test_room_availability_counts_inventory_by_room_type(db_session: Session):
    listing = Listing(
        title="Hotel inventory",
        city="Dubai",
        district="JBR",
        property_type="hotel",
        nightly_price=55000,
        cleaning_fee=7000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Hotel",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    room_type = RoomType(
        listing_id=listing.id,
        name="Deluxe Room",
        description="Sea view",
        nightly_price=65000,
        total_inventory=2,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=0,
    )
    db_session.add(room_type)
    db_session.commit()
    db_session.refresh(room_type)

    check_in = date.today() + timedelta(days=10)
    check_out = check_in + timedelta(days=2)
    availability_end = check_in + timedelta(days=4)
    db_session.add(
        Reservation(
            listing_id=listing.id,
            room_type_id=room_type.id,
            guest_name="Guest",
            guest_email="guest@example.com",
            guest_phone="+77000000000",
            check_in=check_in,
            check_out=check_out,
            guests=2,
            tariff_plan="smart",
            total_price=100000,
            status="confirmed",
        )
    )
    db_session.commit()

    availability = get_room_availability(
        listing.id,
        from_date=check_in,
        to_date=availability_end,
        guests=2,
        db=db_session,
    )
    assert availability.room_types[0].available_windows[0].available_count == 1

    quote = get_quote(
        listing.id,
        check_in=check_in,
        check_out=check_out,
        guests=2,
        tariff="smart",
        room_type_id=room_type.id,
        db=db_session,
    )
    assert quote.available is True
    assert quote.room_type_id == room_type.id
    assert quote.nightly_price >= room_type.nightly_price


def test_room_type_payment_ignores_other_room_type_conflicts(db_session: Session):
    listing = Listing(
        title="Payment room inventory",
        city="Dubai",
        district="Marina",
        property_type="hotel",
        nightly_price=70000,
        cleaning_fee=7000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Hotel",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    deluxe = RoomType(
        listing_id=listing.id,
        name="Deluxe",
        description="Deluxe",
        nightly_price=80000,
        total_inventory=1,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=0,
    )
    suite = RoomType(
        listing_id=listing.id,
        name="Suite",
        description="Suite",
        nightly_price=95000,
        total_inventory=1,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=1,
    )
    db_session.add_all([deluxe, suite])
    db_session.commit()
    db_session.refresh(deluxe)
    db_session.refresh(suite)

    db_session.add(
        Reservation(
            listing_id=listing.id,
            room_type_id=deluxe.id,
            guest_name="Existing Guest",
            guest_email="existing-room-payment@example.com",
            guest_phone="+77000000000",
            check_in=date.today() + timedelta(days=2),
            check_out=date.today() + timedelta(days=4),
            guests=2,
            tariff_plan="smart",
            total_price=120000,
            status="confirmed",
        )
    )
    db_session.commit()

    draft = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            room_type_id=suite.id,
            guest_name="Suite Guest",
            guest_email="suite-payment@example.com",
            guest_phone="+77001234567",
            check_in=date.today() + timedelta(days=2),
            check_out=date.today() + timedelta(days=4),
            guests=2,
            tariff_plan="smart",
        ),
    )

    payment = attempt_mock_payment(db_session, draft.id, "card")
    db_session.refresh(draft)

    assert payment.payment_status == "paid"
    assert payment.reservation_status == "confirmed"
    assert draft.status == "confirmed"


def test_room_availability_subtracts_room_type_blocks_only(db_session: Session):
    user = User(
        email="partner-room-blocks@test.dev",
        hashed_password="x",
        full_name="Partner Blocks",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Blocked room inventory",
        city="Dubai",
        district="Palm",
        property_type="hotel",
        nightly_price=80000,
        cleaning_fee=7000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Hotel",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    deluxe = RoomType(
        listing_id=listing.id,
        name="Deluxe",
        description="Deluxe",
        nightly_price=90000,
        total_inventory=3,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=0,
    )
    suite = RoomType(
        listing_id=listing.id,
        name="Suite",
        description="Suite",
        nightly_price=120000,
        total_inventory=2,
        max_guests=4,
        bedrooms=2,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=1,
    )
    db_session.add_all([deluxe, suite])
    db_session.commit()
    db_session.refresh(deluxe)
    db_session.refresh(suite)

    block = create_block(
        listing.id,
        ListingBlockCreate(
            room_type_id=deluxe.id,
            blocked_inventory=2,
            check_in=date(2026, 6, 10),
            check_out=date(2026, 6, 12),
            reason="maintenance",
        ),
        db_session,
        user,
    )
    assert block.room_type_id == deluxe.id
    assert block.blocked_inventory == 2

    availability = get_room_availability(
        listing.id,
        from_date=date(2026, 6, 10),
        to_date=date(2026, 6, 12),
        guests=2,
        db=db_session,
    )
    counts = {room.name: room.available_windows[0].available_count for room in availability.room_types}
    assert counts["Deluxe"] == 1
    assert counts["Suite"] == 2

    with pytest.raises(HTTPException) as exc:
        create_block(
            listing.id,
            ListingBlockCreate(
                room_type_id=deluxe.id,
                blocked_inventory=2,
                check_in=date(2026, 6, 10),
                check_out=date(2026, 6, 12),
                reason="over block",
            ),
            db_session,
            user,
        )
    assert exc.value.status_code == 409


def test_partner_room_type_crud_guards_reserved_categories(db_session: Session):
    user = User(
        email="partner-room-types@test.dev",
        hashed_password="x",
        full_name="Partner",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Room manager",
        city="Dubai",
        district="Marina",
        property_type="hotel",
        nightly_price=60000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    created = create_room_type(
        listing.id,
        RoomTypeCreate(
            name="Deluxe Sea View",
            description="Sea view room",
            nightly_price=75000,
            total_inventory=3,
            max_guests=2,
            bedrooms=1,
            bathrooms=1,
            amenities="WiFi, Sea view",
            sort_order=2,
        ),
        db_session,
        user,
    )
    assert created.id is not None

    rows = list_my_room_types(listing.id, db_session, user)
    assert [row.name for row in rows] == ["Deluxe Sea View"]

    updated = update_room_type(
        listing.id,
        created.id,
        RoomTypeUpdate(total_inventory=5, is_active=False, sort_order=1),
        db_session,
        user,
    )
    assert updated.total_inventory == 5
    assert updated.is_active is False
    assert updated.sort_order == 1

    db_session.add(
        Reservation(
            listing_id=listing.id,
            room_type_id=created.id,
            guest_name="Guest",
            guest_email="reserved@example.com",
            guest_phone="+77000000000",
            check_in=date(2026, 6, 2),
            check_out=date(2026, 6, 4),
            guests=2,
            tariff_plan="smart",
            total_price=120000,
            status="confirmed",
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        delete_room_type(listing.id, created.id, db_session, user)
    assert exc.value.status_code == 409

    db_session.query(Reservation).delete()
    db_session.commit()

    delete_room_type(listing.id, created.id, db_session, user)
    assert db_session.get(RoomType, created.id) is None


def test_create_reservation_calculates_total(db_session: Session):
    db_session.add(
        User(
            email="partner@test.dev",
            hashed_password="x",
            full_name="Partner",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Loft",
        city="Almaty",
        district="Bostandyk",
        property_type="apartment",
        nightly_price=30000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="  Test Guest  ",
        guest_email="guest@example.com",
        guest_phone="+77001234567",
        check_in=date.today() + timedelta(days=3),
        check_out=date.today() + timedelta(days=6),
        guests=2,
        tariff_plan="smart",
    )

    reservation = create_reservation(db_session, payload)
    assert reservation.id is not None
    assert reservation.total_price > 0
    assert reservation.guest_name == "Test Guest"
    assert reservation.status == "draft"


def test_reservation_responses_include_room_type_name(db_session: Session):
    user = User(
        email="partner-reservation-room@test.dev",
        hashed_password="x",
        full_name="Partner Room",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Room visible hotel",
        city="Dubai",
        district="Marina",
        property_type="hotel",
        nightly_price=50000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    room_type = RoomType(
        listing_id=listing.id,
        name="Marina Deluxe",
        description="Deluxe room",
        nightly_price=62000,
        total_inventory=2,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        is_active=True,
        sort_order=0,
    )
    db_session.add(room_type)
    db_session.commit()
    db_session.refresh(room_type)

    reservation = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            room_type_id=room_type.id,
            guest_name="Room Guest",
            guest_email="room-visible@example.com",
            guest_phone="+77001234567",
            check_in=date.today() + timedelta(days=5),
            check_out=date.today() + timedelta(days=7),
            guests=2,
            tariff_plan="smart",
        ),
    )

    guest_out = get_guest_reservation(
        reservation.id,
        create_reservation_access_token(reservation.id, reservation.guest_email),
        db_session,
    )
    assert guest_out.room_type_id == room_type.id
    assert guest_out.room_type_name == "Marina Deluxe"

    partner_rows = list_my_reservations(
        status_filter=None,
        payment_status=None,
        listing_id=None,
        guest_query=None,
        check_in_from=None,
        check_out_to=None,
        db=db_session,
        user=user,
    )
    assert partner_rows[0].id == reservation.id
    assert partner_rows[0].room_type_id == room_type.id
    assert partner_rows[0].room_type_name == "Marina Deluxe"


def test_partner_reservations_can_filter_refunded_payments(db_session: Session):
    user = User(
        email="partner-refunded-filter@test.dev",
        hashed_password="x",
        full_name="Partner Refunded",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Refund filter hotel",
        city="Dubai",
        district="JBR",
        property_type="hotel",
        nightly_price=48000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            guest_name="Refund Guest",
            guest_email="refund-filter@example.com",
            guest_phone="+77001234567",
            check_in=date.today() + timedelta(days=5),
            check_out=date.today() + timedelta(days=7),
            guests=2,
            tariff_plan="smart",
        ),
    )

    payment = db_session.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation.id))
    assert payment is not None
    payment.payment_status = "refunded"
    db_session.commit()

    refunded_rows = list_my_reservations(
        status_filter=None,
        payment_status="refunded",
        listing_id=None,
        guest_query=None,
        check_in_from=None,
        check_out_to=None,
        db=db_session,
        user=user,
    )
    paid_rows = list_my_reservations(
        status_filter=None,
        payment_status="paid",
        listing_id=None,
        guest_query=None,
        check_in_from=None,
        check_out_to=None,
        db=db_session,
        user=user,
    )

    assert [row.id for row in refunded_rows] == [reservation.id]
    assert reservation.id not in [row.id for row in paid_rows]


def test_create_reservation_rejects_overbooking(db_session: Session):
    listing = Listing(
        title="Studio",
        city="Astana",
        district="Yesil",
        property_type="apartment",
        nightly_price=20000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=1,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="guest2@example.com",
        guest_phone="+77001234568",
        check_in=date.today() + timedelta(days=1),
        check_out=date.today() + timedelta(days=2),
        guests=2,
    )

    with pytest.raises(HTTPException):
        create_reservation(db_session, payload)


def test_create_reservation_rejects_too_long_stay(db_session: Session):
    listing = Listing(
        title="Long stay limit",
        city="Astana",
        district="Yesil",
        property_type="apartment",
        nightly_price=25000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="guest-long@example.com",
        guest_phone="+77001234568",
        check_in=date.today() + timedelta(days=1),
        check_out=date.today() + timedelta(days=35),
        guests=2,
    )

    with pytest.raises(HTTPException) as exc:
        create_reservation(db_session, payload)
    assert exc.value.status_code == 400
    assert "Stay duration must be between 1 and 30 nights" in str(exc.value.detail)


def test_create_reservation_rejects_past_check_in(db_session: Session):
    listing = Listing(
        title="Past stay guard",
        city="Astana",
        district="Yesil",
        property_type="apartment",
        nightly_price=25000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Past Guest",
        guest_email="past@example.com",
        guest_phone="+77001234561",
        check_in=date.today() - timedelta(days=1),
        check_out=date.today() + timedelta(days=1),
        guests=2,
    )

    with pytest.raises(HTTPException) as exc:
        create_reservation(db_session, payload)
    assert exc.value.status_code == 400
    assert "check_in cannot be in the past" in str(exc.value.detail)


def test_create_reservation_rejects_too_far_check_in(db_session: Session):
    listing = Listing(
        title="Horizon guard",
        city="Astana",
        district="Yesil",
        property_type="apartment",
        nightly_price=25000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Future Guest",
        guest_email="future@example.com",
        guest_phone="+77001234562",
        check_in=date.today() + timedelta(days=366),
        check_out=date.today() + timedelta(days=368),
        guests=2,
    )

    with pytest.raises(HTTPException) as exc:
        create_reservation(db_session, payload)
    assert exc.value.status_code == 400
    assert "check_in is too far in the future" in str(exc.value.detail)


def test_dynamic_pricing_weekend_more_expensive_than_weekday():
    weekday_in = date(2026, 4, 20)  # Monday
    weekday_out = date(2026, 4, 22)
    weekend_in = date(2026, 4, 24)  # Friday
    weekend_out = date(2026, 4, 26)

    weekday_multiplier = dynamic_multiplier_for_range(weekday_in, weekday_out)
    weekend_multiplier = dynamic_multiplier_for_range(weekend_in, weekend_out)
    assert weekend_multiplier > weekday_multiplier


def test_quote_price_applies_dynamic_multiplier():
    base = quote_price(
        nightly_price=30000,
        cleaning_fee=5000,
        nights=2,
        tariff_plan="smart",
        check_in=date(2026, 4, 21),  # Tue/Wed
        check_out=date(2026, 4, 23),
    )
    surge = quote_price(
        nightly_price=30000,
        cleaning_fee=5000,
        nights=2,
        tariff_plan="smart",
        check_in=date(2026, 4, 24),  # Fri/Sat
        check_out=date(2026, 4, 26),
    )

    assert float(surge["dynamic_multiplier"]) > float(base["dynamic_multiplier"])
    assert float(surge["total"]) > float(base["total"])


def test_cancellation_terms_smart_has_tiered_penalty():
    reservation = Reservation(
        listing_id=1,
        guest_name="Guest",
        guest_email="guest@example.com",
        guest_phone="+77001230000",
        check_in=date(2026, 5, 20),
        check_out=date(2026, 5, 22),
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="confirmed",
    )
    terms_early = calculate_cancellation_terms(reservation, as_of=date(2026, 5, 10))
    terms_mid = calculate_cancellation_terms(reservation, as_of=date(2026, 5, 16))
    terms_late = calculate_cancellation_terms(reservation, as_of=date(2026, 5, 19))

    assert terms_early["penalty_percent"] == 0
    assert terms_early["refund_amount"] == 100000
    assert terms_mid["penalty_percent"] == 30
    assert terms_mid["refund_amount"] == 70000
    assert terms_late["penalty_percent"] == 60
    assert terms_late["refund_amount"] == 40000


def test_cancellation_terms_basic_more_strict_than_flex():
    basic = Reservation(
        listing_id=1,
        guest_name="Guest",
        guest_email="guest@example.com",
        guest_phone="+77001230000",
        check_in=date(2026, 5, 20),
        check_out=date(2026, 5, 22),
        guests=2,
        tariff_plan="basic",
        total_price=120000,
        status="confirmed",
    )
    flex = Reservation(
        listing_id=1,
        guest_name="Guest",
        guest_email="guest@example.com",
        guest_phone="+77001230000",
        check_in=date(2026, 5, 20),
        check_out=date(2026, 5, 22),
        guests=2,
        tariff_plan="flex",
        total_price=120000,
        status="confirmed",
    )

    basic_terms = calculate_cancellation_terms(basic, as_of=date(2026, 5, 19))
    flex_terms = calculate_cancellation_terms(flex, as_of=date(2026, 5, 19))

    assert basic_terms["penalty_percent"] == 100
    assert basic_terms["refund_amount"] == 0
    assert flex_terms["penalty_percent"] == 0
    assert flex_terms["refund_amount"] == 120000


def test_create_reservation_deduplicates_rapid_retries(db_session: Session):
    listing = Listing(
        title="Retry-safe stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Retry User",
        guest_email="retry@example.com",
        guest_phone="+77001234569",
        check_in=date.today() + timedelta(days=2),
        check_out=date.today() + timedelta(days=4),
        guests=2,
        tariff_plan="smart",
    )

    first = create_reservation(db_session, payload)
    second = create_reservation(db_session, payload)

    assert first.id == second.id


def test_payment_attempt_rejects_conflict_and_expires_draft(db_session: Session):
    listing = Listing(
        title="Conflict-safe stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    check_in = date.today() + timedelta(days=5)
    check_out = date.today() + timedelta(days=8)
    confirmed = Reservation(
        listing_id=listing.id,
        guest_name="Confirmed Guest",
        guest_email="confirmed@example.com",
        guest_phone="+77001230001",
        check_in=check_in,
        check_out=check_out,
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="confirmed",
    )
    db_session.add(confirmed)
    db_session.commit()

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Draft Guest",
        guest_email="draft@example.com",
        guest_phone="+77001230002",
        check_in=check_in,
        check_out=check_out,
        guests=2,
        tariff_plan="smart",
    )
    draft = create_reservation(db_session, payload)
    assert draft.status == "draft"

    with pytest.raises(HTTPException) as exc:
        queue_mock_payment_attempt(
            db_session,
            reservation_id=draft.id,
            method="card",
            idempotency_key="idem-conflict-001",
            force_fail=False,
            background_tasks=BackgroundTasks(),
        )
    assert exc.value.status_code == 409
    db_session.refresh(draft)
    assert draft.status == "expired"


def test_expire_stale_pending_uses_payment_attempted_at(db_session: Session):
    listing = Listing(
        title="TTL stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    old_pending = Reservation(
        listing_id=listing.id,
        guest_name="Old Pending",
        guest_email="old@example.com",
        guest_phone="+77001230011",
        check_in=date.today() + timedelta(days=10),
        check_out=date.today() + timedelta(days=12),
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="pending_payment",
        created_at=now - timedelta(hours=2),
    )
    fresh_attempt = Reservation(
        listing_id=listing.id,
        guest_name="Fresh Attempt",
        guest_email="fresh@example.com",
        guest_phone="+77001230012",
        check_in=date.today() + timedelta(days=13),
        check_out=date.today() + timedelta(days=15),
        guests=2,
        tariff_plan="smart",
        total_price=120000,
        status="pending_payment",
        created_at=now - timedelta(hours=2),
    )
    db_session.add_all([old_pending, fresh_attempt])
    db_session.commit()
    db_session.refresh(old_pending)
    db_session.refresh(fresh_attempt)

    db_session.add_all(
        [
            ReservationPayment(
                reservation_id=old_pending.id,
                payment_status="pending",
                amount=old_pending.total_price,
                currency="KZT",
                attempted_at=now - timedelta(minutes=40),
            ),
            ReservationPayment(
                reservation_id=fresh_attempt.id,
                payment_status="pending",
                amount=fresh_attempt.total_price,
                currency="KZT",
                attempted_at=now - timedelta(minutes=5),
            ),
        ]
    )
    db_session.commit()

    expired_count = expire_stale_pending_reservations(db_session, now=now)
    assert expired_count == 1

    db_session.refresh(old_pending)
    db_session.refresh(fresh_attempt)
    assert old_pending.status == "expired"
    assert fresh_attempt.status == "pending_payment"


def test_attempt_mock_payment_failed_returns_to_draft(db_session: Session):
    listing = Listing(
        title="Retry payment stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Retry Payment",
        guest_email="retrypay@example.com",
        guest_phone="+77001239991",
        check_in=date.today() + timedelta(days=6),
        check_out=date.today() + timedelta(days=8),
        guests=2,
        tariff_plan="smart",
    )
    reservation = create_reservation(db_session, payload)
    assert reservation.status == "draft"

    payment = attempt_mock_payment(
        db_session,
        reservation_id=reservation.id,
        method="card",
        force_fail=True,
    )
    assert payment.payment_status == "failed"
    assert payment.reservation_status == "draft"
    assert payment.attempt_status == "failed"
    db_session.refresh(reservation)
    assert reservation.status == "draft"


def test_queue_payment_attempt_idempotency_reuses_existing_attempt(db_session: Session):
    listing = Listing(
        title="Idempotent stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Idempotent User",
        guest_email="idempotent@example.com",
        guest_phone="+77001239992",
        check_in=date.today() + timedelta(days=7),
        check_out=date.today() + timedelta(days=9),
        guests=2,
        tariff_plan="smart",
    )
    reservation = create_reservation(db_session, payload)

    idempotency_key = "idem-reuse-001"
    first = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="card",
        idempotency_key=idempotency_key,
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    second = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="card",
        idempotency_key=idempotency_key,
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )

    attempts = list(
        db_session.query(ReservationPaymentAttempt)
        .filter(ReservationPaymentAttempt.reservation_id == reservation.id)
        .all()
    )
    assert len(attempts) == 1
    assert first.idempotency_reused is False
    assert second.idempotency_reused is True
    assert second.attempt_status == "pending"
    assert second.reservation_status == "pending_payment"


def test_queue_payment_attempt_reuses_inflight_pending_attempt_for_different_key(db_session: Session):
    listing = Listing(
        title="Inflight idempotency stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Inflight User",
        guest_email="inflight@example.com",
        guest_phone="+77001239993",
        check_in=date.today() + timedelta(days=7),
        check_out=date.today() + timedelta(days=10),
        guests=2,
        tariff_plan="smart",
    )
    reservation = create_reservation(db_session, payload)

    first = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="card",
        idempotency_key="idem-inflight-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    second = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="kaspi",
        idempotency_key="idem-inflight-002",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )

    attempts = list(
        db_session.query(ReservationPaymentAttempt)
        .filter(ReservationPaymentAttempt.reservation_id == reservation.id)
        .all()
    )
    assert len(attempts) == 1
    assert first.idempotency_reused is False
    assert second.idempotency_reused is True


def test_payment_webhook_confirms_pending_payment_idempotently(db_session: Session):
    listing = Listing(
        title="Webhook paid stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            guest_name="Webhook Paid",
            guest_email="webhookpaid@example.com",
            guest_phone="+77001239994",
            check_in=date.today() + timedelta(days=12),
            check_out=date.today() + timedelta(days=14),
            guests=2,
            tariff_plan="smart",
        ),
    )
    payment = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="card",
        idempotency_key="idem-webhook-paid",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )

    payload = PaymentWebhookIn(
        provider="mock",
        event_id="evt-webhook-paid",
        reservation_id=reservation.id,
        status="paid",
        amount=payment.amount,
        currency=payment.currency,
        method="card",
        idempotency_key="idem-webhook-paid",
    )
    first = process_payment_webhook(db_session, payload)
    duplicate = process_payment_webhook(db_session, payload)

    db_session.refresh(reservation)
    attempt = db_session.scalar(
        select(ReservationPaymentAttempt).where(ReservationPaymentAttempt.reservation_id == reservation.id)
    )
    events = list(db_session.query(PaymentWebhookEvent).filter(PaymentWebhookEvent.event_id == "evt-webhook-paid").all())

    assert first.duplicate is False
    assert first.payment_status == "paid"
    assert first.reservation_status == "confirmed"
    assert duplicate.duplicate is True
    assert duplicate.payment_status == "paid"
    assert reservation.status == "confirmed"
    assert attempt is not None
    assert attempt.status == "paid"
    assert len(events) == 1


def test_payment_webhook_rejects_amount_mismatch(db_session: Session):
    listing = Listing(
        title="Webhook amount stay",
        city="Shymkent",
        district="Nauryz",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            guest_name="Webhook Amount",
            guest_email="webhookamount@example.com",
            guest_phone="+77001239995",
            check_in=date.today() + timedelta(days=15),
            check_out=date.today() + timedelta(days=17),
            guests=2,
            tariff_plan="smart",
        ),
    )
    payment = queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="kaspi",
        idempotency_key="idem-webhook-amount",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )

    with pytest.raises(HTTPException) as exc:
        process_payment_webhook(
            db_session,
            PaymentWebhookIn(
                provider="mock",
                event_id="evt-webhook-amount",
                reservation_id=reservation.id,
                status="paid",
                amount=payment.amount + 1,
                currency=payment.currency,
                method="kaspi",
                idempotency_key="idem-webhook-amount",
            ),
        )

    event = db_session.scalar(select(PaymentWebhookEvent).where(PaymentWebhookEvent.event_id == "evt-webhook-amount"))
    db_session.refresh(reservation)

    assert exc.value.status_code == 409
    assert event is not None
    assert event.status == "rejected"
    assert event.reason == "amount_mismatch"
    assert reservation.status == "pending_payment"


def test_partner_notifications_can_be_marked_read(db_session: Session):
    user = User(
        email="partner-notification-read@test.dev",
        hashed_password="x",
        full_name="Partner Notification Read",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Notification Read Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=32000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="notification read test",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = create_reservation(
        db_session,
        ReservationCreate(
            listing_id=listing.id,
            guest_name="Notification Guest",
            guest_email="notification-read@test.dev",
            guest_phone="+77001230098",
            check_in=date.today() + timedelta(days=18),
            check_out=date.today() + timedelta(days=20),
            guests=2,
            tariff_plan="smart",
        ),
    )
    queue_mock_payment_attempt(
        db_session,
        reservation_id=reservation.id,
        method="card",
        idempotency_key="notifications-read-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )

    notifications = [
        item for item in list_partner_notifications(db=db_session, user=user, limit=20)
        if item.reservation_id == reservation.id
    ]
    assert notifications
    assert notifications[0].read is False

    result = mark_partner_notifications_read(db_session, user, [notifications[0].event_id])
    updated = [
        item for item in list_partner_notifications(db=db_session, user=user, limit=20)
        if item.event_id == notifications[0].event_id
    ]
    duplicate = mark_partner_notifications_read(db_session, user, [notifications[0].event_id])

    assert result.marked == 1
    assert result.event_ids == [notifications[0].event_id]
    assert updated and updated[0].read is True
    assert duplicate.marked == 0


def test_reservation_status_communication_events_logged(db_session: Session):
    started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    user = User(
        email="partner-events@test.dev",
        hashed_password="x",
        full_name="Partner Events",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Events Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=32000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="events test",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    first_payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Events Guest",
        guest_email="events@test.dev",
        guest_phone="+77001230099",
        check_in=date.today() + timedelta(days=5),
        check_out=date.today() + timedelta(days=7),
        guests=2,
        tariff_plan="smart",
    )
    first = create_reservation(db_session, first_payload)
    queue_mock_payment_attempt(
        db_session,
        reservation_id=first.id,
        method="card",
        idempotency_key="events-pending-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    attempt_mock_payment(
        db_session,
        reservation_id=first.id,
        method="card",
        force_fail=False,
    )
    cancel_reservation_by_guest_email(db_session, first.id, first.guest_email)

    second_payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Events Expire Guest",
        guest_email="events-expire@test.dev",
        guest_phone="+77001230100",
        check_in=date.today() + timedelta(days=8),
        check_out=date.today() + timedelta(days=10),
        guests=2,
        tariff_plan="smart",
    )
    second = create_reservation(db_session, second_payload)
    queue_mock_payment_attempt(
        db_session,
        reservation_id=second.id,
        method="card",
        idempotency_key="events-expire-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    payment = db_session.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == second.id))
    assert payment is not None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    payment.attempted_at = now - timedelta(minutes=40)
    payment.updated_at = now - timedelta(minutes=40)
    db_session.commit()
    expire_stale_pending_reservations(db_session, now=now)

    log_file = Path(__file__).resolve().parents[1] / "runtime_logs" / "communication_events.log"
    assert log_file.exists()
    lines = [line for line in log_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    entries = [json.loads(line) for line in lines]
    recent_entries: list[dict] = []
    for item in entries:
        created_raw = str(item.get("created_at", "")).strip()
        if not created_raw:
            continue
        try:
            created_dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            continue
        if created_dt >= started_at:
            recent_entries.append(item)

    first_events = {
        str(item.get("event"))
        for item in recent_entries
        if int(item.get("reservation_id", 0)) == first.id and str(item.get("channel")) == "webhook"
    }
    second_events = {
        str(item.get("event"))
        for item in recent_entries
        if int(item.get("reservation_id", 0)) == second.id and str(item.get("channel")) == "webhook"
    }

    assert "reservation_pending_payment" in first_events
    assert "reservation_confirmed" in first_events
    assert "reservation_cancelled" in first_events
    assert "reservation_expired" in second_events


def test_list_partner_communication_events_filters_by_owner_and_status(db_session: Session):
    started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    owner = User(
        email="owner-events@test.dev",
        hashed_password="x",
        full_name="Owner Events",
        role="partner",
    )
    outsider = User(
        email="outsider-events@test.dev",
        hashed_password="x",
        full_name="Outsider Events",
        role="partner",
    )
    db_session.add_all([owner, outsider])
    db_session.commit()
    db_session.refresh(owner)
    db_session.refresh(outsider)

    owned_listing = Listing(
        title="Owned Events Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=31000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="owned events",
        is_active=True,
        owner_id=owner.id,
    )
    outsider_listing = Listing(
        title="Outsider Events Listing",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=28000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="outsider events",
        is_active=True,
        owner_id=outsider.id,
    )
    db_session.add_all([owned_listing, outsider_listing])
    db_session.commit()
    db_session.refresh(owned_listing)
    db_session.refresh(outsider_listing)

    owned_payload = ReservationCreate(
        listing_id=owned_listing.id,
        guest_name="Owned Guest",
        guest_email="owned-events-guest@test.dev",
        guest_phone="+77001230991",
        check_in=date.today() + timedelta(days=6),
        check_out=date.today() + timedelta(days=8),
        guests=2,
        tariff_plan="smart",
    )
    outsider_payload = ReservationCreate(
        listing_id=outsider_listing.id,
        guest_name="Outsider Guest",
        guest_email="outsider-events-guest@test.dev",
        guest_phone="+77001230992",
        check_in=date.today() + timedelta(days=6),
        check_out=date.today() + timedelta(days=8),
        guests=2,
        tariff_plan="smart",
    )

    owned_reservation = create_reservation(db_session, owned_payload)
    outsider_reservation = create_reservation(db_session, outsider_payload)

    queue_mock_payment_attempt(
        db_session,
        reservation_id=owned_reservation.id,
        method="card",
        idempotency_key="owner-comm-filter-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    queue_mock_payment_attempt(
        db_session,
        reservation_id=outsider_reservation.id,
        method="card",
        idempotency_key="outsider-comm-filter-001",
        force_fail=False,
        background_tasks=BackgroundTasks(),
    )
    attempt_mock_payment(
        db_session,
        reservation_id=owned_reservation.id,
        method="card",
        force_fail=False,
    )
    cancel_reservation_by_guest_email(db_session, owned_reservation.id, owned_reservation.guest_email)

    filtered = list_partner_communication_events(
        db=db_session,
        user=owner,
        limit=120,
        channel="webhook",
        status="failed",
    )
    recent_failed = [row for row in filtered if row.created_at.replace(tzinfo=None) >= started_at]
    assert recent_failed == []

    sent_events = list_partner_communication_events(
        db=db_session,
        user=owner,
        limit=120,
        channel="webhook",
        status="skipped",
    )
    assert len(sent_events) > 0
    assert all(row.channel == "webhook" for row in sent_events)
    assert all(row.status == "skipped" for row in sent_events)
    assert all(row.listing_id == owned_listing.id for row in sent_events if row.listing_id is not None)
    recent_sent_events = [row for row in sent_events if row.created_at.replace(tzinfo=None) >= started_at]
    assert any(row.reservation_id == owned_reservation.id for row in recent_sent_events)


def test_dispatch_with_retries_retries_and_stops_on_success():
    calls: list[int] = []

    def flaky_dispatch(_: dict) -> dict:
        calls.append(1)
        if len(calls) < 3:
            return {"status": "failed", "reason": "temporary"}
        return {"status": "sent", "reason": "ok"}

    original_max_attempts = settings.notification_retry_max_attempts
    original_backoff = settings.notification_retry_backoff_seconds
    settings.notification_retry_max_attempts = 4
    settings.notification_retry_backoff_seconds = 0
    try:
        result = _dispatch_with_retries("webhook", {}, flaky_dispatch, retryable=True)
    finally:
        settings.notification_retry_max_attempts = original_max_attempts
        settings.notification_retry_backoff_seconds = original_backoff

    assert result["status"] == "sent"
    assert result["attempts"] == 3
    assert result["retry_applied"] is True


def test_dispatch_with_retries_respects_non_retryable():
    calls: list[int] = []

    def always_fail(_: dict) -> dict:
        calls.append(1)
        return {"status": "failed", "reason": "permanent"}

    result = _dispatch_with_retries("telegram", {}, always_fail, retryable=False)
    assert result["status"] == "failed"
    assert result["attempts"] == 1
    assert result["retry_applied"] is False


def test_retry_partner_communication_event_returns_previous_and_retried(db_session: Session):
    user = User(
        email="retry-owner@test.dev",
        hashed_password="x",
        full_name="Retry Owner",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Retry Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=33000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="retry event listing",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Retry Guest",
        guest_email="retry-guest@test.dev",
        guest_phone="+77001230993",
        check_in=date.today() + timedelta(days=6),
        check_out=date.today() + timedelta(days=8),
        guests=2,
        tariff_plan="smart",
    )
    reservation = create_reservation(db_session, payload)

    log_file = Path(__file__).resolve().parents[1] / "runtime_logs" / "communication_events.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    failed_entry = {
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "channel": "webhook",
        "partner_id": user.id,
        "partner_email": user.email,
        "listing_title": listing.title,
        "event": "reservation_confirmed",
        "reservation_id": reservation.id,
        "listing_id": listing.id,
        "status": "failed",
        "reason": "http_500",
        "attempts": 1,
        "retry_applied": False,
    }
    raw_line = json.dumps(failed_entry, ensure_ascii=False)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(raw_line + "\n")
    event_id = hashlib.sha1(raw_line.encode("utf-8")).hexdigest()[:16]

    previous, retried = retry_partner_communication_event(db_session, user, event_id)
    assert previous.event_id == event_id
    assert previous.status == "failed"
    assert retried.channel == "webhook"
    assert retried.event == "reservation_confirmed"
    assert retried.reservation_id == reservation.id
    assert retried.status in {"sent", "failed", "skipped"}


def test_retry_partner_communication_events_batch_handles_mixed_results(db_session: Session):
    user = User(
        email="retry-batch-owner@test.dev",
        hashed_password="x",
        full_name="Retry Batch Owner",
        role="partner",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    listing = Listing(
        title="Retry Batch Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=34000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="retry batch listing",
        is_active=True,
        owner_id=user.id,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    payload = ReservationCreate(
        listing_id=listing.id,
        guest_name="Retry Batch Guest",
        guest_email="retry-batch-guest@test.dev",
        guest_phone="+77001230994",
        check_in=date.today() + timedelta(days=6),
        check_out=date.today() + timedelta(days=8),
        guests=2,
        tariff_plan="smart",
    )
    reservation = create_reservation(db_session, payload)

    log_file = Path(__file__).resolve().parents[1] / "runtime_logs" / "communication_events.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    failed_entry = {
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "channel": "email",
        "partner_id": user.id,
        "partner_email": user.email,
        "listing_title": listing.title,
        "event": "reservation_confirmed",
        "reservation_id": reservation.id,
        "listing_id": listing.id,
        "status": "failed",
        "reason": "smtp_down",
        "attempts": 1,
        "retry_applied": False,
    }
    raw_line = json.dumps(failed_entry, ensure_ascii=False)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(raw_line + "\n")
    valid_event_id = hashlib.sha1(raw_line.encode("utf-8")).hexdigest()[:16]

    out = retry_partner_communication_events_batch(
        db=db_session,
        user=user,
        event_ids=[valid_event_id, "missing-event-id", valid_event_id],
    )
    assert out.requested == 2
    assert out.retried == 1
    assert out.failed == 1
    assert any(item.event_id == valid_event_id and item.success for item in out.items)
    assert any(item.event_id == "missing-event-id" and not item.success for item in out.items)


def test_listings_best_match_prefers_title_relevance(db_session: Session):
    db_session.add(
        User(
            email="partner2@test.dev",
            hashed_password="x",
            full_name="Partner Two",
            role="partner",
        )
    )
    db_session.commit()

    strong_title_match = Listing(
        title="WiFi Loft in Center",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=36000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.0,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="Kitchen",
        description="Central location",
        is_active=True,
        owner_id=1,
    )
    high_rating_amenities_match = Listing(
        title="Premium Skyline Suite",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=36000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=5.0,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="Fast WiFi, Kitchen",
        description="Luxury stay",
        is_active=True,
        owner_id=1,
    )
    db_session.add_all([strong_title_match, high_rating_amenities_match])
    db_session.commit()

    result = list_listings(
        city="Shymkent",
        q="wifi",
        guests=2,
        check_in=None,
        check_out=None,
        min_price=None,
        max_price=None,
        sort_by="best_match",
        sort_order="desc",
        page=1,
        page_size=12,
        db=db_session,
    )

    assert result.total == 2
    assert result.items[0].title == "WiFi Loft in Center"


def test_listings_best_match_prefers_lower_total_for_dates(db_session: Session):
    db_session.add(
        User(
            email="partner3@test.dev",
            hashed_password="x",
            full_name="Partner Three",
            role="partner",
        )
    )
    db_session.commit()

    cheaper_total = Listing(
        title="Business Apartment",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=25000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, Kitchen",
        description="Comfort stay",
        is_active=True,
        owner_id=1,
    )
    expensive_total = Listing(
        title="Business Apartment Deluxe",
        city="Shymkent",
        district="Abay",
        property_type="apartment",
        nightly_price=50000,
        cleaning_fee=7000,
        service_fee_percent=12,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, Kitchen",
        description="Comfort stay",
        is_active=True,
        owner_id=1,
    )
    db_session.add_all([cheaper_total, expensive_total])
    db_session.commit()

    check_in = date.today() + timedelta(days=5)
    check_out = date.today() + timedelta(days=9)
    result = list_listings(
        city="Shymkent",
        q="business apartment",
        guests=2,
        check_in=check_in,
        check_out=check_out,
        min_price=None,
        max_price=None,
        sort_by="best_match",
        sort_order="desc",
        page=1,
        page_size=12,
        db=db_session,
    )

    assert result.total == 2
    assert result.items[0].title == "Business Apartment"


def test_chat_recommend_extracts_filters_and_returns_suggestions(db_session: Session):
    db_session.add(
        User(
            email="partner-chat@test.dev",
            hashed_password="x",
            full_name="Partner Chat",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Business Loft with Fast WiFi",
        city="Almaty",
        district="Bostandyk",
        property_type="apartment",
        nightly_price=42000,
        cleaning_fee=6000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, Kitchen, Desk",
        description="Good for work trip",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="Алматы, 2 гостя, до 45000, командировка, wifi",
        lang="ru",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.total_found == 0
    assert response.stage == "collect"
    assert response.filters.city == "Almaty"
    assert response.filters.guests == 2
    assert response.filters.max_price == 45000
    assert response.filters.trip_purpose == "business"
    assert response.suggestions == []
    assert "даты" in response.answer.lower()


def test_chat_recommend_converts_usd_budget(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-usd@test.dev",
            hashed_password="x",
            full_name="Partner Chat USD",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Solo Studio",
        city="Astana",
        district="Yesil",
        property_type="apartment",
        nightly_price=50000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=1,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Compact stay",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="Astana, 1 guest, up to 110",
        lang="en",
        currency="USD",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.max_price == 55000
    assert response.total_found == 0
    assert "check-in" in response.answer.lower() or "dates" in response.answer.lower()


def test_chat_recommend_uses_context_messages(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-context@test.dev",
            hashed_password="x",
            full_name="Partner Chat Context",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Center Stay with Parking",
        city="Shymkent",
        district="Al-Farabi",
        property_type="apartment",
        nightly_price=36000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="Parking, WiFi",
        description="Central location",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="покажи варианты",
        context_messages=["Шымкент", "2 гостя", "до 40000", "с парковкой"],
        lang="ru",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.total_found == 0
    assert response.filters.city == "Shymkent"
    assert response.filters.guests == 2
    assert response.filters.max_price == 40000
    assert response.filters.q == "parking"
    assert "даты" in response.answer.lower()


def test_chat_recommend_extracts_dates_and_applies_availability(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-dates@test.dev",
            hashed_password="x",
            full_name="Partner Chat Dates",
            role="partner",
        )
    )
    db_session.commit()

    blocked_listing = Listing(
        title="Blocked Loft",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=32000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Will be blocked",
        is_active=True,
        owner_id=1,
    )
    free_listing = Listing(
        title="Open Loft",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=33000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Available",
        is_active=True,
        owner_id=1,
    )
    db_session.add_all([blocked_listing, free_listing])
    db_session.commit()
    db_session.refresh(blocked_listing)
    db_session.refresh(free_listing)

    db_session.add(
        ListingBlock(
            listing_id=blocked_listing.id,
            check_in=date(2026, 5, 2),
            check_out=date(2026, 5, 4),
            reason="owner_block",
            created_by=1,
        )
    )
    db_session.commit()

    payload = ChatRecommendIn(
        message="Almaty, 2 guests, 2026-05-01 to 2026-05-05",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.check_in == "2026-05-01"
    assert response.filters.check_out == "2026-05-05"
    assert response.total_found == 1
    assert response.suggestions[0].title == "Open Loft"


def test_chat_recommend_filters_property_type_and_amenities(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    db_session.add(
        User(
            email="partner-chat-property@test.dev",
            hashed_password="x",
            full_name="Partner Chat Property",
            role="partner",
        )
    )
    db_session.commit()

    hotel = Listing(
        title="Palm Business Hotel",
        city="Dubai",
        district="Marina",
        property_type="hotel",
        nightly_price=180000,
        cleaning_fee=0,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.9,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, Parking, Pool",
        description="Hotel with parking and workspace",
        is_active=True,
        owner_id=1,
    )
    apartment = Listing(
        title="Marina Apartment",
        city="Dubai",
        district="Marina",
        property_type="apartment",
        nightly_price=130000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, Kitchen",
        description="Apartment near the promenade",
        is_active=True,
        owner_id=1,
    )
    db_session.add_all([hotel, apartment])
    db_session.commit()

    payload = ChatRecommendIn(
        message="Dubai hotel with parking, 2 guests, 2026-07-01 to 2026-07-03",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.city == "Dubai"
    assert response.filters.property_type == "hotel"
    assert response.filters.amenities == ["parking"]
    assert response.total_found == 1
    assert response.suggestions[0].title == "Palm Business Hotel"


def test_chat_recommend_returns_alternatives_when_dates_fully_blocked(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-alt@test.dev",
            hashed_password="x",
            full_name="Partner Chat Alt",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Always Busy Loft",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=35000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Busy listing",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    db_session.add(
        ListingBlock(
            listing_id=listing.id,
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 12),
            reason="owner_block",
            created_by=1,
        )
    )
    db_session.commit()

    payload = ChatRecommendIn(
        message="Almaty, 2 guests, 2026-06-03 to 2026-06-06",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.total_found == 0
    assert response.suggestions == []
    assert len(response.alternatives) == 1
    assert response.alternatives[0].title == "Always Busy Loft"
    assert response.alternatives[0].suggested_check_in >= "2026-06-12"

    strict_payload = ChatRecommendIn(
        message="Almaty, property type: hotel, 2 guests, 2026-06-03 to 2026-06-06",
        lang="ru",
        currency="KZT",
    )
    strict_response = chat_recommend(payload=strict_payload, db=db_session)

    assert strict_response.total_found == 0
    assert strict_response.suggestions == []
    assert len(strict_response.alternatives) == 1
    assert strict_response.alternatives[0].title == "Always Busy Loft"
    assert strict_response.alternatives[0].suggested_check_in >= "2026-06-12"
    assert "точного варианта нет" in strict_response.alternatives[0].unavailable_reason


def test_chat_recommend_uses_generic_query_when_no_structured_filters(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-generic@test.dev",
            hashed_password="x",
            full_name="Partner Chat Generic",
            role="partner",
        )
    )
    db_session.commit()

    with_view = Listing(
        title="Panorama Stay",
        city="Astana",
        district="Nura",
        property_type="apartment",
        nightly_price=36000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="City view, WiFi",
        description="Great city view",
        is_active=True,
        owner_id=1,
    )
    no_view = Listing(
        title="Compact Studio",
        city="Astana",
        district="Nura",
        property_type="apartment",
        nightly_price=30000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Simple place",
        is_active=True,
        owner_id=1,
    )
    db_session.add_all([with_view, no_view])
    db_session.commit()

    payload = ChatRecommendIn(
        message="need city view",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.q == "view"
    assert response.total_found == 0
    assert "city" in response.answer.lower()


def test_chat_recommend_collects_slots_from_context_progressively(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-progress@test.dev",
            hashed_password="x",
            full_name="Partner Chat Progress",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Context Filled Stay",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=38000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="Context flow test",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="and for 2 guests",
        context_messages=["Almaty", "2026-05-01 to 2026-05-05"],
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.city == "Almaty"
    assert response.filters.check_in == "2026-05-01"
    assert response.filters.check_out == "2026-05-05"
    assert response.filters.guests == 2
    assert response.stage in ("pricing", "search")
    assert response.selection_summary in ("Stage: pricing", "Stage: search")
    assert response.total_found == 1
    assert response.next_action is not None
    assert response.next_action.type == "start_booking"


def test_chat_recommend_parses_relative_date_tomorrow(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-relative@test.dev",
            hashed_password="x",
            full_name="Partner Chat Relative",
            role="partner",
        )
    )
    db_session.commit()

    payload = ChatRecommendIn(
        message="Almaty tomorrow, 2 guests",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    expected_check_in = (date.today() + timedelta(days=1)).isoformat()
    expected_check_out = (date.today() + timedelta(days=2)).isoformat()
    assert response.filters.check_in == expected_check_in
    assert response.filters.check_out == expected_check_out
    assert response.filters.guests == 2


def test_chat_recommend_parses_russian_natural_date_range(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-natural-ru@test.dev",
            hashed_password="x",
            full_name="Partner Chat Natural RU",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Natural Date Stay",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=39000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, parking",
        description="Natural date parsing test",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="найди варианты в алматы с 1 по 5 мая для 2 гостей до 50000",
        lang="ru",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.filters.city == "Almaty"
    assert response.filters.guests == 2
    assert response.filters.max_price == 50000
    assert response.filters.check_in is not None
    assert response.filters.check_out is not None
    assert response.total_found == 1
    assert "на какие даты" not in response.answer.lower()


def test_chat_recommend_keeps_filters_between_messages_with_session_id(db_session: Session):
    first = ChatRecommendIn(
        message="need apartment in almaty",
        lang="en",
        currency="KZT",
        session_id="chat_flow_12345",
    )
    first_response = chat_recommend(payload=first, db=db_session)

    assert first_response.filters.city == "Almaty"
    assert first_response.stage == "collect"
    assert first_response.session_id == "chat_flow_12345"

    second = ChatRecommendIn(
        message="from 2026-05-01 to 2026-05-03",
        lang="en",
        currency="KZT",
        session_id="chat_flow_12345",
    )
    second_response = chat_recommend(payload=second, db=db_session)

    assert second_response.filters.city == "Almaty"
    assert second_response.filters.check_in == "2026-05-01"
    assert second_response.filters.check_out == "2026-05-03"
    assert second_response.stage == "collect"
    assert second_response.session_id == "chat_flow_12345"
    assert "How many guests" in second_response.answer


def test_chat_recommend_persists_session_filters_in_db(db_session: Session):
    payload = ChatRecommendIn(
        message="almaty 2 guests",
        lang="en",
        currency="KZT",
        session_id="chat_db_12345",
    )
    response = chat_recommend(payload=payload, db=db_session)

    row = db_session.get(ChatSessionState, "chat_db_12345")
    assert row is not None
    assert "\"city\": \"Almaty\"" in row.filters_json

    second = ChatRecommendIn(
        message="show options",
        lang="en",
        currency="KZT",
        session_id="chat_db_12345",
    )
    second_response = chat_recommend(payload=second, db=db_session)
    assert second_response.filters.city == "Almaty"


def test_chat_recommend_persists_booking_state_in_session(db_session: Session):
    first = ChatRecommendIn(
        message="almaty 2 guests",
        lang="en",
        currency="KZT",
        session_id="chat_booking_12345",
        booking_state={
            "listing_id": 99,
            "title": "Demo Stay",
            "check_in": "2026-05-01",
            "check_out": "2026-05-03",
            "guests": 2,
            "guest_name": "John Doe",
            "step": "email",
        },
    )
    first_response = chat_recommend(payload=first, db=db_session)
    assert first_response.booking_state is not None
    assert first_response.booking_state.guest_name == "John Doe"

    row = db_session.get(ChatSessionState, "chat_booking_12345")
    assert row is not None
    assert "\"guest_name\": \"John Doe\"" in row.booking_state_json

    second = ChatRecommendIn(
        message="show options",
        lang="en",
        currency="KZT",
        session_id="chat_booking_12345",
    )
    second_response = chat_recommend(payload=second, db=db_session)
    assert second_response.booking_state is not None
    assert second_response.booking_state.guest_name == "John Doe"
    assert second_response.booking_state.title == "Demo Stay"


def test_chat_recommend_handoff_for_refund_complaint(db_session: Session):
    payload = ChatRecommendIn(
        message="Хочу возврат, есть жалоба по оплате",
        lang="ru",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.total_found == 0
    assert response.stage == "handoff"
    assert response.selection_summary == "Этап: передача менеджеру"
    assert "живому специалисту" in response.answer.lower()
    ticket = db_session.scalar(select(SupportTicket).order_by(SupportTicket.id.desc()))
    assert ticket is not None
    assert ticket.status == "open"
    assert ticket.source == "ai_chat"
    assert ticket.priority == "high"
    assert ticket.topic == "refund"


def test_chat_recommend_booking_intent_returns_go_checkout_action(db_session: Session):
    db_session.add(
        User(
            email="partner-chat-checkout@test.dev",
            hashed_password="x",
            full_name="Partner Chat Checkout",
            role="partner",
        )
    )
    db_session.commit()

    listing = Listing(
        title="Checkout Ready Stay",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=42000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi, parking",
        description="Checkout flow",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()

    payload = ChatRecommendIn(
        message="book in almaty 2026-05-01 to 2026-05-04 for 2 guests",
        lang="en",
        currency="KZT",
    )
    response = chat_recommend(payload=payload, db=db_session)

    assert response.stage == "booking"
    assert response.selection_summary == "Stage: booking"
    assert response.next_action is not None
    assert response.next_action.type == "go_checkout"
    assert response.next_action.listing_id == listing.id
    assert response.next_action.check_in == "2026-05-01"
    assert response.next_action.check_out == "2026-05-04"
    assert response.next_action.guests == 2


def test_partner_funnel_aggregates_only_owned_listing_events(db_session: Session):
    partner = User(
        email="partner-funnel@test.dev",
        hashed_password="x",
        full_name="Partner Funnel",
        role="partner",
    )
    outsider = User(
        email="partner-funnel-outsider@test.dev",
        hashed_password="x",
        full_name="Partner Outsider",
        role="partner",
    )
    db_session.add_all([partner, outsider])
    db_session.commit()
    db_session.refresh(partner)
    db_session.refresh(outsider)

    owned_listing = Listing(
        title="Owned Funnel Listing",
        city="Almaty",
        district="Medeu",
        property_type="apartment",
        nightly_price=40000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="owned",
        is_active=True,
        owner_id=partner.id,
    )
    outsider_listing = Listing(
        title="Outsider Listing",
        city="Astana",
        district="Nura",
        property_type="apartment",
        nightly_price=30000,
        cleaning_fee=4000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.5,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="outsider",
        is_active=True,
        owner_id=outsider.id,
    )
    db_session.add_all([owned_listing, outsider_listing])
    db_session.commit()
    db_session.refresh(owned_listing)
    db_session.refresh(outsider_listing)

    db_session.add_all(
        [
            AnalyticsEvent(event_name="chat_open", listing_id=owned_listing.id, metadata_json="{}", lang="ru", currency="USD"),
            AnalyticsEvent(event_name="filters_collected", listing_id=owned_listing.id, metadata_json="{}", lang="ru", currency="USD"),
            AnalyticsEvent(event_name="checkout_clicked", listing_id=owned_listing.id, metadata_json="{}", lang="ru", currency="USD"),
            AnalyticsEvent(event_name="paid", listing_id=owned_listing.id, metadata_json="{}", lang="ru", currency="USD"),
            AnalyticsEvent(event_name="chat_open", listing_id=outsider_listing.id, metadata_json="{}", lang="ru", currency="USD"),
            AnalyticsEvent(event_name="paid", listing_id=outsider_listing.id, metadata_json="{}", lang="ru", currency="USD"),
        ]
    )
    db_session.commit()

    out = get_partner_funnel(period_days=30, listing_id=None, db=db_session, user=partner)
    by_name = {step.event_name: step for step in out.steps}

    assert by_name["chat_open"].count == 1
    assert by_name["filters_collected"].count == 1
    assert by_name["checkout_clicked"].count == 1
    assert by_name["paid"].count == 1
    assert by_name["payment_started"].count == 0
    assert by_name["paid"].conversion_from_open == 100.0


def test_support_tickets_list_and_update_status(db_session: Session):
    user = User(
        email="partner-support@test.dev",
        hashed_password="x",
        full_name="Partner Support",
        role="partner",
    )
    db_session.add(user)
    db_session.add(
        SupportTicket(
            source="ai_chat",
            status="open",
            priority="high",
            topic="payment",
            lang="ru",
            message="Нужен оператор",
            city="Almaty",
            guests=2,
        )
    )
    db_session.commit()

    rows = list_support_tickets(status=None, priority="high", db=db_session, _=user)
    assert len(rows) == 1
    assert rows[0].status == "open"
    assert rows[0].priority == "high"

    updated = update_support_ticket_status(
        ticket_id=rows[0].id,
        payload=SupportTicketStatusUpdate(status="in_progress"),
        db=db_session,
        _=user,
    )
    assert updated.status == "in_progress"


def test_create_room_service_order_for_active_stay(db_session: Session):
    listing = Listing(
        title="Hotel with menu",
        city="Almaty",
        district="Medeu",
        property_type="hotel",
        nightly_price=40000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="stay@test.dev",
        guest_phone="+77001230001",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=2),
        guests=2,
        tariff_plan="smart",
        total_price=120000,
        status="checked_in",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    burger = MenuItem(listing_id=listing.id, name="Burger", description="Classic", price=7500, category="main", is_active=True)
    fries = MenuItem(listing_id=listing.id, name="Fries", description="Potato", price=3000, category="sides", is_active=True)
    db_session.add_all([burger, fries])
    db_session.commit()
    db_session.refresh(burger)
    db_session.refresh(fries)

    order = create_room_service_order(
        payload=RoomServiceOrderCreate(
            reservation_id=reservation.id,
            guest_email="stay@test.dev",
            access_token=create_reservation_access_token(reservation.id, "stay@test.dev"),
            items=[
                {"menu_item_id": burger.id, "quantity": 2, "note": ""},
                {"menu_item_id": fries.id, "quantity": 1, "note": ""},
            ],
            delivery_note="room 301",
        ),
        db=db_session,
    )

    assert order.status == "submitted"
    assert order.total_price == 18000
    assert len(order.items) == 2


def test_create_room_service_order_rejects_draft_reservation(db_session: Session):
    listing = Listing(
        title="Hotel draft guard",
        city="Almaty",
        district="Medeu",
        property_type="hotel",
        nightly_price=40000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.6,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="draft-stay@test.dev",
        guest_phone="+77001230001",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=2),
        guests=2,
        tariff_plan="smart",
        total_price=120000,
        status="draft",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    burger = MenuItem(listing_id=listing.id, name="Burger", description="Classic", price=7500, category="main", is_active=True)
    db_session.add(burger)
    db_session.commit()
    db_session.refresh(burger)

    with pytest.raises(HTTPException) as exc:
        create_room_service_order(
            payload=RoomServiceOrderCreate(
                reservation_id=reservation.id,
                guest_email="draft-stay@test.dev",
                access_token=create_reservation_access_token(reservation.id, "draft-stay@test.dev"),
                items=[{"menu_item_id": burger.id, "quantity": 1, "note": ""}],
                delivery_note="",
            ),
            db=db_session,
        )
    assert exc.value.status_code == 409


def test_create_restaurant_booking_for_active_stay(db_session: Session):
    listing = Listing(
        title="Hotel restaurant",
        city="Almaty",
        district="Medeu",
        property_type="hotel",
        nightly_price=45000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="restaurant@test.dev",
        guest_phone="+77001230002",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=2),
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="checked_in",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    restaurant = Restaurant(
        listing_id=listing.id,
        name="Sky Lounge",
        cuisine="European",
        description="Panoramic view",
        open_from="12:00",
        open_to="23:00",
        avg_check_kzt=12000,
        is_active=True,
    )
    db_session.add(restaurant)
    db_session.commit()
    db_session.refresh(restaurant)

    booking = create_restaurant_booking(
        payload=RestaurantTableBookingCreate(
            reservation_id=reservation.id,
            restaurant_id=restaurant.id,
            guest_email="restaurant@test.dev",
            access_token=create_reservation_access_token(reservation.id, "restaurant@test.dev"),
            booking_date=date.today() + timedelta(days=1),
            booking_time="19:30",
            guests=2,
            note="Window table",
        ),
        db=db_session,
    )

    assert booking.status == "submitted"
    assert booking.restaurant_name == "Sky Lounge"
    assert booking.guests == 2


def test_in_stay_ai_concierge_fallback_suggests_menu_item(db_session: Session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    listing = Listing(
        title="AI hotel menu",
        city="Dubai",
        district="Marina",
        property_type="hotel",
        nightly_price=90000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.8,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="ai-menu@test.dev",
        guest_phone="+77001230003",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=2),
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="checked_in",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    burger = MenuItem(
        listing_id=listing.id,
        name="Visual Burger",
        description="Signature burger",
        price=7900,
        category="main",
        is_active=True,
    )
    db_session.add(burger)
    db_session.commit()
    db_session.refresh(burger)

    response = in_stay_concierge(
        payload=AiConciergeMessageIn(
            listing_id=listing.id,
            reservation_id=reservation.id,
            guest_email="ai-menu@test.dev",
            access_token=create_reservation_access_token(reservation.id, "ai-menu@test.dev"),
            message="хочу бургер",
            lang="ru",
            currency="KZT",
        ),
        db=db_session,
    )

    assert response.mode == "fallback"
    assert "Visual Burger" in response.answer
    assert response.action is not None
    assert response.action.type == "add_item"
    assert response.action.item_id == burger.id
    assert response.context.menu_count == 1


def test_in_stay_ai_concierge_fallback_builds_table_action(db_session: Session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    listing = Listing(
        title="AI hotel restaurant",
        city="Dubai",
        district="Palm",
        property_type="hotel",
        nightly_price=120000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.9,
        max_guests=4,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="ai-table@test.dev",
        guest_phone="+77001230004",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=3),
        guests=2,
        tariff_plan="smart",
        total_price=140000,
        status="checked_in",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    restaurant = Restaurant(
        listing_id=listing.id,
        name="Sky Lounge",
        cuisine="European",
        description="Panoramic view",
        open_from="12:00",
        open_to="23:00",
        avg_check_kzt=12000,
        is_active=True,
    )
    db_session.add(restaurant)
    db_session.commit()
    db_session.refresh(restaurant)

    response = in_stay_concierge(
        payload=AiConciergeMessageIn(
            listing_id=listing.id,
            reservation_id=reservation.id,
            guest_email="ai-table@test.dev",
            access_token=create_reservation_access_token(reservation.id, "ai-table@test.dev"),
            message="забронируй столик в Sky Lounge завтра в 20:15 на 3 гостя",
            lang="ru",
            currency="KZT",
        ),
        db=db_session,
    )

    assert response.mode == "fallback"
    assert response.action is not None
    assert response.action.type == "book_table"
    assert response.action.restaurant_id == restaurant.id
    assert response.action.booking_time == "20:15"
    assert response.action.guests == 3


def test_in_stay_ai_concierge_requires_reservation_token(db_session: Session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    listing = Listing(
        title="AI secure hotel",
        city="Dubai",
        district="Downtown",
        property_type="hotel",
        nightly_price=100000,
        cleaning_fee=5000,
        service_fee_percent=10,
        cancellation_policy="flexible",
        rating=4.7,
        max_guests=2,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi",
        description="desc",
        is_active=True,
        owner_id=1,
    )
    db_session.add(listing)
    db_session.commit()
    db_session.refresh(listing)

    reservation = Reservation(
        listing_id=listing.id,
        guest_name="Guest",
        guest_email="ai-secure@test.dev",
        guest_phone="+77001230005",
        check_in=date.today(),
        check_out=date.today() + timedelta(days=2),
        guests=2,
        tariff_plan="smart",
        total_price=100000,
        status="checked_in",
    )
    db_session.add(reservation)
    db_session.commit()
    db_session.refresh(reservation)

    with pytest.raises(HTTPException) as exc:
        in_stay_concierge(
            payload=AiConciergeMessageIn(
                listing_id=listing.id,
                reservation_id=reservation.id,
                guest_email="ai-secure@test.dev",
                access_token="invalid-access-token",
                message="покажи меню",
                lang="ru",
                currency="KZT",
            ),
            db=db_session,
        )
    assert exc.value.status_code == 403
