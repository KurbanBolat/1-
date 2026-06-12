import json
import time

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utc_now
from app.db.session import SessionLocal
from app.models.listing import Listing
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.models.reservation_payment_attempt import ReservationPaymentAttempt
from app.models.payment_webhook_event import PaymentWebhookEvent
from app.schemas.payment import PaymentWebhookIn, PaymentWebhookOut
from app.models.room_type import RoomType
from app.schemas.reservation import ReservationPaymentOut
from app.services.listing_service import has_conflict
from app.services.notification_service import emit_reservation_status_event
from app.services.reservation_lifecycle import expire_stale_pending_reservations, transition_reservation_status
from app.services.room_inventory_service import room_type_available_count


def _payment_error(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def _latest_payment_attempt(db: Session, reservation_id: int) -> ReservationPaymentAttempt | None:
    return (
        db.query(ReservationPaymentAttempt)
        .filter(ReservationPaymentAttempt.reservation_id == reservation_id)
        .order_by(ReservationPaymentAttempt.id.desc())
        .first()
    )


def ensure_reservation_payment(db: Session, reservation: Reservation) -> ReservationPayment:
    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation.id).first()
    if payment:
        return payment

    payment = ReservationPayment(
        reservation_id=reservation.id,
        payment_status="pending",
        amount=reservation.total_price,
        currency="KZT",
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _build_payment_out(
    payment: ReservationPayment,
    reservation_status: str,
    attempt_status: str | None = None,
    idempotency_reused: bool = False,
) -> ReservationPaymentOut:
    return ReservationPaymentOut(
        reservation_id=payment.reservation_id,
        payment_status=payment.payment_status,  # type: ignore[arg-type]
        payment_method=payment.payment_method,  # type: ignore[arg-type]
        amount=payment.amount,
        currency=payment.currency,
        attempted_at=payment.attempted_at,
        updated_at=payment.updated_at,
        attempt_status=attempt_status,  # type: ignore[arg-type]
        reservation_status=reservation_status,  # type: ignore[arg-type]
        idempotency_reused=idempotency_reused,
    )


def _ensure_payment_start_allowed(db: Session, reservation: Reservation) -> None:
    # We only lock calendar slots when payment starts.
    if reservation.status != "draft":
        return

    unavailable = False
    if reservation.room_type_id is not None:
        listing = db.get(Listing, reservation.listing_id)
        room_type = db.get(RoomType, reservation.room_type_id)
        unavailable = (
            listing is None
            or room_type is None
            or room_type.listing_id != reservation.listing_id
            or room_type_available_count(
                db,
                listing=listing,
                room_type=room_type,
                check_in=reservation.check_in,
                check_out=reservation.check_out,
            )
            <= 0
        )
    else:
        unavailable = has_conflict(
            db,
            reservation.listing_id,
            reservation.check_in,
            reservation.check_out,
        )

    if unavailable:
        transition_reservation_status(reservation, "expired")
        db.commit()
        raise HTTPException(
            status_code=409,
            detail=_payment_error("PAYMENT_DATES_UNAVAILABLE", "Selected dates are unavailable"),
        )


def get_reservation_payment(db: Session, reservation_id: int) -> ReservationPaymentOut:
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail=_payment_error("RESERVATION_NOT_FOUND", "Reservation not found"))

    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation_id).first()
    if not payment:
        payment = ensure_reservation_payment(db, reservation)

    latest_attempt = _latest_payment_attempt(db, reservation_id)
    return _build_payment_out(
        payment,
        reservation_status=reservation.status,
        attempt_status=(latest_attempt.status if latest_attempt else None),
    )


def finalize_mock_payment_attempt(attempt_id: int) -> None:
    # Simulate PSP latency before callback/webhook updates final status.
    time.sleep(1.2)

    db = SessionLocal()
    try:
        attempt = db.get(ReservationPaymentAttempt, attempt_id)
        if not attempt or attempt.status != "pending":
            return
        reservation = db.get(Reservation, attempt.reservation_id)
        if not reservation:
            return

        payment = (
            db.query(ReservationPayment)
            .filter(ReservationPayment.reservation_id == attempt.reservation_id)
            .first()
        )
        if not payment:
            return

        if reservation.status in {"expired", "cancelled"}:
            attempt.status = "failed"
            attempt.updated_at = utc_now()
            payment.payment_status = "failed"
            payment.updated_at = utc_now()
            db.commit()
            return

        final_status = "failed" if attempt.force_fail else "paid"
        attempt.status = final_status
        attempt.updated_at = utc_now()

        payment.payment_status = final_status
        payment.payment_method = attempt.method
        payment.updated_at = utc_now()
        if final_status == "paid":
            transition_reservation_status(reservation, "confirmed")
            emit_reservation_status_event(db, reservation, "confirmed")
        else:
            transition_reservation_status(reservation, "draft")
        db.commit()
    finally:
        db.close()


