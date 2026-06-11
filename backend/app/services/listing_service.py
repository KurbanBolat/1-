from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.listing_photo import ListingPhoto
from app.models.reservation import Reservation
from app.models.user import User
from app.services.reservation_lifecycle import BLOCKING_RESERVATION_STATUSES


def has_conflict(
    db: Session,
    listing_id: int,
    check_in: date,
    check_out: date,
    exclude_reservation_id: int | None = None,
) -> bool:
    reservation_filters = [
        Reservation.listing_id == listing_id,
        Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
        Reservation.check_in < check_out,
        Reservation.check_out > check_in,
        Reservation.room_type_id.is_(None),
    ]
    if exclude_reservation_id is not None:
        reservation_filters.append(Reservation.id != exclude_reservation_id)

    reservation_stmt = select(Reservation.id).where(
        and_(
            *reservation_filters,
        )
    )
    block_stmt = select(ListingBlock.id).where(
        and_(
            ListingBlock.listing_id == listing_id,
            ListingBlock.check_in < check_out,
            ListingBlock.check_out > check_in,
            ListingBlock.room_type_id.is_(None),
        )
    )
    return db.scalar(reservation_stmt) is not None or db.scalar(block_stmt) is not None


def get_owned_listing_or_404(db: Session, listing_id: int, user: User) -> Listing:
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")
    return listing


def get_public_listing_or_404(db: Session, listing_id: int) -> Listing:
    listing = db.get(Listing, listing_id)
    if not listing or not listing.is_active or listing.owner_id is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing


def get_cover_photo_map(db: Session, listings: list[Listing]) -> dict[int, str]:
    if not listings:
        return {}
    listing_ids = [listing.id for listing in listings]
    photos = list(
        db.scalars(
            select(ListingPhoto)
            .where(ListingPhoto.listing_id.in_(listing_ids))
            .order_by(ListingPhoto.is_cover.desc(), ListingPhoto.sort_order.asc(), ListingPhoto.id.asc())
        ).all()
    )
    first_by_listing: dict[int, str] = {}
    for photo in photos:
        if photo.listing_id not in first_by_listing:
            first_by_listing[photo.listing_id] = photo.file_url
    return first_by_listing
