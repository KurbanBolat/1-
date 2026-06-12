from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.time import utc_now
from app.db.session import Base, SessionLocal
from app.models import (  # noqa: F401 - import models so Base.metadata knows every demo table.
    Listing,
    ListingBlock,
    ListingPhoto,
    MenuItem,
    Restaurant,
    RestaurantBookingEvent,
    RestaurantTableBooking,
    Reservation,
    ReservationPayment,
    RoomServiceOrder,
    RoomServiceOrderItem,
    RoomType,
    User,
)

DEMO_TAG = "[seed:demo-showcase-v1]"
DEMO_PARTNER_EMAIL = "demo.partner@staypilot.local"


@dataclass(frozen=True)
class DemoListingSeed:
    title: str
    district: str
    nightly_price: float
    rating: float
    max_guests: int
    bedrooms: int
    bathrooms: int
    amenities: str
    description: str
    cover_url: str
    gallery_urls: tuple[str, ...]


DEMO_LISTINGS: tuple[DemoListingSeed, ...] = (
    DemoListingSeed(
        title="Address Beach Resort",
        district="JBR",
        nightly_price=72_000,
        rating=5.0,
        max_guests=4,
        bedrooms=2,
        bathrooms=2,
        amenities="WiFi,Sea view,Pool,Spa,Breakfast,Airport shuttle,Family rooms,24h reception",
        description="Beachfront Dubai resort with sea-view rooms, pool decks and strong family service.",
        cover_url="https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1400&q=84",
        gallery_urls=(
            "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=82",
        ),
    ),
    DemoListingSeed(
        title="Jumeirah Al Naseem",
        district="Madinat Jumeirah",
        nightly_price=76_000,
        rating=5.0,
        max_guests=5,
        bedrooms=2,
        bathrooms=2,
        amenities="WiFi,Beach access,Pool,Spa,Breakfast,Kids club,Restaurants,Concierge",
        description="Premium family-friendly resort near Madinat Jumeirah with restaurants and beach access.",
        cover_url="https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1400&q=84",
        gallery_urls=(
            "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=82",
        ),
    ),
    DemoListingSeed(
        title="Taj Dubai",
        district="Business Bay",
        nightly_price=78_000,
        rating=5.0,
        max_guests=3,
        bedrooms=1,
        bathrooms=1,
        amenities="WiFi,Burj Khalifa view,Business center,Pool,Spa,Breakfast,Room service,Valet parking",
        description="Business Bay hotel with skyline views, room service and easy access to Downtown Dubai.",
        cover_url="https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1400&q=84",
        gallery_urls=(
            "https://images.unsplash.com/photo-1594563703937-fdc640497dcd?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1590490359683-658d3d23f972?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1559599238-308793637427?auto=format&fit=crop&w=1200&q=82",
        ),
    ),
    DemoListingSeed(
        title="SLS Dubai Hotel & Residences",
        district="Business Bay",
        nightly_price=74_000,
        rating=5.0,
        max_guests=4,
        bedrooms=2,
        bathrooms=2,
        amenities="WiFi,Sky pool,Restaurants,Workspace,Gym,Spa,Parking,24h reception",
        description="Design-led Dubai hotel residence with skyline pool, dining and work-friendly rooms.",
        cover_url="https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=1400&q=84",
        gallery_urls=(
            "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=1200&q=82",
            "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=82",
        ),
    ),
)

ROOM_TYPE_TEMPLATES = (
    {
        "name": "Deluxe Sea View",
        "description": "Bright king room with balcony, sea or skyline view and breakfast-ready setup.",
        "price_multiplier": 1.0,
        "total_inventory": 8,
        "max_guest_delta": 0,
        "bedroom_delta": 0,
        "bathroom_delta": 0,
        "amenities_suffix": "Balcony,King bed,Desk",
        "sort_order": 0,
    },
    {
        "name": "Premier Club Room",
        "description": "Upgraded room for couples or business guests with lounge-friendly amenities.",
        "price_multiplier": 1.16,
        "total_inventory": 5,
        "max_guest_delta": 1,
        "bedroom_delta": 0,
        "bathroom_delta": 0,
        "amenities_suffix": "Club access,Premium minibar,Late checkout",
        "sort_order": 1,
    },
    {
        "name": "Family Suite",
        "description": "Large suite with separate sleeping area, sofa bed and in-stay service priority.",
        "price_multiplier": 1.34,
        "total_inventory": 2,
        "max_guest_delta": 2,
        "bedroom_delta": 1,
        "bathroom_delta": 1,
        "amenities_suffix": "Living room,Sofa bed,Priority concierge",
        "sort_order": 2,
    },
)

