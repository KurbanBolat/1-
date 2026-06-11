from datetime import date
from pathlib import Path
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_partner
from app.db.session import get_db
from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.listing_photo import ListingPhoto
from app.models.reservation import Reservation
from app.models.room_type import RoomType
from app.models.user import User
from app.schemas.listing_photo import ListingPhotoOut, ListingPhotoReorderIn
from app.schemas.listing_block import ListingBlockCreate, ListingBlockOut
from app.schemas.listing import (
    ListingBulkStatusIn,
    ListingCreate,
    ListingListOut,
    ListingOut,
    ListingRoomAvailabilityOut,
    QuoteOut,
    RoomTypeCreate,
    RoomTypeOut,
    RoomTypeUpdate,
)
from app.services.listing_service import get_cover_photo_map, get_owned_listing_or_404, get_public_listing_or_404, has_conflict
from app.services.photo_service import delete_photo, list_photos, reorder_photos, set_cover_photo, upload_photo
from app.services.pricing import overlap, quote_price, resolve_tariff
from app.services.quote_lock_service import create_quote_lock
from app.services.room_inventory_service import build_room_availability, ensure_room_types_for_listing, get_room_type_or_404, room_type_available_count
from app.services.booking_rules import validate_booking_window
from app.services.reservation_lifecycle import BLOCKING_RESERVATION_STATUSES

router = APIRouter(prefix="/listings", tags=["listings"])

SEED_TAG_PATTERN = re.compile(r"\[seed:[^\]]+\]\s*", re.IGNORECASE)
TEST_WORD_PATTERN = re.compile(r"(test|e2e|bulkdelete)", re.IGNORECASE)
TEST_DESCRIPTION_PATTERN = re.compile(
    r"(test|e2e|qa\s*flow|bulk\s*status|bulkdelete|partner\s*cabinet|updated\s*listing|block\s*flow)",
    re.IGNORECASE,
)


def _clean_public_title(title: str, city: str, listing_id: int) -> str:
    base = (title or "").strip()
    if not base:
        return f"{city} Residence #{listing_id}"
    if TEST_WORD_PATTERN.search(base):
        return f"{city} Residence #{listing_id}"
    return base


def _clean_public_description(description: str, city: str) -> str:
    text = SEED_TAG_PATTERN.sub("", (description or "")).strip()
    low = text.lower()
    if not text or low in {"desc", "test", "description"}:
        return f"Comfortable stay option in {city} with clear price and booking terms."
    if TEST_DESCRIPTION_PATTERN.search(low):
        return f"Comfortable stay option in {city} with clear price and booking terms."
    return text


def _public_listing_out(row: Listing, cover_photo_url: str | None) -> ListingOut:
    payload = ListingOut.model_validate(row).model_dump()
    payload["title"] = _clean_public_title(payload["title"], payload["city"], payload["id"])
    payload["description"] = _clean_public_description(payload["description"], payload["city"])
    payload["cover_photo_url"] = cover_photo_url
    return ListingOut.model_validate(payload)