def _start_pending_payment_attempt(
    db: Session,
    *,
    reservation_id: int,
    method: str,
    idempotency_key: str,
    force_fail: bool = False,
) -> tuple[ReservationPayment, Reservation, ReservationPaymentAttempt | None, bool]:
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail=_payment_error("RESERVATION_NOT_FOUND", "Reservation not found"))
    if reservation.status in {"confirmed", "checked_in", "checked_out", "cancelled", "expired"}:
        raise HTTPException(
            status_code=409,
            detail=_payment_error(
                "PAYMENT_NOT_ALLOWED",
                "Payment is not allowed for this reservation status",
            ),
        )

    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation_id).first()
    if not payment:
        payment = ensure_reservation_payment(db, reservation)

    existing_attempt = (
        db.query(ReservationPaymentAttempt)
        .filter(
            ReservationPaymentAttempt.reservation_id == reservation_id,
            ReservationPaymentAttempt.idempotency_key == idempotency_key,
        )
        .first()
    )
    if existing_attempt:
        if payment.payment_method is None:
            payment.payment_method = existing_attempt.method
            payment.updated_at = utc_now()
            db.commit()
            db.refresh(payment)
        return payment, reservation, existing_attempt, True

    # Prevent duplicate in-flight payment attempts created with different idempotency keys.
    # While a reservation is pending payment, we keep a single pending attempt and reuse it.
    latest_attempt = _latest_payment_attempt(db, reservation_id)
    if reservation.status == "pending_payment" and latest_attempt and latest_attempt.status == "pending":
        if payment.payment_method is None:
            payment.payment_method = latest_attempt.method
            payment.updated_at = utc_now()
            db.commit()
            db.refresh(payment)
        return payment, reservation, latest_attempt, True

    _ensure_payment_start_allowed(db, reservation)

    payment.payment_method = method
    payment.attempted_at = utc_now()
    payment.payment_status = "pending"
    payment.updated_at = utc_now()
    transition_reservation_status(reservation, "pending_payment")
    emit_reservation_status_event(db, reservation, "pending_payment")

    attempt = ReservationPaymentAttempt(
        reservation_id=reservation_id,
        idempotency_key=idempotency_key,
        method=method,
        force_fail=force_fail,
        status="pending",
    )
    db.add(attempt)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        reservation = db.get(Reservation, reservation_id)
        if not reservation:
            raise HTTPException(status_code=404, detail=_payment_error("RESERVATION_NOT_FOUND", "Reservation not found"))
        payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation_id).first()
        if not payment:
            payment = ensure_reservation_payment(db, reservation)
        return payment, reservation, None, True

    db.refresh(payment)
    db.refresh(attempt)
    db.refresh(reservation)
    return payment, reservation, attempt, False


def queue_mock_payment_attempt(
    db: Session,
    reservation_id: int,
    method: str,
    idempotency_key: str,
    background_tasks: BackgroundTasks,
    force_fail: bool = False,
) -> ReservationPaymentOut:
    payment, reservation, attempt, idempotency_reused = _start_pending_payment_attempt(
        db,
        reservation_id=reservation_id,
        method=method,
        idempotency_key=idempotency_key,
        force_fail=force_fail,
    )
    if not idempotency_reused and attempt:
        background_tasks.add_task(finalize_mock_payment_attempt, attempt.id)
    return _build_payment_out(
        payment,
        reservation_status=reservation.status,
        attempt_status=(attempt.status if attempt else None),
        idempotency_reused=idempotency_reused,
    )


def start_provider_payment_attempt(
    db: Session,
    reservation_id: int,
    method: str,
    idempotency_key: str,
) -> ReservationPaymentOut:
    payment, reservation, attempt, idempotency_reused = _start_pending_payment_attempt(
        db,
        reservation_id=reservation_id,
        method=method,
        idempotency_key=idempotency_key,
        force_fail=False,
    )
    return _build_payment_out(
        payment,
        reservation_status=reservation.status,
        attempt_status=(attempt.status if attempt else None),
        idempotency_reused=idempotency_reused,
    )