RESTAURANTS = (
    {
        "name": "Skyline Grill",
        "cuisine": "International",
        "description": "Sea-view dining with grilled mains, salads and late dinner service.",
        "open_from": "07:30",
        "open_to": "23:30",
        "avg_check_kzt": 18_000,
        "is_active": True,
    },
    {
        "name": "Palm Lounge",
        "cuisine": "Mediterranean",
        "description": "Casual lounge for breakfast, coffee, mezze and evening table bookings.",
        "open_from": "08:00",
        "open_to": "00:00",
        "avg_check_kzt": 14_000,
        "is_active": True,
    },
    {
        "name": "Marina Table",
        "cuisine": "Seafood",
        "description": "Light seafood, terrace seating and concierge-assisted reservations.",
        "open_from": "12:00",
        "open_to": "23:00",
        "avg_check_kzt": 22_000,
        "is_active": True,
    },
)

MENU_ITEMS = (
    {
        "name": "Wagyu Burger",
        "description": "Burger with fries and house sauce.",
        "price": 6900,
        "category": "main",
        "sort_order": 10,
        "is_active": True,
    },
    {
        "name": "Margherita Pizza",
        "description": "Tomato, mozzarella and basil.",
        "price": 5900,
        "category": "main",
        "sort_order": 20,
        "is_active": True,
    },
    {
        "name": "Caesar Salad",
        "description": "Romaine, chicken, parmesan and croutons.",
        "price": 4700,
        "category": "salad",
        "sort_order": 30,
        "is_active": True,
    },
    {
        "name": "Club Sandwich",
        "description": "Turkey, egg, tomato and potato wedges.",
        "price": 5200,
        "category": "snack",
        "sort_order": 40,
        "is_active": True,
    },
    {
        "name": "Fresh Orange Juice",
        "description": "Cold-pressed juice served chilled.",
        "price": 2400,
        "category": "drink",
        "sort_order": 50,
        "is_active": True,
    },
)


def _date_from_offset(today: date, offset: int) -> date:
    return today + timedelta(days=offset)


def _ensure_sqlite_user_columns(db: Session) -> None:
    if db.get_bind().dialect.name != "sqlite":
        return
    rows = db.execute(text("PRAGMA table_info(users)")).fetchall()
    existing = {str(row[1]) for row in rows}
    if "email_verified" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"))
    if "token_version" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"))
    db.commit()


def ensure_demo_partner(db: Session) -> User:
    partner = db.scalar(select(User).where(User.email == DEMO_PARTNER_EMAIL))
    if partner is None:
        partner = User(
            email=DEMO_PARTNER_EMAIL,
            full_name="StayPilot Demo Partner",
            hashed_password="demo_partner_password_is_not_public",
            role="partner",
            email_verified=True,
        )
        db.add(partner)
        db.commit()
        db.refresh(partner)
        return partner

    partner.full_name = "StayPilot Demo Partner"
    partner.role = "partner"
    partner.email_verified = True
    db.commit()
    db.refresh(partner)
    return partner


