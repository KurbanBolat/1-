from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.services.notification_service import emit_reservation_status_event

RESERVATION_PAYMENT_TTL_MINUTES = 15
BLOCKING_RESERVATION_STATUSES = {"pending_payment", "confirmed", "checked_in"}
ACTIVE_REVENUE_STATUSES = {"confirmed", "checked_in", "checked_out"}
CLOSED_NEGATIVE_STATUSES = {"cancelled", "expired"}
RESERVATION_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"pending_payment", "cancelled", "expired"},
    "pending_payment": {"draft", "confirmed", "cancelled", "expired"},
    "confirmed": {"checked_in", "cancelled"},
    "checked_in": {"checked_out", "cancelled"},
    "checked_out": set(),
    "cancelled": {"draft"},
    "expired": {"draft"},
}


def transition_reservation_status(reservation: Reservation, target_status: str) -> bool:
    current_status = reservation.status
    if current_status == target_status:
        return False
    allowed_targets = RESERVATION_TRANSITIONS.get(current_status, set())
    if target_status not in allowed_targets:
        raise HTTPException(
            status_code=409,
            detail=f"Invalid reservation status transition: {current_status} -> {target_status}",
        )
    reservation.status = target_status
    return True


def expire_stale_pending_reservations(db: Session, now: datetime | None = None) -> int:
    current = now or utc_now()
    cutoff = current - timedelta(minutes=RESERVATION_PAYMENT_TTL_MINUTES)
    expired_rows = list(
        db.execute(
            select(Reservation)
            .outerjoin(ReservationPayment, ReservationPayment.reservation_id == Reservation.id)
            .where(
                Reservation.status == "pending_payment",
                or_(
                    ReservationPayment.attempted_at < cutoff,
                    and_(ReservationPayment.attempted_at.is_(None), Reservation.created_at < cutoff),
                ),
            )
        )
        .scalars()
        .all()
    )
    if not expired_rows:
        return 0

    reservation_ids = [row.id for row in expired_rows]
    for reservation in expired_rows:
        reservation.status = "expired"
        emit_reservation_status_event(db, reservation, "expired")

    payments = list(
        db.scalars(
            select(ReservationPayment).where(ReservationPayment.reservation_id.in_(reservation_ids))
        ).all()
    )
    for payment in payments:
        if payment.payment_status == "pending":
            payment.payment_status = "failed"
            payment.updated_at = current

    db.commit()
    return len(expired_rows)