@router.get("", response_model=ListingListOut)
def list_listings(
    city: str | None = Query(default=None),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    property_type: str | None = Query(default=None, min_length=2, max_length=40),
    min_bedrooms: int | None = Query(default=None, ge=0, le=20),
    min_rating: float | None = Query(default=None, ge=0, le=5),
    amenities: list[str] | None = Query(default=None),
    guests: int | None = Query(default=None, ge=1, le=12),
    check_in: date | None = Query(default=None),
    check_out: date | None = Query(default=None),
    min_price: float | None = Query(default=None, gt=0),
    max_price: float | None = Query(default=None, gt=0),
    trip_purpose: str | None = Query(default=None, pattern="^(family|business|solo|couple)$"),
    sort_by: str = Query(default="best_match", pattern="^(best_match|recommended|best_value|price|rating|newest)$"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=60),
    db: Session = Depends(get_db),
):
    filters = [Listing.is_active.is_(True), Listing.owner_id.is_not(None)]

    if city:
        filters.append(Listing.city == city)
    if isinstance(property_type, str) and property_type.strip():
        filters.append(Listing.property_type.ilike(f"%{property_type.strip()}%"))
    if isinstance(min_bedrooms, int):
        filters.append(Listing.bedrooms >= min_bedrooms)
    if isinstance(min_rating, (int, float)):
        filters.append(Listing.rating >= min_rating)
    if guests:
        filters.append(Listing.max_guests >= guests)
    if min_price:
        filters.append(Listing.nightly_price >= min_price)
    if max_price:
        filters.append(Listing.nightly_price <= max_price)
    if q:
        term = f"%{q.strip()}%"
        filters.append(
            or_(
                Listing.title.ilike(term),
                Listing.district.ilike(term),
                Listing.description.ilike(term),
                Listing.amenities.ilike(term),
            )
        )
    if isinstance(amenities, str) and amenities.strip():
        amenity_tokens = [part.strip() for part in amenities.split(",") if part.strip()]
        for token in amenity_tokens[:8]:
            filters.append(Listing.amenities.ilike(f"%{token}%"))
    elif isinstance(amenities, (list, tuple)) and amenities:
        amenity_tokens: list[str] = []
        for raw in amenities:
            amenity_tokens.extend([part.strip() for part in raw.split(",") if part.strip()])
        for token in amenity_tokens[:8]:
            filters.append(Listing.amenities.ilike(f"%{token}%"))

    if check_in and check_out and check_out <= check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in")

    where_clause = and_(*filters)
    nights_for_search = (check_out - check_in).days if check_in and check_out else 0

    if sort_by in {"best_match", "recommended"}:
        # Relevance score tuned for booking-style discovery:
        # rating quality + text relevance + city/guest fit + affordability + freshness.
        text_boost = literal(0.0)
        if q:
            text_term = f"%{q.strip()}%"
            text_boost = case(
                (Listing.title.ilike(text_term), 28.0),
                (Listing.district.ilike(text_term), 18.0),
                (Listing.amenities.ilike(text_term), 12.0),
                (Listing.description.ilike(text_term), 8.0),
                else_=0.0,
            )

        city_boost = case((Listing.city == city, 14.0), else_=0.0) if city else literal(0.0)
        guest_fit = (
            case(
                (Listing.max_guests >= guests, 6.0 - (func.abs(Listing.max_guests - guests) * 0.4)),
                else_=0.0,
            )
            if guests
            else literal(0.0)
        )
        if nights_for_search > 0:
            subtotal_expr = Listing.nightly_price * nights_for_search
            service_expr = subtotal_expr * (Listing.service_fee_percent / 100.0)
            total_trip_expr = subtotal_expr + Listing.cleaning_fee + service_expr
            # Keep value in a compact range while rewarding cheaper total trip price.
            price_affordability = case(
                (total_trip_expr <= 450000, (450000.0 - total_trip_expr) / 30000.0),
                else_=0.0,
            )
        else:
            price_affordability = case(
                (Listing.nightly_price <= 120000, (120000.0 - Listing.nightly_price) / 12000.0),
                else_=0.0,
            )
        purpose_boost = literal(0.0)
        if trip_purpose == "family":
            purpose_boost = (
                case((Listing.max_guests >= 4, 6.0), else_=0.0)
                + case((Listing.bedrooms >= 2, 4.0), else_=0.0)
                + case((Listing.bathrooms >= 1, 2.0), else_=0.0)
            )
        elif trip_purpose == "business":
            purpose_boost = (
                case((Listing.district.ilike("%center%"), 4.0), else_=0.0)
                + case((Listing.amenities.ilike("%wifi%"), 5.0), else_=0.0)
                + case((Listing.rating >= 4.5, 3.0), else_=0.0)
            )
        elif trip_purpose == "solo":
            purpose_boost = (
                case((Listing.max_guests <= 2, 5.0), else_=0.0)
                + case((Listing.nightly_price <= 35000, 4.0), else_=0.0)
            )
        elif trip_purpose == "couple":
            purpose_boost = (
                case((Listing.max_guests >= 2, 4.0), else_=0.0)
                + case((Listing.bedrooms >= 1, 3.0), else_=0.0)
                + case((Listing.rating >= 4.4, 2.0), else_=0.0)
            )
        freshness = Listing.id / 100000.0
        score = (
            (Listing.rating * 8.0)
            + text_boost
            + city_boost
            + guest_fit
            + price_affordability
            + purpose_boost
            + freshness
        )
        sort_col = score
    elif sort_by == "best_value":
        if nights_for_search > 0:
            subtotal_expr = Listing.nightly_price * nights_for_search
            service_expr = subtotal_expr * (Listing.service_fee_percent / 100.0)
            total_trip_expr = subtotal_expr + Listing.cleaning_fee + service_expr
            safe_total = case((total_trip_expr <= 0, 1.0), else_=total_trip_expr)
        else:
            safe_total = case((Listing.nightly_price <= 0, 1.0), else_=Listing.nightly_price)
        guests_cap = case((Listing.max_guests <= 6, Listing.max_guests), else_=6)
        value_score = (Listing.rating * 10000.0) / safe_total + (guests_cap * 0.04)
        sort_col = value_score
    elif sort_by == "price":
        sort_col = Listing.nightly_price
    elif sort_by == "rating":
        sort_col = Listing.rating
    elif sort_by == "newest":
        sort_col = Listing.id

    ordering = sort_col.asc() if sort_order == "asc" else sort_col.desc()

    stmt = select(Listing).where(where_clause)

    if check_in and check_out:
        reservation_conflicts = select(Reservation.listing_id).where(
            and_(
                Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                Reservation.check_in < check_out,
                Reservation.check_out > check_in,
                Reservation.room_type_id.is_(None),
            )
        )
        block_conflicts = select(ListingBlock.listing_id).where(
            and_(
                ListingBlock.check_in < check_out,
                ListingBlock.check_out > check_in,
                ListingBlock.room_type_id.is_(None),
            )
        )
        stmt = stmt.where(Listing.id.not_in(reservation_conflicts)).where(Listing.id.not_in(block_conflicts))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(ordering).offset((page - 1) * page_size).limit(page_size)).all())
    cover_map = get_cover_photo_map(db, rows)
    items = [_public_listing_out(row, cover_map.get(row.id)) for row in rows]

    return ListingListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/mine", response_model=list[ListingOut])