def _upsert_listing(db: Session, owner: User, seed: DemoListingSeed) -> Listing:
    listing = db.scalar(select(Listing).where(Listing.title == seed.title, Listing.city == "Dubai"))
    payload = {
        "city": "Dubai",
        "district": seed.district,
        "property_type": "hotel",
        "nightly_price": seed.nightly_price,
        "cleaning_fee": 9000,
        "service_fee_percent": 9,
        "cancellation_policy": "flexible",
        "rating": seed.rating,
        "max_guests": seed.max_guests,
        "bedrooms": seed.bedrooms,
        "bathrooms": seed.bathrooms,
        "amenities": seed.amenities,
        "description": f"{DEMO_TAG} {seed.description}",
        "is_active": True,
        "owner_id": owner.id,
    }
    if listing is None:
        listing = Listing(title=seed.title, **payload)
        db.add(listing)
        db.commit()
        db.refresh(listing)
        return listing

    for key, value in payload.items():
        setattr(listing, key, value)
    db.commit()
    db.refresh(listing)
    return listing


def _upsert_photos(db: Session, listing: Listing, seed: DemoListingSeed) -> int:
    urls = (seed.cover_url, *seed.gallery_urls)
    changed = 0
    existing = {
        photo.file_url: photo
        for photo in db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing.id)).all()
    }
    for index, url in enumerate(urls):
        photo = existing.get(url)
        payload = {
            "file_path": f"seed://demo/{listing.id}/{index}",
            "file_url": url,
            "is_cover": index == 0,
            "sort_order": index,
        }
        if photo is None:
            db.add(ListingPhoto(listing_id=listing.id, **payload))
            changed += 1
            continue
        for key, value in payload.items():
            setattr(photo, key, value)
        changed += 1
    db.commit()
    return changed


def _upsert_room_types(db: Session, listing: Listing) -> list[RoomType]:
    existing = {
        room.name: room
        for room in db.scalars(select(RoomType).where(RoomType.listing_id == listing.id)).all()
    }
    rooms: list[RoomType] = []
    for template in ROOM_TYPE_TEMPLATES:
        name = str(template["name"])
        room = existing.get(name)
        amenities = ",".join([listing.amenities, str(template["amenities_suffix"])])
        payload = {
            "description": str(template["description"]),
            "nightly_price": round(float(listing.nightly_price) * float(template["price_multiplier"]), 2),
            "total_inventory": int(template["total_inventory"]),
            "max_guests": min(12, max(1, int(listing.max_guests) + int(template["max_guest_delta"]))),
            "bedrooms": max(0, int(listing.bedrooms) + int(template["bedroom_delta"])),
            "bathrooms": max(1, int(listing.bathrooms) + int(template["bathroom_delta"])),
            "amenities": amenities,
            "is_active": True,
            "sort_order": int(template["sort_order"]),
        }
        if room is None:
            room = RoomType(listing_id=listing.id, name=name, **payload)
            db.add(room)
            db.flush()
        else:
            for key, value in payload.items():
                setattr(room, key, value)
        rooms.append(room)
    db.commit()
    for room in rooms:
        db.refresh(room)
    return sorted(rooms, key=lambda item: (item.sort_order, item.id))


def _upsert_restaurants(db: Session, listing: Listing) -> list[Restaurant]:
    existing = {
        restaurant.name: restaurant
        for restaurant in db.scalars(select(Restaurant).where(Restaurant.listing_id == listing.id)).all()
    }
    rows: list[Restaurant] = []
    for payload in RESTAURANTS:
        restaurant = existing.get(str(payload["name"]))
        if restaurant is None:
            restaurant = Restaurant(listing_id=listing.id, **payload)
            db.add(restaurant)
            db.flush()
        else:
            for key, value in payload.items():
                setattr(restaurant, key, value)
        rows.append(restaurant)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def _upsert_menu(db: Session, listing: Listing) -> list[MenuItem]:
    existing = {
        item.name: item
        for item in db.scalars(select(MenuItem).where(MenuItem.listing_id == listing.id)).all()
    }
    rows: list[MenuItem] = []
    for payload in MENU_ITEMS:
        item = existing.get(str(payload["name"]))
        if item is None:
            item = MenuItem(listing_id=listing.id, **payload)
            db.add(item)
            db.flush()
        else:
            for key, value in payload.items():
                setattr(item, key, value)
        rows.append(item)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def _upsert_block(db: Session, listing: Listing, room_type: RoomType, today: date, offset: int, nights: int) -> ListingBlock:
    reason = f"{DEMO_TAG} housekeeping hold {room_type.name}"
    block = db.scalar(
        select(ListingBlock).where(
            ListingBlock.listing_id == listing.id,
            ListingBlock.room_type_id == room_type.id,
            ListingBlock.reason == reason,
        )
    )
    payload = {
        "check_in": _date_from_offset(today, offset),
        "check_out": _date_from_offset(today, offset + nights),
        "blocked_inventory": 1,
        "created_by": listing.owner_id,
    }
    if block is None:
        block = ListingBlock(listing_id=listing.id, room_type_id=room_type.id, reason=reason, **payload)
        db.add(block)
    else:
        for key, value in payload.items():
            setattr(block, key, value)
    db.commit()
    db.refresh(block)
    return block


