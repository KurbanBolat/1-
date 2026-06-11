from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.reservation import Reservation
from app.models.room_type import RoomType
from app.services.reservation_lifecycle import BLOCKING_RESERVATION_STATUSES


def _date_range(start: date, end: date):
    current = start
    while current < end:
        yield current
        current += timedelta(days=1)


def _clamp_range(start: date, end: date, from_date: date, to_date: date) -> tuple[date, date]:
    return max(start, from_date), min(end, to_date)


def _seed_room_type_payloads(listing: Listing) -> list[dict]:
    base_guests = max(1, int(listing.max_guests or 2))
    base_bedrooms = max(1, int(listing.bedrooms or 1))
    base_bathrooms = max(1, int(listing.bathrooms or 1))
    amenities = listing.amenities or "WiFi"
    base_price = float(listing.nightly_price)
    property_label = (listing.property_type or "room").replace("_", " ").title()

    return [
        {
            "name": f"{property_label} Standard",
            "description": "Core room category for this stay.",
            "nightly_price": base_price,
            "total_inventory": 4,
            "max_guests": base_guests,
            "bedrooms": base_bedrooms,
            "bathrooms": base_bathrooms,
            "amenities": amenities,
            "sort_order": 0,
        },
        {
            "name": f"{property_label} Superior",
            "description": "Higher floor or upgraded room category.",
            "nightly_price": round(base_price * 1.14, 2),
            "total_inventory": 2,
            "max_guests": min(12, base_guests + 1),
            "bedrooms": base_bedrooms,
            "bathrooms": base_bathrooms,
            "amenities": amenities,
            "sort_order": 1,
        },
        {
            "name": f"{property_label} Suite",
            "description": "Largest room category for guests who want more space.",
            "nightly_price": round(base_price * 1.32, 2),
            "total_inventory": 1,
            "max_guests": min(12, base_guests + 2),
            "bedrooms": base_bedrooms + 1,
            "bathrooms": base_bathrooms,
            "amenities": amenities,
            "sort_order": 2,
        },
    ]


def ensure_room_types_for_listing(db: Session, listing: Listing) -> list[RoomType]:
    existing = list(
        db.scalars(
            select(RoomType)
            .where(RoomType.listing_id == listing.id)
            .order_by(RoomType.sort_order.asc(), RoomType.id.asc())
        ).all()
    )
    if existing:
        return existing

    for payload in _seed_room_type_payloads(listing):
        db.add(RoomType(listing_id=listing.id, is_active=True, **payload))
    db.commit()
    return list(
        db.scalars(
            select(RoomType)
            .where(RoomType.listing_id == listing.id)
            .order_by(RoomType.sort_order.asc(), RoomType.id.asc())
        ).all()
    )


def backfill_room_types(db: Session) -> None:
    listings = list(db.scalars(select(Listing)).all())
    changed = False
    for listing in listings:
        exists = db.scalar(select(RoomType.id).where(RoomType.listing_id == listing.id).limit(1))
        if exists:
            continue
        for payload in _seed_room_type_payloads(listing):
            db.add(RoomType(listing_id=listing.id, is_active=True, **payload))
            changed = True
    if changed:
        db.commit()


def list_room_types(db: Session, listing: Listing, guests: int | None = None) -> list[RoomType]:
    room_types = [room for room in ensure_room_types_for_listing(db, listing) if room.is_active]
    if guests is not None:
        room_types = [room for room in room_types if room.max_guests >= guests]
    return sorted(room_types, key=lambda item: (item.sort_order, item.id))


def get_room_type_or_404(db: Session, listing_id: int, room_type_id: int) -> RoomType | None:
    return db.scalar(
        select(RoomType).where(
            and_(
                RoomType.id == room_type_id,
                RoomType.listing_id == listing_id,
                RoomType.is_active.is_(True),
            )
        )
    )


def _relevant_reservations(db: Session, listing_id: int, from_date: date, to_date: date) -> list[Reservation]:
    return list(
        db.scalars(
            select(Reservation)
            .where(
                and_(
                    Reservation.listing_id == listing_id,
                    Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                    Reservation.check_in < to_date,
                    Reservation.check_out > from_date,
                )
            )
            .order_by(Reservation.check_in.asc())
        ).all()
    )


def _relevant_blocks(db: Session, listing_id: int, from_date: date, to_date: date) -> list[ListingBlock]:
    return list(
        db.scalars(
            select(ListingBlock)
            .where(
                and_(
                    ListingBlock.listing_id == listing_id,
                    ListingBlock.check_in < to_date,
                    ListingBlock.check_out > from_date,
                )
            )
            .order_by(ListingBlock.check_in.asc())
        ).all()
    )


