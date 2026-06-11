from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal
from app.models.listing import Listing
from app.models.restaurant import Restaurant

SEED_TAG_PATTERN = re.compile(r"\[seed:[^\]]+\]\s*", re.IGNORECASE)
TEST_WORD_PATTERN = re.compile(r"(test|e2e|bulkdelete)", re.IGNORECASE)
TRAILING_ID_PATTERN = re.compile(r"\s+\d{6,}$")


def clean_listing_title(title: str, city: str, listing_id: int) -> str:
    base = (title or "").strip()
    if not base or TEST_WORD_PATTERN.search(base):
        return f"{city} Residence #{listing_id}"
    return base


def clean_listing_description(description: str, city: str) -> str:
    text = SEED_TAG_PATTERN.sub("", (description or "")).strip()
    low = text.lower()
    if not text or low in {"desc", "test", "description"} or "qa flows" in low:
        return f"Comfortable stay option in {city} with clear price and booking terms."
    return text


def clean_restaurant_name(name: str) -> str:
    normalized = TRAILING_ID_PATTERN.sub("", (name or "").strip())
    if not normalized or TEST_WORD_PATTERN.search(normalized):
        return "Signature Restaurant"
    return normalized


def main() -> None:
    db = SessionLocal()
    try:
        changed_listings = 0
        changed_restaurants = 0

        listings = list(db.query(Listing).all())
        for row in listings:
            next_title = clean_listing_title(row.title, row.city, row.id)
            next_description = clean_listing_description(row.description, row.city)
            if row.title != next_title:
                row.title = next_title
                changed_listings += 1
            if row.description != next_description:
                row.description = next_description
                changed_listings += 1

        restaurants = list(db.query(Restaurant).all())
        for row in restaurants:
            next_name = clean_restaurant_name(row.name)
            if row.name != next_name:
                row.name = next_name
                changed_restaurants += 1

        db.commit()
        print(f"OK: listings_updated={changed_listings}, restaurants_updated={changed_restaurants}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