def _upsert_reservation(
    db: Session,
    *,
    listing: Listing,
    room_type: RoomType,
    guest_name: str,
    guest_email: str,
    today: date,
    check_in_offset: int,
    nights: int,
    guests: int,
    tariff_plan: str,
    status: str,
    payment_status: str,
    payment_method: str | None,
) -> Reservation:
    normalized_email = guest_email.lower()
    reservation = db.scalar(
        select(Reservation).where(
            Reservation.listing_id == listing.id,
            Reservation.guest_email == normalized_email,
        )
    )
    check_in = _date_from_offset(today, check_in_offset)
    check_out = _date_from_offset(today, check_in_offset + nights)
    total_price = round((float(room_type.nightly_price) * nights) + float(listing.cleaning_fee), 2)
    total_price = round(total_price + (total_price * float(listing.service_fee_percent) / 100), 2)
    payload = {
        "room_type_id": room_type.id,
        "guest_name": guest_name,
        "guest_email": normalized_email,
        "guest_phone": "+971501112233",
        "check_in": check_in,
        "check_out": check_out,
        "guests": guests,
        "tariff_plan": tariff_plan,
        "total_price": total_price,
        "status": status,
    }
    if reservation is None:
        reservation = Reservation(listing_id=listing.id, **payload)
        db.add(reservation)
        db.flush()
    else:
        for key, value in payload.items():
            setattr(reservation, key, value)
    db.commit()
    db.refresh(reservation)

    payment = db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation.id))
    payment_payload = {
        "payment_status": payment_status,
        "payment_method": payment_method,
        "amount": total_price,
        "currency": "KZT",
        "attempted_at": utc_now() if payment_status != "pending" else None,
    }
    if payment is None:
        db.add(ReservationPayment(reservation_id=reservation.id, **payment_payload))
    else:
        for key, value in payment_payload.items():
            setattr(payment, key, value)
    db.commit()
    return reservation


def _upsert_room_service_order(db: Session, reservation: Reservation, menu_items: list[MenuItem]) -> RoomServiceOrder:
    order = db.scalar(
        select(RoomServiceOrder).where(
            RoomServiceOrder.reservation_id == reservation.id,
            RoomServiceOrder.delivery_note.like(f"%{DEMO_TAG}%"),
        )
    )
    burger = next((item for item in menu_items if item.name == "Wagyu Burger"), menu_items[0])
    juice = next((item for item in menu_items if item.name == "Fresh Orange Juice"), menu_items[-1])
    total = float(burger.price) + float(juice.price)
    payload = {
        "listing_id": reservation.listing_id,
        "guest_email": reservation.guest_email,
        "guest_name": reservation.guest_name,
        "status": "accepted",
        "total_price": total,
        "currency": "KZT",
        "delivery_note": f"{DEMO_TAG} Deliver to room 1804 after check-in.",
    }
    if order is None:
        order = RoomServiceOrder(reservation_id=reservation.id, **payload)
        db.add(order)
        db.flush()
    else:
        for key, value in payload.items():
            setattr(order, key, value)
        db.execute(delete(RoomServiceOrderItem).where(RoomServiceOrderItem.order_id == order.id))

    db.add(
        RoomServiceOrderItem(
            order_id=order.id,
            menu_item_id=burger.id,
            item_name=burger.name,
            unit_price=burger.price,
            quantity=1,
            line_total=burger.price,
            note="medium well",
        )
    )
    db.add(
        RoomServiceOrderItem(
            order_id=order.id,
            menu_item_id=juice.id,
            item_name=juice.name,
            unit_price=juice.price,
            quantity=1,
            line_total=juice.price,
            note="no ice",
        )
    )
    db.commit()
    db.refresh(order)
    return order