def list_my_listings(
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = select(Listing)
    if user.role != "admin":
        stmt = stmt.where(Listing.owner_id == user.id)
    stmt = stmt.order_by(Listing.id.desc())
    rows = list(db.scalars(stmt).all())
    cover_map = get_cover_photo_map(db, rows)
    return [_public_listing_out(row, cover_map.get(row.id)) for row in rows]


@router.get("/{listing_id}/blocks", response_model=list[ListingBlockOut])
def list_blocks(
    listing_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")

    stmt = select(ListingBlock).where(ListingBlock.listing_id == listing_id).order_by(ListingBlock.check_in.asc())
    return list(db.scalars(stmt).all())


@router.post("/{listing_id}/blocks", response_model=ListingBlockOut, status_code=201)
def create_block(
    listing_id: int,
    payload: ListingBlockCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")
    if payload.check_out <= payload.check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in")

    room_type: RoomType | None = None
    blocked_inventory: int | None = None
    if payload.room_type_id is not None:
        room_type = db.get(RoomType, payload.room_type_id)
        if not room_type or room_type.listing_id != listing_id:
            raise HTTPException(status_code=404, detail="Room type not found")
        blocked_inventory = payload.blocked_inventory or 1
        if blocked_inventory > room_type.total_inventory:
            raise HTTPException(status_code=400, detail="Blocked inventory exceeds room type inventory")
        available_count = room_type_available_count(
            db,
            listing=listing,
            room_type=room_type,
            check_in=payload.check_in,
            check_out=payload.check_out,
        )
        if available_count < blocked_inventory:
            raise HTTPException(status_code=409, detail="Not enough available rooms for this block")
    else:
        reservation_conflict = db.scalar(
            select(Reservation.id).where(
                and_(
                    Reservation.listing_id == listing_id,
                    Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                    Reservation.check_in < payload.check_out,
                    Reservation.check_out > payload.check_in,
                )
            )
        )
        if reservation_conflict is not None:
            raise HTTPException(status_code=409, detail="Block overlaps existing reservation")

        block_conflict = db.scalar(
            select(ListingBlock.id).where(
                and_(
                    ListingBlock.listing_id == listing_id,
                    ListingBlock.check_in < payload.check_out,
                    ListingBlock.check_out > payload.check_in,
                )
            )
        )
        if block_conflict is not None:
            raise HTTPException(status_code=409, detail="Block overlaps existing blocked range")

    block = ListingBlock(
        listing_id=listing_id,
        room_type_id=room_type.id if room_type else None,
        check_in=payload.check_in,
        check_out=payload.check_out,
        blocked_inventory=blocked_inventory,
        reason=payload.reason.strip(),
        created_by=user.id,
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/{listing_id}/blocks/{block_id}", status_code=204)
def delete_block(
    listing_id: int,
    block_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")

    block = db.get(ListingBlock, block_id)
    if not block or block.listing_id != listing_id:
        raise HTTPException(status_code=404, detail="Block not found")

    db.delete(block)
    db.commit()
    return None


@router.get("/{listing_id}/photos", response_model=list[ListingPhotoOut])
def list_listing_photos(
    listing_id: int,
    db: Session = Depends(get_db),
):
    get_public_listing_or_404(db, listing_id)
    return list_photos(db, listing_id)


@router.get("/{listing_id}/photos/mine", response_model=list[ListingPhotoOut])
def list_my_listing_photos(
    listing_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    get_owned_listing_or_404(db, listing_id, user)
    return list_photos(db, listing_id)


@router.post("/{listing_id}/photos", response_model=ListingPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_listing_photo(
    listing_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return await upload_photo(db, listing_id, user, file)


@router.patch("/{listing_id}/photos/{photo_id}/cover", response_model=ListingPhotoOut)
def set_listing_cover_photo(
    listing_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return set_cover_photo(db, listing_id, photo_id, user)


@router.delete("/{listing_id}/photos/{photo_id}", status_code=204)
def delete_listing_photo(
    listing_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    delete_photo(db, listing_id, photo_id, user)
    return None


@router.patch("/{listing_id}/photos/reorder", response_model=list[ListingPhotoOut])
def reorder_listing_photos(
    listing_id: int,
    payload: ListingPhotoReorderIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return reorder_photos(db, listing_id, user, payload.photo_ids)


@router.get("/{listing_id}/room-types", response_model=list[RoomTypeOut])
def list_my_room_types(
    listing_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = get_owned_listing_or_404(db, listing_id, user)
    ensure_room_types_for_listing(db, listing)
    rows = list(
        db.scalars(
            select(RoomType)
            .where(RoomType.listing_id == listing_id)
            .order_by(RoomType.sort_order.asc(), RoomType.id.asc())
        ).all()
    )
    return rows


@router.post("/{listing_id}/room-types", response_model=RoomTypeOut, status_code=status.HTTP_201_CREATED)
def create_room_type(
    listing_id: int,
    payload: RoomTypeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    get_owned_listing_or_404(db, listing_id, user)
    room_type = RoomType(listing_id=listing_id, **payload.model_dump())
    db.add(room_type)
    db.commit()
    db.refresh(room_type)
    return room_type


@router.patch("/{listing_id}/room-types/{room_type_id}", response_model=RoomTypeOut)
def update_room_type(
    listing_id: int,
    room_type_id: int,
    payload: RoomTypeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    get_owned_listing_or_404(db, listing_id, user)
    room_type = db.get(RoomType, room_type_id)
    if not room_type or room_type.listing_id != listing_id:
        raise HTTPException(status_code=404, detail="Room type not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(room_type, key, value)

    db.commit()
    db.refresh(room_type)
    return room_type


@router.delete("/{listing_id}/room-types/{room_type_id}", status_code=204)
def delete_room_type(
    listing_id: int,
    room_type_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    get_owned_listing_or_404(db, listing_id, user)
    room_type = db.get(RoomType, room_type_id)
    if not room_type or room_type.listing_id != listing_id:
        raise HTTPException(status_code=404, detail="Room type not found")

    reservation_id = db.scalar(select(Reservation.id).where(Reservation.room_type_id == room_type.id).limit(1))
    if reservation_id is not None:
        raise HTTPException(status_code=409, detail="Room type has reservations. Disable it instead of deleting.")

    db.delete(room_type)
    db.commit()
    return None


@router.post("", response_model=ListingOut, status_code=201)
def create_listing(
    payload: ListingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = Listing(**payload.model_dump(), owner_id=user.id)
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


@router.patch("/{listing_id}", response_model=ListingOut)
def update_listing(
    listing_id: int,
    payload: ListingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")

    for key, value in payload.model_dump().items():
        setattr(listing, key, value)
    if listing.owner_id is None:
        listing.owner_id = user.id

    db.commit()
    db.refresh(listing)
    return listing


@router.patch("/bulk/status", response_model=list[ListingOut])
def bulk_set_status(
    payload: ListingBulkStatusIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = select(Listing).where(Listing.id.in_(payload.listing_ids))
    if user.role != "admin":
        stmt = stmt.where(Listing.owner_id == user.id)

    rows = list(db.scalars(stmt).all())
    if not rows:
        raise HTTPException(status_code=404, detail="Listings not found")

    for row in rows:
        row.is_active = payload.is_active

    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


@router.delete("/{listing_id}", status_code=204)
def delete_listing(
    listing_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")

    photos = list(db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing_id)).all())
    media_root = (Path(__file__).resolve().parents[1] / "media").resolve()
    for photo in photos:
        rel_path = Path(photo.file_path)
        has_parent_escape = any(part == ".." for part in rel_path.parts)
        if rel_path.is_absolute() or has_parent_escape:
            db.delete(photo)
            continue

        abs_path = (media_root / rel_path).resolve()
        try:
            inside_media = abs_path.is_relative_to(media_root)
        except AttributeError:
            inside_media = str(abs_path).startswith(str(media_root))

        if inside_media and abs_path.exists():
            abs_path.unlink()
        db.delete(photo)

    # Hard-delete dependent booking records to prevent stale conflicts when ids are reused in SQLite.
    for block in db.scalars(select(ListingBlock).where(ListingBlock.listing_id == listing_id)).all():
        db.delete(block)
    for reservation in db.scalars(select(Reservation).where(Reservation.listing_id == listing_id)).all():
        db.delete(reservation)
    for room_type in db.scalars(select(RoomType).where(RoomType.listing_id == listing_id)).all():
        db.delete(room_type)

    db.delete(listing)
    db.commit()
    return None


@router.get("/{listing_id}", response_model=ListingOut)
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = get_public_listing_or_404(db, listing_id)
    cover_map = get_cover_photo_map(db, [listing])
    return _public_listing_out(listing, cover_map.get(listing.id))


@router.get("/{listing_id}/availability")
def get_availability(
    listing_id: int,
    from_date: date = Query(...),
    to_date: date = Query(...),
    db: Session = Depends(get_db),
):
    listing = get_public_listing_or_404(db, listing_id)
    if to_date <= from_date:
        raise HTTPException(status_code=400, detail="to_date must be after from_date")

    reservations = db.scalars(
        select(Reservation)
        .where(
            and_(
                Reservation.listing_id == listing_id,
                Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                Reservation.check_in < to_date,
                Reservation.check_out > from_date,
                Reservation.room_type_id.is_(None),
            )
        )
        .order_by(Reservation.check_in.asc())
    ).all()
    blocks = db.scalars(
        select(ListingBlock)
        .where(
            and_(
                ListingBlock.listing_id == listing_id,
                ListingBlock.check_in < to_date,
                ListingBlock.check_out > from_date,
                ListingBlock.room_type_id.is_(None),
            )
        )
        .order_by(ListingBlock.check_in.asc())
    ).all()

    ranges = [{"check_in": r.check_in, "check_out": r.check_out} for r in reservations] + [
        {"check_in": b.check_in, "check_out": b.check_out} for b in blocks
    ]
    ranges.sort(key=lambda x: x["check_in"])

    return {
        "listing_id": listing_id,
        "from_date": from_date,
        "to_date": to_date,
        "booked_ranges": ranges,
    }


@router.get("/{listing_id}/room-availability", response_model=ListingRoomAvailabilityOut)
def get_room_availability(
    listing_id: int,
    from_date: date = Query(...),
    to_date: date = Query(...),
    guests: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
):
    listing = get_public_listing_or_404(db, listing_id)
    if to_date <= from_date:
        raise HTTPException(status_code=400, detail="to_date must be after from_date")
    room_types = build_room_availability(db, listing=listing, from_date=from_date, to_date=to_date, guests=guests)
    return ListingRoomAvailabilityOut(
        listing_id=listing.id,
        from_date=from_date,
        to_date=to_date,
        guests=guests,
        room_types=room_types,
    )


@router.get("/{listing_id}/quote", response_model=QuoteOut)
def get_quote(
    listing_id: int,
    check_in: date = Query(...),
    check_out: date = Query(...),
    guests: int = Query(..., ge=1, le=12),
    tariff: str = Query(default="smart"),
    room_type_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
):
    listing = get_public_listing_or_404(db, listing_id)
    nights = validate_booking_window(check_in, check_out)
    room_type: RoomType | None = None
    nightly_price = listing.nightly_price
    max_guests = listing.max_guests
    if room_type_id is not None:
        room_type = get_room_type_or_404(db, listing.id, room_type_id)
        if room_type is None:
            raise HTTPException(status_code=404, detail="Room type not found")
        nightly_price = room_type.nightly_price
        max_guests = room_type.max_guests
    if guests > max_guests:
        raise HTTPException(status_code=400, detail="Too many guests for this room")

    selected_tariff = resolve_tariff(tariff)
    available = (
        room_type_available_count(db, listing=listing, room_type=room_type, check_in=check_in, check_out=check_out) > 0
        if room_type is not None
        else not has_conflict(db, listing_id, check_in, check_out)
    )
    pricing = quote_price(
        nightly_price,
        listing.cleaning_fee,
        nights,
        selected_tariff,
        check_in=check_in,
        check_out=check_out,
    )
    quote_lock = (
        create_quote_lock(
            db,
            listing_id=listing.id,
            room_type_id=room_type.id if room_type else None,
            check_in=check_in,
            check_out=check_out,
            guests=guests,
            tariff_plan=selected_tariff,
            nightly_price=float(pricing["nightly_price"]),
            subtotal=float(pricing["subtotal"]),
            cleaning_fee=float(listing.cleaning_fee),
            service_fee=float(pricing["service_fee"]),
            total=float(pricing["total"]),
            currency="KZT",
        )
        if available
        else None
    )

    return QuoteOut(
        listing_id=listing.id,
        room_type_id=room_type.id if room_type else None,
        room_type_name=room_type.name if room_type else None,
        available=available,
        check_in=check_in,
        check_out=check_out,
        guests=guests,
        nights=nights,
        nightly_price=float(pricing["nightly_price"]),
        subtotal=float(pricing["subtotal"]),
        cleaning_fee=listing.cleaning_fee,
        service_fee=float(pricing["service_fee"]),
        total=float(pricing["total"]),
        dynamic_multiplier=float(pricing["dynamic_multiplier"]),
        cancellation_policy=str(pricing["cancellation_policy"]),
        cancellation_text=str(pricing["cancellation_text"]),
        tariff_plan=selected_tariff,
        quote_token=quote_lock.token if quote_lock else None,
        quote_expires_at=quote_lock.expires_at if quote_lock else None,
    )
