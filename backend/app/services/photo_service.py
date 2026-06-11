from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models.listing_photo import ListingPhoto
from app.models.user import User
from app.services.listing_service import get_owned_listing_or_404

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MEDIA_LISTINGS_DIR = Path(__file__).resolve().parents[1] / "media" / "listings"
MEDIA_ROOT_DIR = (Path(__file__).resolve().parents[1] / "media").resolve()


def _safe_media_path(rel_path: str) -> Path:
    candidate = (MEDIA_ROOT_DIR / rel_path).resolve()
    if not str(candidate).startswith(str(MEDIA_ROOT_DIR)):
        raise HTTPException(status_code=400, detail="Invalid media path")
    return candidate


def list_photos(db: Session, listing_id: int) -> list[ListingPhoto]:
    return list(
        db.scalars(
            select(ListingPhoto)
            .where(ListingPhoto.listing_id == listing_id)
            .order_by(ListingPhoto.is_cover.desc(), ListingPhoto.sort_order.asc(), ListingPhoto.id.asc())
        ).all()
    )


async def upload_photo(db: Session, listing_id: int, user: User, file: UploadFile) -> ListingPhoto:
    get_owned_listing_or_404(db, listing_id, user)

    ext = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only jpg/png/webp images are supported")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty image file")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image is too large (max 8MB)")

    listing_dir = MEDIA_LISTINGS_DIR / str(listing_id)
    listing_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{ext}"
    abs_path = listing_dir / filename
    abs_path.write_bytes(data)

    current_max_sort = db.scalar(select(func.max(ListingPhoto.sort_order)).where(ListingPhoto.listing_id == listing_id)) or 0
    has_cover = db.scalar(select(ListingPhoto.id).where(and_(ListingPhoto.listing_id == listing_id, ListingPhoto.is_cover.is_(True)))) is not None
    rel_path = f"listings/{listing_id}/{filename}"

    photo = ListingPhoto(
        listing_id=listing_id,
        file_path=rel_path,
        file_url=f"/media/{rel_path}",
        is_cover=not has_cover,
        sort_order=int(current_max_sort) + 1,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return photo


def set_cover_photo(db: Session, listing_id: int, photo_id: int, user: User) -> ListingPhoto:
    get_owned_listing_or_404(db, listing_id, user)
    photo = db.get(ListingPhoto, photo_id)
    if not photo or photo.listing_id != listing_id:
        raise HTTPException(status_code=404, detail="Photo not found")

    rows = db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing_id)).all()
    for row in rows:
        row.is_cover = row.id == photo_id
    db.commit()
    db.refresh(photo)
    return photo


def delete_photo(db: Session, listing_id: int, photo_id: int, user: User) -> None:
    get_owned_listing_or_404(db, listing_id, user)
    photo = db.get(ListingPhoto, photo_id)
    if not photo or photo.listing_id != listing_id:
        raise HTTPException(status_code=404, detail="Photo not found")

    abs_path = _safe_media_path(photo.file_path)
    db.delete(photo)
    db.commit()

    if abs_path.exists():
        abs_path.unlink()

    next_cover = db.scalar(
        select(ListingPhoto).where(ListingPhoto.listing_id == listing_id).order_by(ListingPhoto.sort_order.asc(), ListingPhoto.id.asc())
    )
    if next_cover and not next_cover.is_cover:
        next_cover.is_cover = True
        db.commit()


def reorder_photos(db: Session, listing_id: int, user: User, photo_ids: list[int]) -> list[ListingPhoto]:
    get_owned_listing_or_404(db, listing_id, user)
    rows = list(db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing_id)).all())
    if not rows:
        return []

    row_ids = {row.id for row in rows}
    incoming = [photo_id for photo_id in photo_ids if photo_id in row_ids]
    tail = [row.id for row in sorted(rows, key=lambda x: (x.sort_order, x.id)) if row.id not in incoming]
    ordered_ids = incoming + tail
    if len(ordered_ids) != len(rows):
        raise HTTPException(status_code=400, detail="Invalid photo reorder payload")

    first_id = ordered_ids[0]
    id_to_row = {row.id: row for row in rows}
    for idx, row_id in enumerate(ordered_ids, start=1):
        row = id_to_row[row_id]
        row.sort_order = idx
        row.is_cover = row_id == first_id

    db.commit()
    return list_photos(db, listing_id)