def _upsert_table_booking(
    db: Session,
    reservation: Reservation,
    restaurant: Restaurant,
    today: date,
) -> RestaurantTableBooking:
    note = f"{DEMO_TAG} Window table for buyer demo."
    booking = db.scalar(
        select(RestaurantTableBooking).where(
            RestaurantTableBooking.reservation_id == reservation.id,
            RestaurantTableBooking.restaurant_id == restaurant.id,
            RestaurantTableBooking.note == note,
        )
    )
    payload = {
        "listing_id": reservation.listing_id,
        "guest_email": reservation.guest_email,
        "guest_name": reservation.guest_name,
        "booking_date": _date_from_offset(today, 1),
        "booking_time": "20:15",
        "guests": 2,
        "status": "confirmed",
    }
    if booking is None:
        booking = RestaurantTableBooking(restaurant_id=restaurant.id, reservation_id=reservation.id, note=note, **payload)
        db.add(booking)
        db.flush()
    else:
        for key, value in payload.items():
            setattr(booking, key, value)

    event = db.scalar(
        select(RestaurantBookingEvent).where(
            RestaurantBookingEvent.booking_id == booking.id,
            RestaurantBookingEvent.event_type == "demo_seed_confirmed",
        )
    )
    event_payload = {
        "listing_id": reservation.listing_id,
        "reservation_id": reservation.id,
        "restaurant_id": restaurant.id,
        "guest_email": reservation.guest_email,
        "status": "confirmed",
        "message": f"{DEMO_TAG} Table booking confirmed for demo.",
        "actor_role": "system",
    }
    if event is None:
        db.add(RestaurantBookingEvent(booking_id=booking.id, event_type="demo_seed_confirmed", **event_payload))
    else:
        for key, value in event_payload.items():
            setattr(event, key, value)
    db.commit()
    db.refresh(booking)
    return booking


def reset_demo_data(db: Session) -> None:
    listings = list(db.scalars(select(Listing).where(Listing.description.like(f"%{DEMO_TAG}%"))).all())
    listing_ids = [listing.id for listing in listings]
    if not listing_ids:
        return
    reservation_ids = list(
        db.scalars(select(Reservation.id).where(Reservation.listing_id.in_(listing_ids))).all()
    )
    order_ids = list(
        db.scalars(select(RoomServiceOrder.id).where(RoomServiceOrder.reservation_id.in_(reservation_ids))).all()
    )
    booking_ids = list(
        db.scalars(select(RestaurantTableBooking.id).where(RestaurantTableBooking.reservation_id.in_(reservation_ids))).all()
    )
    if order_ids:
        db.execute(delete(RoomServiceOrderItem).where(RoomServiceOrderItem.order_id.in_(order_ids)))
    if booking_ids:
        db.execute(delete(RestaurantBookingEvent).where(RestaurantBookingEvent.booking_id.in_(booking_ids)))
    if reservation_ids:
        db.execute(delete(RoomServiceOrder).where(RoomServiceOrder.reservation_id.in_(reservation_ids)))
        db.execute(delete(RestaurantTableBooking).where(RestaurantTableBooking.reservation_id.in_(reservation_ids)))
        db.execute(delete(ReservationPayment).where(ReservationPayment.reservation_id.in_(reservation_ids)))
        db.execute(delete(Reservation).where(Reservation.id.in_(reservation_ids)))
    db.execute(delete(ListingBlock).where(ListingBlock.listing_id.in_(listing_ids)))
    db.execute(delete(ListingPhoto).where(ListingPhoto.listing_id.in_(listing_ids)))
    db.execute(delete(MenuItem).where(MenuItem.listing_id.in_(listing_ids)))
    db.execute(delete(Restaurant).where(Restaurant.listing_id.in_(listing_ids)))
    db.execute(delete(RoomType).where(RoomType.listing_id.in_(listing_ids)))
    db.execute(delete(Listing).where(Listing.id.in_(listing_ids)))
    db.commit()


