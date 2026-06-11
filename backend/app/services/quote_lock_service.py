from __future__ import annotations

from datetime import datetime, timedelta
from secrets import token_hex

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.models.quote_lock import QuoteLock

QUOTE_LOCK_TTL_MINUTES = 15


def cleanup_expired_quote_locks(db: Session, now: datetime | None = None) -> None:
    current = now or utc_now()
    db.execute(delete(QuoteLock).where(QuoteLock.expires_at < current))
    db.commit()


def create_quote_lock(
    db: Session,
    *,
    listing_id: int,
    room_type_id: int | None = None,
    check_in,
    check_out,
    guests: int,
    tariff_plan: str,
    nightly_price: float,
    subtotal: float,
    cleaning_fee: float,
    service_fee: float,
    total: float,
    currency: str = "KZT",
) -> QuoteLock:
    cleanup_expired_quote_locks(db)
    expires_at = utc_now() + timedelta(minutes=QUOTE_LOCK_TTL_MINUTES)
    lock = QuoteLock(
        token=token_hex(16),
        listing_id=listing_id,
        room_type_id=room_type_id,
        check_in=check_in,
        check_out=check_out,
        guests=guests,
        tariff_plan=tariff_plan,
        nightly_price=nightly_price,
        subtotal=subtotal,
        cleaning_fee=cleaning_fee,
        service_fee=service_fee,
        total=total,
        currency=currency,
        expires_at=expires_at,
    )
    db.add(lock)
    db.commit()
    db.refresh(lock)
    return lock


def validate_quote_lock(
    db: Session,
    *,
    quote_token: str,
    listing_id: int,
    room_type_id: int | None = None,
    check_in,
    check_out,
    guests: int,
    tariff_plan: str,
) -> QuoteLock:
    cleanup_expired_quote_locks(db)
    lock = db.scalar(select(QuoteLock).where(QuoteLock.token == quote_token))
    if not lock:
        raise HTTPException(status_code=409, detail="Quote expired. Please refresh checkout.")

    if (
        lock.listing_id != listing_id
        or lock.room_type_id != room_type_id
        or lock.check_in != check_in
        or lock.check_out != check_out
        or lock.guests != guests
        or lock.tariff_plan != tariff_plan
    ):
        raise HTTPException(status_code=409, detail="Quote mismatch. Please refresh checkout.")
    return lock
