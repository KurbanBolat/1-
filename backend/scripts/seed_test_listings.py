from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from pathlib import Path
import sys

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal
from app.models.listing import Listing
from app.models.user import User

SEED_TAG = "[seed:test-global-v1]"
SEED_PARTNER_EMAIL = "seed.partner@findapart.test"


@dataclass(frozen=True)
class CitySeed:
    city: str
    country: str
    districts: tuple[str, ...]


CITY_POOL: tuple[CitySeed, ...] = (
    CitySeed("Almaty", "Kazakhstan", ("Medeu", "Bostandyk", "Almaly", "Auezov")),
    CitySeed("Astana", "Kazakhstan", ("Esil", "Saryarka", "Almaty", "Nura")),
    CitySeed("Shymkent", "Kazakhstan", ("Abay", "Enbekshi", "Al-Farabi", "Karatau")),
    CitySeed("Tashkent", "Uzbekistan", ("Mirzo-Ulugbek", "Yakkasaray", "Chilanzar")),
    CitySeed("Bishkek", "Kyrgyzstan", ("Sverdlov", "Lenin", "Oktyabr")),
    CitySeed("Dubai", "UAE", ("Downtown", "Marina", "Business Bay", "JBR")),
    CitySeed("Istanbul", "Turkey", ("Beyoglu", "Sisli", "Kadikoy", "Fatih")),
    CitySeed("Antalya", "Turkey", ("Lara", "Konyaalti", "Kaleici")),
    CitySeed("Tbilisi", "Georgia", ("Vake", "Saburtalo", "Old Tbilisi")),
    CitySeed("Baku", "Azerbaijan", ("Sabayil", "Nasimi", "Yasamal")),
    CitySeed("Prague", "Czechia", ("Prague 1", "Prague 2", "Prague 5")),
    CitySeed("Budapest", "Hungary", ("District V", "District VI", "District VII")),
    CitySeed("Berlin", "Germany", ("Mitte", "Kreuzberg", "Prenzlauer Berg")),
    CitySeed("Munich", "Germany", ("Altstadt", "Schwabing", "Ludwigsvorstadt")),
    CitySeed("Barcelona", "Spain", ("Eixample", "Gothic Quarter", "Gracia")),
    CitySeed("Madrid", "Spain", ("Centro", "Salamanca", "Chamberi")),
    CitySeed("Rome", "Italy", ("Centro Storico", "Trastevere", "Monti")),
    CitySeed("Milan", "Italy", ("Brera", "Navigli", "Porta Nuova")),
    CitySeed("Paris", "France", ("Le Marais", "Latin Quarter", "Montmartre")),
    CitySeed("Vienna", "Austria", ("Innere Stadt", "Leopoldstadt", "Neubau")),
    CitySeed("Warsaw", "Poland", ("Srodmiescie", "Mokotow", "Wola")),
    CitySeed("Amsterdam", "Netherlands", ("Centrum", "Jordaan", "De Pijp")),
    CitySeed("Bangkok", "Thailand", ("Sukhumvit", "Silom", "Ratchathewi")),
    CitySeed("Kuala Lumpur", "Malaysia", ("Bukit Bintang", "KLCC", "Chinatown")),
    CitySeed("Seoul", "South Korea", ("Gangnam", "Hongdae", "Myeongdong")),
    CitySeed("Tokyo", "Japan", ("Shinjuku", "Shibuya", "Ginza")),
    CitySeed("Singapore", "Singapore", ("Marina Bay", "Orchard", "Bugis")),
    CitySeed("London", "United Kingdom", ("Soho", "Canary Wharf", "Kensington")),
    CitySeed("New York", "USA", ("Manhattan", "Brooklyn", "Queens")),
    CitySeed("Toronto", "Canada", ("Downtown", "North York", "Scarborough")),
)