def seed_demo_data(db: Session, *, today: date | None = None, reset: bool = False) -> dict[str, int]:
    today = today or date.today()
    if reset:
        reset_demo_data(db)
    _ensure_sqlite_user_columns(db)
    owner = ensure_demo_partner(db)

    listings: list[Listing] = []
    room_types_count = 0
    restaurant_count = 0
    menu_count = 0
    reservation_count = 0
    block_count = 0
    photo_count = 0

    first_reservation: Reservation | None = None
    first_restaurants: list[Restaurant] = []
    first_menu_items: list[MenuItem] = []

    for index, seed in enumerate(DEMO_LISTINGS):
        listing = _upsert_listing(db, owner, seed)
        listings.append(listing)
        photo_count += _upsert_photos(db, listing, seed)
        room_types = _upsert_room_types(db, listing)
        room_types_count += len(room_types)
        restaurants = _upsert_restaurants(db, listing)
        restaurant_count += len(restaurants)
        menu_items = _upsert_menu(db, listing)
        menu_count += len(menu_items)
        if len(room_types) >= 3:
            _upsert_block(db, listing, room_types[2], today, offset=9 + index, nights=2)
            block_count += 1

        reservation_specs = (
            {
                "guest_name": f"Demo Guest {index + 1}",
                "guest_email": f"demo.guest.{index + 1}@staypilot.example",
                "check_in_offset": max(0, index - 1),
                "nights": 3,
                "guests": 2,
                "tariff_plan": "smart",
                "status": "checked_in" if index == 0 else "confirmed",
                "payment_status": "paid",
                "payment_method": "card",
            },
            {
                "guest_name": f"Demo Pending {index + 1}",
                "guest_email": f"demo.pending.{index + 1}@staypilot.example",
                "check_in_offset": 5 + index,
                "nights": 2,
                "guests": 2,
                "tariff_plan": "flex",
                "status": "pending_payment",
                "payment_status": "pending",
                "payment_method": None,
            },
        )
        for spec in reservation_specs:
            reservation = _upsert_reservation(
                db,
                listing=listing,
                room_type=room_types[0],
                today=today,
                **spec,
            )
            reservation_count += 1
            if first_reservation is None:
                first_reservation = reservation
                first_restaurants = restaurants
                first_menu_items = menu_items

    order_count = 0
    table_booking_count = 0
    if first_reservation is not None and first_restaurants and first_menu_items:
        _upsert_room_service_order(db, first_reservation, first_menu_items)
        order_count = 1
        _upsert_table_booking(db, first_reservation, first_restaurants[0], today)
        table_booking_count = 1

    return {
        "listings": len(listings),
        "room_types": room_types_count,
        "photos": photo_count,
        "restaurants": restaurant_count,
        "menu_items": menu_count,
        "reservations": reservation_count,
        "blocks": block_count,
        "room_service_orders": order_count,
        "table_bookings": table_booking_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed polished StayPilot Dubai demo data.")
    parser.add_argument("--reset", action="store_true", help="Delete previous demo showcase rows before seeding.")
    parser.add_argument("--today", type=date.fromisoformat, default=None, help="Override rolling demo date, YYYY-MM-DD.")
    args = parser.parse_args()

    with SessionLocal() as db:
        Base.metadata.create_all(bind=db.get_bind())
        summary = seed_demo_data(db, today=args.today, reset=args.reset)
    print("OK: " + " ".join(f"{key}={value}" for key, value in summary.items()))


if __name__ == "__main__":
    main()
