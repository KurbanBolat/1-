from datetime import date, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import Base
from app.models import (  # noqa: F401 - register all model tables in metadata.
    Listing,
    ListingBlock,
    ListingPhoto,
    MenuItem,
    Restaurant,
    RestaurantTableBooking,
    Reservation,
    ReservationPayment,
    RoomServiceOrder,
    RoomType,
)
from app.services.room_inventory_service import build_room_availability
from scripts.seed_demo_data import DEMO_TAG, seed_demo_data


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    return TestingSessionLocal()


def test_seed_demo_data_is_idempotent_and_bookable():
    db = make_session()
    try:
        today = date(2026, 6, 12)
        first = seed_demo_data(db, today=today)
        second = seed_demo_data(db, today=today)

        assert first == second
        assert first["listings"] == 4
        assert first["room_types"] == 12
        assert first["restaurants"] == 12
        assert first["menu_items"] == 20
        assert first["reservations"] == 8
        assert first["room_service_orders"] == 1
        assert first["table_bookings"] == 1

        listings = list(db.scalars(select(Listing).where(Listing.description.like(f"%{DEMO_TAG}%"))).all())
        assert len(listings) == 4
        assert {listing.title for listing in listings} == {
            "Address Beach Resort",
            "Jumeirah Al Naseem",
            "Taj Dubai",
            "SLS Dubai Hotel & Residences",
        }

        address = db.scalar(select(Listing).where(Listing.title == "Address Beach Resort"))
        assert address is not None
        assert db.scalar(select(RoomType).where(RoomType.listing_id == address.id).limit(1)) is not None
        assert len(list(db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == address.id)).all())) == 4
        assert len(list(db.scalars(select(Restaurant).where(Restaurant.listing_id == address.id)).all())) == 3
        assert len(list(db.scalars(select(MenuItem).where(MenuItem.listing_id == address.id)).all())) == 5
        assert db.scalar(select(ListingBlock).where(ListingBlock.listing_id == address.id)) is not None

        availability = build_room_availability(
            db,
            listing=address,
            from_date=today + timedelta(days=1),
            to_date=today + timedelta(days=45),
            guests=2,
        )
        assert len(availability) == 3
        assert all(room["available_windows"] for room in availability)
        assert max(room["available_count"] for room in availability) > 0

        reservation = db.scalar(select(Reservation).where(Reservation.guest_email == "demo.guest.1@staypilot.example"))
        assert reservation is not None
        assert reservation.status == "checked_in"
        assert db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation.id)).payment_status == "paid"
        assert db.scalar(select(RoomServiceOrder).where(RoomServiceOrder.reservation_id == reservation.id)) is not None
        assert db.scalar(select(RestaurantTableBooking).where(RestaurantTableBooking.reservation_id == reservation.id)) is not None

        seed_demo_data(db, today=today, reset=True)
        assert len(list(db.scalars(select(Listing).where(Listing.description.like(f"%{DEMO_TAG}%"))).all())) == 4
        assert len(list(db.scalars(select(Reservation).where(Reservation.guest_email.like("demo.%@staypilot.example"))).all())) == 8
    finally:
        db.close()