def _room_type_windows(
    room_type: RoomType,
    *,
    primary_room_type_id: int,
    reservations: list[Reservation],
    blocks: list[ListingBlock],
    from_date: date,
    to_date: date,
    exclude_reservation_id: int | None = None,
) -> list[dict]:
    total_inventory = max(0, int(room_type.total_inventory or 0))
    day_available = {day: total_inventory for day in _date_range(from_date, to_date)}

    for block in blocks:
        block_start, block_end = _clamp_range(block.check_in, block.check_out, from_date, to_date)
        if block.room_type_id is not None and block.room_type_id != room_type.id:
            continue
        block_amount = total_inventory
        if block.room_type_id == room_type.id:
            block_amount = int(block.blocked_inventory or total_inventory)
        for day in _date_range(block_start, block_end):
            day_available[day] = max(0, day_available.get(day, total_inventory) - block_amount)

    for reservation in reservations:
        if exclude_reservation_id is not None and reservation.id == exclude_reservation_id:
            continue
        applies = reservation.room_type_id == room_type.id or (
            reservation.room_type_id is None and room_type.id == primary_room_type_id
        )
        if not applies:
            continue
        res_start, res_end = _clamp_range(reservation.check_in, reservation.check_out, from_date, to_date)
        for day in _date_range(res_start, res_end):
            day_available[day] = max(0, day_available.get(day, total_inventory) - 1)

    windows: list[dict] = []
    current_start: date | None = None
    current_count = 0
    current = from_date
    while current < to_date:
        available = day_available.get(current, 0)
        if available > 0:
            if current_start is None:
                current_start = current
                current_count = available
            else:
                current_count = min(current_count, available)
        elif current_start is not None:
            nights = (current - current_start).days
            windows.append(
                {
                    "check_in": current_start,
                    "check_out": current,
                    "nights": nights,
                    "available_count": current_count,
                }
            )
            current_start = None
            current_count = 0
        current += timedelta(days=1)

    if current_start is not None:
        nights = (to_date - current_start).days
        windows.append(
            {
                "check_in": current_start,
                "check_out": to_date,
                "nights": nights,
                "available_count": current_count,
            }
        )

    return windows


def room_type_available_count(
    db: Session,
    *,
    listing: Listing,
    room_type: RoomType,
    check_in: date,
    check_out: date,
    exclude_reservation_id: int | None = None,
) -> int:
    room_types = list_room_types(db, listing)
    primary_room_type_id = room_types[0].id if room_types else room_type.id
    reservations = _relevant_reservations(db, listing.id, check_in, check_out)
    blocks = _relevant_blocks(db, listing.id, check_in, check_out)
    windows = _room_type_windows(
        room_type,
        primary_room_type_id=primary_room_type_id,
        reservations=reservations,
        blocks=blocks,
        from_date=check_in,
        to_date=check_out,
        exclude_reservation_id=exclude_reservation_id,
    )
    if not windows:
        return 0
    if windows[0]["check_in"] == check_in and windows[0]["check_out"] == check_out:
        return int(windows[0]["available_count"])
    return 0


def build_room_availability(
    db: Session,
    *,
    listing: Listing,
    from_date: date,
    to_date: date,
    guests: int | None = None,
) -> list[dict]:
    room_types = list_room_types(db, listing, guests=guests)
    primary_room_type_id = list_room_types(db, listing)[0].id
    reservations = _relevant_reservations(db, listing.id, from_date, to_date)
    blocks = _relevant_blocks(db, listing.id, from_date, to_date)
    rows: list[dict] = []

    for room_type in room_types:
        windows = _room_type_windows(
            room_type,
            primary_room_type_id=primary_room_type_id,
            reservations=reservations,
            blocks=blocks,
            from_date=from_date,
            to_date=to_date,
        )
        rows.append(
            {
                "id": room_type.id,
                "listing_id": room_type.listing_id,
                "name": room_type.name,
                "description": room_type.description,
                "nightly_price": room_type.nightly_price,
                "total_inventory": room_type.total_inventory,
                "max_guests": room_type.max_guests,
                "bedrooms": room_type.bedrooms,
                "bathrooms": room_type.bathrooms,
                "amenities": room_type.amenities,
                "is_active": room_type.is_active,
                "sort_order": room_type.sort_order,
                "available_windows": windows,
                "available_count": max((int(window["available_count"]) for window in windows), default=0),
            }
        )
    return rows