def start_configured_payment_attempt(
    db: Session,
    reservation_id: int,
    method: str,
    idempotency_key: str,
    background_tasks: BackgroundTasks,
    force_fail: bool = False,
) -> ReservationPaymentOut:
    if settings.normalized_payment_provider == "mock":
        return queue_mock_payment_attempt(
            db,
            reservation_id=reservation_id,
            method=method,
            idempotency_key=idempotency_key,
            background_tasks=background_tasks,
            force_fail=force_fail,
        )
    return start_provider_payment_attempt(
        db,
        reservation_id=reservation_id,
        method=method,
        idempotency_key=idempotency_key,
    )


def attempt_mock_payment(
    db: Session,
    reservation_id: int,
    method: str,
    force_fail: bool = False,
) -> ReservationPaymentOut:
    # Backward-compatible sync call for old integrations.
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail=_payment_error("RESERVATION_NOT_FOUND", "Reservation not found"))
    if reservation.status in {"confirmed", "checked_in", "checked_out", "cancelled", "expired"}:
        raise HTTPException(
            status_code=409,
            detail=_payment_error(
                "PAYMENT_NOT_ALLOWED",
                "Payment is not allowed for this reservation status",
            ),
        )

    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation_id).first()
    if not payment:
        payment = ensure_reservation_payment(db, reservation)

    _ensure_payment_start_allowed(db, reservation)

    payment.payment_method = method
    payment.attempted_at = utc_now()
    payment.payment_status = "failed" if force_fail else "paid"
    payment.updated_at = utc_now()
    if payment.payment_status == "paid":
        if reservation.status == "draft":
            transition_reservation_status(reservation, "pending_payment")
            emit_reservation_status_event(db, reservation, "pending_payment")
        transition_reservation_status(reservation, "confirmed")
        emit_reservation_status_event(db, reservation, "confirmed")
    else:
        if reservation.status == "draft":
            transition_reservation_status(reservation, "pending_payment")
            emit_reservation_status_event(db, reservation, "pending_payment")
        transition_reservation_status(reservation, "draft")
    db.commit()
    db.refresh(payment)
    return _build_payment_out(
        payment,
        reservation_status=reservation.status,
        attempt_status=payment.payment_status,
    )


def _webhook_out(
    *,
    payload: PaymentWebhookIn,
    event: PaymentWebhookEvent | None,
    duplicate: bool,
    process_status: str,
    reservation: Reservation | None,
    payment: ReservationPayment | None,
    attempt: ReservationPaymentAttempt | None,
    reason: str | None = None,
) -> PaymentWebhookOut:
    return PaymentWebhookOut(
        provider=payload.provider,
        event_id=payload.event_id,
        duplicate=duplicate,
        process_status=process_status,  # type: ignore[arg-type]
        reservation_id=reservation.id if reservation else payload.reservation_id,
        reservation_status=(reservation.status if reservation else None),  # type: ignore[arg-type]
        payment_status=(payment.payment_status if payment else None),  # type: ignore[arg-type]
        attempt_status=(attempt.status if attempt else None),  # type: ignore[arg-type]
        reason=reason or (event.reason if event else None),
    )


def _record_payment_webhook_event(
    db: Session,
    payload: PaymentWebhookIn,
    *,
    process_status: str,
    reason: str | None,
) -> PaymentWebhookEvent:
    event = PaymentWebhookEvent(
        provider=payload.provider,
        event_id=payload.event_id,
        reservation_id=payload.reservation_id,
        idempotency_key=payload.idempotency_key,
        status=process_status,
        reason=reason,
        payload_json=json.dumps(payload.model_dump(mode="json"), ensure_ascii=False),
        processed_at=utc_now(),
    )
    db.add(event)
    return event


def _find_or_create_webhook_attempt(
    db: Session,
    reservation_id: int,
    *,
    idempotency_key: str | None,
    method: str | None,
) -> ReservationPaymentAttempt | None:
    if idempotency_key:
        attempt = (
            db.query(ReservationPaymentAttempt)
            .filter(
                ReservationPaymentAttempt.reservation_id == reservation_id,
                ReservationPaymentAttempt.idempotency_key == idempotency_key,
            )
            .first()
        )
        if attempt:
            return attempt
    else:
        attempt = _latest_payment_attempt(db, reservation_id)
        if attempt:
            return attempt

    if not idempotency_key:
        return None

    attempt = ReservationPaymentAttempt(
        reservation_id=reservation_id,
        idempotency_key=idempotency_key,
        method=method or "card",
        force_fail=False,
        status="pending",
    )
    db.add(attempt)
    return attempt