ADJECTIVES = (
    "Skyline",
    "Central",
    "Riverside",
    "Urban",
    "Grand",
    "Comfort",
    "Aurora",
    "Emerald",
    "Golden",
    "Nova",
    "Summit",
    "Vista",
)
PROPERTY_KINDS = ("Hotel", "Apartments", "Suites", "Residence", "Loft", "Studios")
AMENITY_BUNDLES = (
    "WiFi,Kitchen,Air conditioning,Washer",
    "WiFi,Breakfast,Parking,Gym",
    "WiFi,Kitchen,Self check-in,Workspace",
    "WiFi,Pool,Spa,Parking",
    "WiFi,Airport shuttle,Breakfast,24h reception",
    "WiFi,Family rooms,Kitchen,Parking",
)
CANCELLATION = ("flexible", "moderate", "strict")


def ensure_partner(db) -> User:
    partner = db.query(User).filter(User.email == SEED_PARTNER_EMAIL).first()
    if partner:
        return partner

    partner = User(
        email=SEED_PARTNER_EMAIL,
        full_name="Seed Partner",
        hashed_password="seed_not_for_login",
        role="partner",
        email_verified=True,
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return partner


def ensure_user_columns(db) -> None:
    rows = db.execute(text("PRAGMA table_info(users)")).fetchall()
    existing = {str(row[1]) for row in rows}
    if "email_verified" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"))
    if "token_version" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"))
    db.commit()


def build_listing_payload(i: int, city_seed: CitySeed) -> dict:
    adjective = ADJECTIVES[i % len(ADJECTIVES)]
    kind = PROPERTY_KINDS[i % len(PROPERTY_KINDS)]
    district = city_seed.districts[i % len(city_seed.districts)]

    base_price = 15000 + (i % 18) * 3500
    if city_seed.city in {"London", "New York", "Tokyo", "Singapore", "Paris"}:
        base_price = int(base_price * 2.2)
    elif city_seed.city in {"Dubai", "Amsterdam", "Seoul", "Rome", "Barcelona"}:
        base_price = int(base_price * 1.7)

    return {
        "title": f"{adjective} {kind} {city_seed.city} #{i + 1}",
        "city": city_seed.city,
        "district": district,
        "property_type": "hotel" if i % 3 == 0 else "apartment",
        "nightly_price": float(base_price),
        "cleaning_fee": float(6000 + (i % 5) * 1500),
        "service_fee_percent": float(8 + (i % 6)),
        "cancellation_policy": CANCELLATION[i % len(CANCELLATION)],
        "rating": round(4.1 + (i % 10) * 0.08, 1),
        "max_guests": 2 + (i % 5),
        "bedrooms": 1 + (i % 3),
        "bathrooms": 1 + (i % 2),
        "amenities": AMENITY_BUNDLES[i % len(AMENITY_BUNDLES)],
        "description": (
            f"{SEED_TAG} Comfortable stay in {city_seed.city}, {city_seed.country}. "
            f"Transparent pricing, flexible booking flow, and traveler-focused amenities."
        ),
        "is_active": True,
    }


def seed_listings(target_count: int, reset: bool) -> None:
    random.seed(42)
    db = SessionLocal()
    try:
        ensure_user_columns(db)
        owner = ensure_partner(db)

        if reset:
            db.query(Listing).filter(Listing.description.like(f"%{SEED_TAG}%")).delete(synchronize_session=False)
            db.commit()

        existing = db.query(Listing).filter(Listing.description.like(f"%{SEED_TAG}%")).count()
        to_create = max(0, target_count - existing)

        for n in range(to_create):
            city_seed = CITY_POOL[(existing + n) % len(CITY_POOL)]
            payload = build_listing_payload(existing + n, city_seed)
            listing = Listing(**payload, owner_id=owner.id)
            db.add(listing)

        db.commit()

        final_count = db.query(Listing).filter(Listing.description.like(f"%{SEED_TAG}%")).count()
        print(f"OK: seeded_global_test_listings={final_count} (added={to_create}, reset={reset})")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed 100-150 global test listings for StayPilot.")
    parser.add_argument("--count", type=int, default=120, help="Target number of seeded listings (recommended 100-150).")
    parser.add_argument("--reset", action="store_true", help="Delete previous seeded listings before seeding.")
    args = parser.parse_args()

    count = max(1, min(args.count, 500))
    seed_listings(target_count=count, reset=args.reset)


if __name__ == "__main__":
    main()
