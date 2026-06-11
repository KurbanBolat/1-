from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import select

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.listing import Listing
from app.models.menu_item import MenuItem
from app.models.restaurant import Restaurant


RESTAURANTS = [
    {
        "name": "Skyline Grill",
        "cuisine": "International",
        "description": "Sea-view dining with grilled mains, salads and late dinner service.",
        "open_from": "07:30",
        "open_to": "23:30",
        "avg_check_kzt": 18000,
        "is_active": True,
    },
    {
        "name": "Palm Lounge",
        "cuisine": "Mediterranean",
        "description": "Casual lounge for breakfast, coffee, mezze and evening table bookings.",
        "open_from": "08:00",
        "open_to": "00:00",
        "avg_check_kzt": 14000,
        "is_active": True,
    },
    {
        "name": "Marina Table",
        "cuisine": "Seafood",
        "description": "Light seafood, terrace seating and concierge-assisted reservations.",
        "open_from": "12:00",
        "open_to": "23:00",
        "avg_check_kzt": 22000,
        "is_active": True,
    },
]

MENU_ITEMS = [
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
]


def upsert_restaurants(db, listing: Listing) -> int:
    added = 0
    existing_names = set(
        db.scalars(select(Restaurant.name).where(Restaurant.listing_id == listing.id)).all()
    )
    for payload in RESTAURANTS:
        if payload["name"] in existing_names:
            continue
        db.add(Restaurant(listing_id=listing.id, **payload))
        added += 1
    return added


def upsert_menu(db, listing: Listing) -> int:
    added = 0
    existing_names = set(db.scalars(select(MenuItem.name).where(MenuItem.listing_id == listing.id)).all())
    for payload in MENU_ITEMS:
        if payload["name"] in existing_names:
            continue
        db.add(MenuItem(listing_id=listing.id, **payload))
        added += 1
    return added


def main() -> None:
    with SessionLocal() as db:
        listings = list(
            db.scalars(
                select(Listing)
                .where(Listing.city == "Dubai", Listing.is_active.is_(True), Listing.owner_id.is_not(None))
                .order_by(Listing.nightly_price.asc(), Listing.id.asc())
                .limit(12)
            ).all()
        )
        restaurant_count = 0
        menu_count = 0
        for listing in listings:
            restaurant_count += upsert_restaurants(db, listing)
            menu_count += upsert_menu(db, listing)
        db.commit()
        print(f"OK: dubai_listings={len(listings)} restaurants_added={restaurant_count} menu_items_added={menu_count}")


if __name__ == "__main__":
    main()