def process_payment_webhook(db: Session, payload: PaymentWebhookIn) -> PaymentWebhookOut:
    existing_event = (
        db.query(PaymentWebhookEvent)
        .filter(
            PaymentWebhookEvent.provider == payload.provider,
            PaymentWebhookEvent.event_id == payload.event_id,
        )
        .first()
    )
    if existing_event:
        reservation = db.get(Reservation, existing_event.reservation_id) if existing_event.reservation_id else None
        payment = (
            db.query(ReservationPayment)
            .filter(ReservationPayment.reservation_id == existing_event.reservation_id)
            .first()
            if existing_event.reservation_id
            else None
        )
        attempt = _latest_payment_attempt(db, existing_event.reservation_id) if existing_event.reservation_id else None
        return _webhook_out(
            payload=payload,
            event=existing_event,
            duplicate=True,
            process_status=existing_event.status,
            reservation=reservation,
            payment=payment,
            attempt=attempt,
        )

    reservation = db.get(Reservation, payload.reservation_id)
    if not reservation:
        event = _record_payment_webhook_event(
            db,
            payload,
            process_status="rejected",
            reason="reservation_not_found",
        )
        db.commit()
        raise HTTPException(status_code=404, detail=_payment_error("RESERVATION_NOT_FOUND", "Reservation not found"))

    payment = ensure_reservation_payment(db, reservation)
    currency = (payload.currency or payment.currency).upper()
    if currency != payment.currency.upper():
        event = _record_payment_webhook_event(
            db,
            payload,
            process_status="rejected",
            reason="currency_mismatch",
        )
        db.commit()
        raise HTTPException(status_code=409, detail=_payment_error("PAYMENT_CURRENCY_MISMATCH", "Payment currency mismatch"))
    if payload.amount is not None and round(float(payload.amount), 2) != round(float(payment.amount), 2):
        event = _record_payment_webhook_event(
            db,
            payload,
            process_status="rejected",
            reason="amount_mismatch",
        )
        db.commit()
        raise HTTPException(status_code=409, detail=_payment_error("PAYMENT_AMOUNT_MISMATCH", "Payment amount mismatch"))

    attempt = _find_or_create_webhook_attempt(
        db,
        reservation.id,
        idempotency_key=payload.idempotency_key,
        method=payload.method or payment.payment_method,
    )
    event = _record_payment_webhook_event(db, payload, process_status="processed", reason=None)

    now = utc_now()
    if payload.method:
        payment.payment_method = payload.method
    elif attempt and not payment.payment_method:
        payment.payment_method = attempt.method
    if payment.attempted_at is None:
        payment.attempted_at = now
    payment.updated_at = now

    terminal_paid = payment.payment_status in {"paid", "refunded"}
    if payload.status == "paid":
        if attempt:
            attempt.status = "paid"
            attempt.updated_at = now
        payment.payment_status = "paid"
        if reservation.status == "draft":
            transition_reservation_status(reservation, "pending_payment")
            emit_reservation_status_event(db, reservation, "pending_payment")
        if reservation.status == "pending_payment":
            transition_reservation_status(reservation, "confirmed")
            emit_reservation_status_event(db, reservation, "confirmed")
    elif payload.status == "failed":
        if attempt:
            attempt.status = "failed"
            attempt.updated_at = now
        if not terminal_paid:
            payment.payment_status = "failed"
            if reservation.status == "pending_payment":
                transition_reservation_status(reservation, "draft")
    elif payload.status == "pending":
        if attempt:
            attempt.status = "pending"
            attempt.updated_at = now
        if not terminal_paid:
            payment.payment_status = "pending"
            if reservation.status == "draft":
                transition_reservation_status(reservation, "pending_payment")
                emit_reservation_status_event(db, reservation, "pending_payment")

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing_event = (
            db.query(PaymentWebhookEvent)
            .filter(
                PaymentWebhookEvent.provider == payload.provider,
                PaymentWebhookEvent.event_id == payload.event_id,
            )
            .first()
        )
        if existing_event:
            db.refresh(reservation)
            payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation.id).first()
            attempt = _latest_payment_attempt(db, reservation.id)
            return _webhook_out(
                payload=payload,
                event=existing_event,
                duplicate=True,
                process_status=existing_event.status,
                reservation=reservation,
                payment=payment,
                attempt=attempt,
            )
        raise

    db.refresh(reservation)
    db.refresh(payment)
    if attempt:
        db.refresh(attempt)
    db.refresh(event)
    return _webhook_out(
        payload=payload,
        event=event,
        duplicate=False,
        process_status="processed",
        reservation=reservation,
        payment=payment,
        attempt=attempt,
    )
