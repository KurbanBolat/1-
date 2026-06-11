from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.models.listing import Listing
from app.models.partner_notification_read import PartnerNotificationRead
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.models.room_type import RoomType
from app.models.user import User
from app.schemas.reservation import (
    DailyOpsOut,
    PartnerCommunicationBatchRetryItemOut,
    PartnerCommunicationBatchRetryOut,
    ListingPerformanceOut,
    PartnerCommunicationEventOut,
    PartnerNotificationOut,
    PartnerNotificationReadOut,
    PartnerOpsSummaryOut,
)
from app.services.listing_service import has_conflict
from app.services.booking_rules import validate_booking_window
from app.services.notification_service import emit_reservation_status_event, retry_partner_notification_channel
from app.services.reservation_lifecycle import (
    ACTIVE_REVENUE_STATUSES,
    CLOSED_NEGATIVE_STATUSES,
    expire_stale_pending_reservations,
    transition_reservation_status,
)
from app.services.pricing import quote_price, resolve_tariff
from app.services.quote_lock_service import validate_quote_lock
from app.services.room_inventory_service import get_room_type_or_404, room_type_available_count

CANCELLATION_POLICY_RULES: dict[str, list[dict[str, int | str]]] = {
    "basic": [
        {"min_days": 14, "penalty_percent": 50, "reason": "basic_14_plus_days"},
        {"min_days": 7, "penalty_percent": 75, "reason": "basic_7_13_days"},
        {"min_days": -999, "penalty_percent": 100, "reason": "basic_less_than_7_days"},
    ],
    "smart": [
        {"min_days": 7, "penalty_percent": 0, "reason": "smart_7_plus_days"},
        {"min_days": 3, "penalty_percent": 30, "reason": "smart_3_6_days"},
        {"min_days": 1, "penalty_percent": 60, "reason": "smart_1_2_days"},
        {"min_days": -999, "penalty_percent": 100, "reason": "smart_same_day_or_after"},
    ],
    "flex": [
        {"min_days": 1, "penalty_percent": 0, "reason": "flex_1_plus_days"},
        {"min_days": -999, "penalty_percent": 20, "reason": "flex_same_day_or_after"},
    ],
}


def resolve_cancellation_rule(tariff: str, days_before_check_in: int) -> tuple[int, str]:
    normalized_tariff = tariff if tariff in CANCELLATION_POLICY_RULES else "smart"
    for rule in CANCELLATION_POLICY_RULES[normalized_tariff]:
        if days_before_check_in >= int(rule["min_days"]):
            return int(rule["penalty_percent"]), str(rule["reason"])
    return 100, "fallback_full_penalty"


def listing_scope_filter(user: User):
    if user.role == "admin":
        return None
    return Listing.owner_id == user.id


def list_partner_notifications(db: Session, user: User, limit: int = 50) -> list[PartnerNotificationOut]:
    backend_root = Path(__file__).resolve().parents[2]
    log_file = backend_root / "runtime_logs" / "partner_notifications.log"
    if not log_file.exists():
        return []

    rows: list[PartnerNotificationOut] = []
    read_ids = set(
        db.scalars(
            select(PartnerNotificationRead.event_id).where(PartnerNotificationRead.user_id == user.id)
        ).all()
    )
    try:
        lines = log_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in reversed(lines):
        if len(rows) >= limit:
            break
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        partner_id = int(payload.get("partner_id", 0))
        partner_email = str(payload.get("partner_email", "")).strip().lower()
        if partner_id != user.id and partner_email != user.email.lower():
            continue
        event_id = hashlib.sha1(line.encode("utf-8")).hexdigest()[:16]
        payload["event_id"] = event_id
        payload["read"] = event_id in read_ids
        try:
            rows.append(PartnerNotificationOut(**payload))
        except Exception:
            continue
    return rows


def mark_partner_notifications_read(
    db: Session,
    user: User,
    event_ids: list[str],
) -> PartnerNotificationReadOut:
    unique_ids: list[str] = []
    seen: set[str] = set()
    for raw in event_ids:
        event_id = raw.strip()
        if not event_id or event_id in seen:
            continue
        seen.add(event_id)
        unique_ids.append(event_id)
    if not unique_ids:
        return PartnerNotificationReadOut(marked=0, event_ids=[])

    allowed_ids = {
        item.event_id
        for item in list_partner_notifications(db=db, user=user, limit=500)
        if item.event_id in unique_ids
    }
    if not allowed_ids:
        return PartnerNotificationReadOut(marked=0, event_ids=[])

    existing_ids = set(
        db.scalars(
            select(PartnerNotificationRead.event_id).where(
                PartnerNotificationRead.user_id == user.id,
                PartnerNotificationRead.event_id.in_(allowed_ids),
            )
        ).all()
    )
    to_create = sorted(allowed_ids - existing_ids)
    for event_id in to_create:
        db.add(PartnerNotificationRead(user_id=user.id, event_id=event_id))
    db.commit()
    marked_ids = sorted(allowed_ids)
    return PartnerNotificationReadOut(marked=len(to_create), event_ids=marked_ids)


def list_partner_communication_events(
    db: Session,
    user: User,
    limit: int = 120,
    channel: str | None = None,
    status: str | None = None,
) -> list[PartnerCommunicationEventOut]:
    backend_root = Path(__file__).resolve().parents[2]
    log_file = backend_root / "runtime_logs" / "communication_events.log"
    if not log_file.exists():
        return []

    rows: list[PartnerCommunicationEventOut] = []
    listing_owner_cache: dict[int, int | None] = {}
    user_email = user.email.lower()
    normalized_channel = channel.lower().strip() if channel else None
    normalized_status = status.lower().strip() if status else None

    try:
        lines = log_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in reversed(lines):
        if len(rows) >= limit:
            break
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue

        payload_channel = str(payload.get("channel", "")).strip().lower()
        payload_status = str(payload.get("status", "")).strip().lower()
        if normalized_channel and payload_channel != normalized_channel:
            continue
        if normalized_status and payload_status != normalized_status:
            continue

        partner_id = payload.get("partner_id")
        partner_email = str(payload.get("partner_email", "")).strip().lower()
        listing_id_raw = payload.get("listing_id")
        listing_id = int(listing_id_raw) if isinstance(listing_id_raw, int) else None
        if listing_id is None and isinstance(listing_id_raw, str) and listing_id_raw.isdigit():
            listing_id = int(listing_id_raw)

        allowed = user.role == "admin"
        if not allowed:
            # Primary ownership guard: if listing_id is present in event payload, always verify
            # listing ownership in current DB state and do not trust stale partner markers in logs.
            if listing_id is not None:
                if listing_id not in listing_owner_cache:
                    listing = db.get(Listing, listing_id)
                    listing_owner_cache[listing_id] = listing.owner_id if listing else None
                allowed = listing_owner_cache[listing_id] == user.id
            else:
                # Legacy fallback only when listing_id is absent.
                allowed = (
                    (isinstance(partner_id, int) and partner_id == user.id)
                    or (partner_email and partner_email == user_email)
                )
        if not allowed:
            continue

        event_id = hashlib.sha1(line.encode("utf-8")).hexdigest()[:16]
        event_name = str(payload.get("event", "")).strip()
        reason = str(payload.get("reason", "")).strip() or "unknown"
        attempts_raw = payload.get("attempts", 1)
        attempts = attempts_raw if isinstance(attempts_raw, int) else 1
        retry_applied = bool(payload.get("retry_applied", False))
        listing_title = payload.get("listing_title")
        reservation_id_raw = payload.get("reservation_id")
        reservation_id = int(reservation_id_raw) if isinstance(reservation_id_raw, int) else None
        if reservation_id is None and isinstance(reservation_id_raw, str) and reservation_id_raw.isdigit():
            reservation_id = int(reservation_id_raw)
        created_at = payload.get("created_at")
        if not isinstance(created_at, str):
            continue

        if payload_channel not in {"webhook", "email", "telegram"}:
            continue
        if payload_status not in {"sent", "failed", "skipped"}:
            continue
        if not event_name:
            continue

        try:
            rows.append(
                PartnerCommunicationEventOut(
                    event_id=event_id,
                    created_at=created_at,
                    channel=payload_channel,
                    event=event_name,
                    reservation_id=reservation_id,
                    listing_id=listing_id,
                    listing_title=listing_title if isinstance(listing_title, str) else None,
                    status=payload_status,
                    reason=reason,
                    attempts=max(1, attempts),
                    retry_applied=retry_applied,
                )
            )
        except Exception:
            continue

    return rows


def retry_partner_communication_event(
    db: Session,
    user: User,
    event_id: str,
) -> tuple[PartnerCommunicationEventOut, PartnerCommunicationEventOut]:
    payload, line = _find_communication_event_by_id(event_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Communication event not found")

    channel = str(payload.get("channel", "")).strip().lower()
    status = str(payload.get("status", "")).strip().lower()
    event_name = str(payload.get("event", "")).strip()
    reservation_id_raw = payload.get("reservation_id")
    reservation_id = int(reservation_id_raw) if isinstance(reservation_id_raw, int) else None
    if reservation_id is None and isinstance(reservation_id_raw, str) and reservation_id_raw.isdigit():
        reservation_id = int(reservation_id_raw)

    if channel not in {"webhook", "email", "telegram"}:
        raise HTTPException(status_code=400, detail="Unsupported communication channel")
    if status != "failed":
        raise HTTPException(status_code=400, detail="Only failed events can be retried")
    if not event_name or reservation_id is None:
        raise HTTPException(status_code=400, detail="Communication event payload is incomplete")

    _ensure_communication_access(db, user, payload)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    retried_entry = retry_partner_notification_channel(
        db=db,
        reservation=reservation,
        event=event_name,
        channel=channel,
    )

    previous = _communication_payload_to_schema(payload, line)
    retried_line = json.dumps(retried_entry, ensure_ascii=False)
    retried = _communication_payload_to_schema(retried_entry, retried_line)
    return previous, retried


def retry_partner_communication_events_batch(
    db: Session,
    user: User,
    event_ids: list[str],
) -> PartnerCommunicationBatchRetryOut:
    unique_ids: list[str] = []
    seen: set[str] = set()
    for raw in event_ids:
        event_id = raw.strip()
        if not event_id or event_id in seen:
            continue
        seen.add(event_id)
        unique_ids.append(event_id)

    items: list[PartnerCommunicationBatchRetryItemOut] = []
    retried = 0
    failed = 0

    for event_id in unique_ids:
        try:
            previous_event, retried_event = retry_partner_communication_event(
                db=db,
                user=user,
                event_id=event_id,
            )
            items.append(
                PartnerCommunicationBatchRetryItemOut(
                    event_id=event_id,
                    success=True,
                    previous_event=previous_event,
                    retried_event=retried_event,
                )
            )
            retried += 1
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Retry failed"
            items.append(
                PartnerCommunicationBatchRetryItemOut(
                    event_id=event_id,
                    success=False,
                    error=detail,
                )
            )
            failed += 1
        except Exception:
            items.append(
                PartnerCommunicationBatchRetryItemOut(
                    event_id=event_id,
                    success=False,
                    error="Retry failed",
                )
            )
            failed += 1

    return PartnerCommunicationBatchRetryOut(
        requested=len(unique_ids),
        retried=retried,
        failed=failed,
        items=items,
    )


def _find_communication_event_by_id(event_id: str) -> tuple[dict | None, str]:
    backend_root = Path(__file__).resolve().parents[2]
    log_file = backend_root / "runtime_logs" / "communication_events.log"
    if not log_file.exists():
        return None, ""

    try:
        lines = log_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None, ""

    for line in reversed(lines):
        if not line.strip():
            continue
        current_id = hashlib.sha1(line.encode("utf-8")).hexdigest()[:16]
        if current_id != event_id:
            continue
        try:
            return json.loads(line), line
        except json.JSONDecodeError:
            return None, ""
    return None, ""


def _ensure_communication_access(db: Session, user: User, payload: dict) -> None:
    if user.role == "admin":
        return
    partner_id = payload.get("partner_id")
    partner_email = str(payload.get("partner_email", "")).strip().lower()
    if isinstance(partner_id, int) and partner_id == user.id:
        return
    if partner_email and partner_email == user.email.lower():
        return

    listing_id_raw = payload.get("listing_id")
    listing_id = int(listing_id_raw) if isinstance(listing_id_raw, int) else None
    if listing_id is None and isinstance(listing_id_raw, str) and listing_id_raw.isdigit():
        listing_id = int(listing_id_raw)
    if listing_id is not None:
        listing = db.get(Listing, listing_id)
        if listing and listing.owner_id == user.id:
            return

    raise HTTPException(status_code=403, detail="No access to this communication event")


def _communication_payload_to_schema(payload: dict, raw_line: str) -> PartnerCommunicationEventOut:
    created_at = payload.get("created_at")
    channel = str(payload.get("channel", "")).strip().lower()
    event_name = str(payload.get("event", "")).strip()
    payload_status = str(payload.get("status", "")).strip().lower()
    reason = str(payload.get("reason", "")).strip() or "unknown"
    listing_title = payload.get("listing_title")
    reservation_id_raw = payload.get("reservation_id")
    listing_id_raw = payload.get("listing_id")
    reservation_id = int(reservation_id_raw) if isinstance(reservation_id_raw, int) else None
    listing_id = int(listing_id_raw) if isinstance(listing_id_raw, int) else None
    if reservation_id is None and isinstance(reservation_id_raw, str) and reservation_id_raw.isdigit():
        reservation_id = int(reservation_id_raw)
    if listing_id is None and isinstance(listing_id_raw, str) and listing_id_raw.isdigit():
        listing_id = int(listing_id_raw)
    attempts_raw = payload.get("attempts", 1)
    attempts = attempts_raw if isinstance(attempts_raw, int) else 1
    retry_applied = bool(payload.get("retry_applied", False))
    event_id = hashlib.sha1(raw_line.encode("utf-8")).hexdigest()[:16]

    if not isinstance(created_at, str) or channel not in {"webhook", "email", "telegram"}:
        raise HTTPException(status_code=400, detail="Communication event payload is invalid")
    if payload_status not in {"sent", "failed", "skipped"} or not event_name:
        raise HTTPException(status_code=400, detail="Communication event payload is invalid")

    return PartnerCommunicationEventOut(
        event_id=event_id,
        created_at=created_at,
        channel=channel,
        event=event_name,
        reservation_id=reservation_id,
        listing_id=listing_id,
        listing_title=listing_title if isinstance(listing_title, str) else None,
        status=payload_status,
        reason=reason,
        attempts=max(1, attempts),
        retry_applied=retry_applied,
    )


def create_reservation(db: Session, payload) -> Reservation:
    expire_stale_pending_reservations(db)
    listing = db.get(Listing, payload.listing_id)
    if not listing or not listing.is_active or listing.owner_id is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    room_type: RoomType | None = None
    nightly_price = listing.nightly_price
    max_guests = listing.max_guests
    if getattr(payload, "room_type_id", None) is not None:
        room_type = get_room_type_or_404(db, listing.id, payload.room_type_id)
        if room_type is None:
            raise HTTPException(status_code=404, detail="Room type not found")
        nightly_price = room_type.nightly_price
        max_guests = room_type.max_guests

    if payload.guests > max_guests:
        raise HTTPException(status_code=400, detail="Too many guests for this room")

    nights = validate_booking_window(payload.check_in, payload.check_out)
    tariff_plan = resolve_tariff(payload.tariff_plan)
    normalized_email = payload.guest_email.strip().lower()

    if room_type is not None:
        available_count = room_type_available_count(
            db,
            listing=listing,
            room_type=room_type,
            check_in=payload.check_in,
            check_out=payload.check_out,
        )
        if available_count <= 0:
            raise HTTPException(status_code=409, detail="Selected room type is no longer available")

    # Guard against rapid double-submit from client retries/taps.
    duplicate_window_start = utc_now() - timedelta(minutes=5)
    duplicate_stmt = (
        select(Reservation)
        .where(Reservation.listing_id == payload.listing_id)
        .where(Reservation.room_type_id == getattr(payload, "room_type_id", None))
        .where(Reservation.guest_email == normalized_email)
        .where(Reservation.check_in == payload.check_in)
        .where(Reservation.check_out == payload.check_out)
        .where(Reservation.guests == payload.guests)
        .where(Reservation.tariff_plan == tariff_plan)
        .where(Reservation.status.in_(("draft", "pending_payment", "confirmed")))
        .where(Reservation.created_at >= duplicate_window_start)
        .order_by(Reservation.id.desc())
        .limit(1)
    )
    duplicate = db.scalars(duplicate_stmt).first()
    if duplicate:
        return duplicate

    quote_lock = None
    if payload.quote_token:
        quote_lock = validate_quote_lock(
            db,
            quote_token=payload.quote_token,
            listing_id=payload.listing_id,
            room_type_id=room_type.id if room_type else None,
            check_in=payload.check_in,
            check_out=payload.check_out,
            guests=payload.guests,
            tariff_plan=tariff_plan,
        )
        total_price = float(quote_lock.total)
    else:
        pricing = quote_price(
            nightly_price,
            listing.cleaning_fee,
            nights,
            tariff_plan,
            check_in=payload.check_in,
            check_out=payload.check_out,
        )
        total_price = float(pricing["total"])

    data = payload.model_dump(exclude={"quote_token"})
    data["guest_name"] = data["guest_name"].strip()
    data["guest_email"] = normalized_email
    data["guest_phone"] = data["guest_phone"].strip()
    data["tariff_plan"] = tariff_plan
    data["total_price"] = total_price
    data["status"] = "draft"

    reservation = Reservation(**data)
    db.add(reservation)
    db.commit()
    db.refresh(reservation)

    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation.id).first()
    if not payment:
        db.add(
            ReservationPayment(
                reservation_id=reservation.id,
                payment_status="pending",
                amount=reservation.total_price,
                currency="KZT",
            )
        )
        db.commit()
    return reservation


def calculate_cancellation_terms(reservation: Reservation, as_of: date | None = None) -> dict[str, float | int | bool | str]:
    today = as_of or date.today()
    days_before_check_in = (reservation.check_in - today).days
    tariff = (reservation.tariff_plan or "smart").lower()
    penalty_percent, reason = resolve_cancellation_rule(tariff, days_before_check_in)

    penalty_amount = round(float(reservation.total_price) * penalty_percent / 100.0, 2)
    refund_amount = round(max(float(reservation.total_price) - penalty_amount, 0.0), 2)
    return {
        "days_before_check_in": days_before_check_in,
        "penalty_percent": penalty_percent,
        "penalty_amount": penalty_amount,
        "refund_amount": refund_amount,
        "refundable": refund_amount > 0,
        "reason": reason,
    }


def _mark_refund_if_eligible(db: Session, reservation: Reservation) -> None:
    payment = db.query(ReservationPayment).filter(ReservationPayment.reservation_id == reservation.id).first()
    if not payment or payment.payment_status != "paid":
        return

    terms = calculate_cancellation_terms(reservation)
    refund_amount = float(terms.get("refund_amount") or 0.0)
    if refund_amount <= 0:
        return

    payment.payment_status = "refunded"
    payment.updated_at = utc_now()


def cancel_reservation_by_guest_email(db: Session, reservation_id: int, guest_email: str) -> Reservation:
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.guest_email.lower() != guest_email.lower():
        raise HTTPException(status_code=403, detail="Email does not match reservation")

    if reservation.status == "cancelled":
        return reservation
    _mark_refund_if_eligible(db, reservation)
    transition_reservation_status(reservation, "cancelled")
    emit_reservation_status_event(db, reservation, "cancelled")
    db.commit()
    db.refresh(reservation)
    return reservation


def partner_cancel_reservation(db: Session, reservation_id: int, user: User) -> Reservation:
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    listing = db.get(Listing, reservation.listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this reservation")

    if reservation.status == "cancelled":
        return reservation
    _mark_refund_if_eligible(db, reservation)
    transition_reservation_status(reservation, "cancelled")
    emit_reservation_status_event(db, reservation, "cancelled")
    db.commit()
    db.refresh(reservation)
    return reservation


def partner_confirm_reservation(db: Session, reservation_id: int, user: User) -> Reservation:
    expire_stale_pending_reservations(db)
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    listing = db.get(Listing, reservation.listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this reservation")

    if reservation.status in {"cancelled", "expired"}:
        transition_reservation_status(reservation, "draft")
    if reservation.status == "draft":
        transition_reservation_status(reservation, "pending_payment")
        emit_reservation_status_event(db, reservation, "pending_payment")
    if reservation.status != "confirmed":
        if reservation.room_type_id is not None:
            room_type = get_room_type_or_404(db, listing.id, reservation.room_type_id)
            if room_type is None:
                raise HTTPException(status_code=404, detail="Room type not found")
            available_count = room_type_available_count(
                db,
                listing=listing,
                room_type=room_type,
                check_in=reservation.check_in,
                check_out=reservation.check_out,
                exclude_reservation_id=reservation.id,
            )
            if available_count <= 0:
                raise HTTPException(status_code=409, detail="Selected room type is no longer available")
        elif has_conflict(
            db,
            reservation.listing_id,
            reservation.check_in,
            reservation.check_out,
            exclude_reservation_id=reservation.id,
        ):
            raise HTTPException(status_code=409, detail="Selected dates are unavailable")

    transition_reservation_status(reservation, "confirmed")
    emit_reservation_status_event(db, reservation, "confirmed")
    db.commit()
    db.refresh(reservation)
    return reservation


def build_partner_summary(db: Session, user: User, period_days: int) -> PartnerOpsSummaryOut:
    if period_days not in {7, 30, 90}:
        raise HTTPException(status_code=400, detail="period_days must be one of: 7, 30, 90")

    scope_filter = listing_scope_filter(user)
    listings_stmt = select(Listing).where(Listing.owner_id.is_not(None))
    if scope_filter is not None:
        listings_stmt = listings_stmt.where(scope_filter)

    listings = list(db.scalars(listings_stmt).all())
    listing_by_id = {listing.id: listing for listing in listings}
    listing_ids = list(listing_by_id.keys())
    if not listing_ids:
        return PartnerOpsSummaryOut(
            period_days=period_days,
            arrivals_today=0,
            departures_today=0,
            active_stays_today=0,
            cancellations_period=0,
            reservations_period=0,
            revenue_period=0,
            adr_period=0,
            occupancy_period=0,
            daily_stats=[],
            listing_performance=[],
        )

    reservations = list(db.scalars(select(Reservation).where(Reservation.listing_id.in_(listing_ids))).all())
    today = date.today()
    period_start = today - timedelta(days=period_days - 1)
    period_end = today + timedelta(days=1)

    arrivals_today = 0
    departures_today = 0
    active_stays_today = 0
    cancellations_period = 0
    reservations_period = 0
    revenue_period = 0.0
    listing_res_period: dict[int, int] = {listing_id: 0 for listing_id in listing_ids}
    listing_revenue_period: dict[int, float] = {listing_id: 0.0 for listing_id in listing_ids}
    listing_booked_nights_period: dict[int, int] = {listing_id: 0 for listing_id in listing_ids}
    daily_reservations: dict[date, int] = {
        period_start + timedelta(days=offset): 0 for offset in range(period_days)
    }
    daily_cancellations: dict[date, int] = {
        period_start + timedelta(days=offset): 0 for offset in range(period_days)
    }
    daily_revenue: dict[date, float] = {
        period_start + timedelta(days=offset): 0.0 for offset in range(period_days)
    }

    for reservation in reservations:
        if reservation.status in CLOSED_NEGATIVE_STATUSES:
            if reservation.created_at.date() >= period_start:
                cancellations_period += 1
                created_day = reservation.created_at.date()
                if created_day in daily_cancellations:
                    daily_cancellations[created_day] += 1
            continue

        if reservation.status not in ACTIVE_REVENUE_STATUSES:
            continue

        if reservation.check_in == today:
            arrivals_today += 1
        if reservation.check_out == today:
            departures_today += 1
        if reservation.check_in <= today < reservation.check_out:
            active_stays_today += 1
        if reservation.created_at.date() >= period_start:
            revenue_period += reservation.total_price
            created_day = reservation.created_at.date()
            if created_day in daily_reservations:
                daily_reservations[created_day] += 1
                daily_revenue[created_day] += reservation.total_price

        overlap_start = max(reservation.check_in, period_start)
        overlap_end = min(reservation.check_out, period_end)
        overlap_nights = max(0, (overlap_end - overlap_start).days)
        if overlap_nights > 0:
            reservations_period += 1
            listing_res_period[reservation.listing_id] += 1
            listing_revenue_period[reservation.listing_id] += reservation.total_price
            listing_booked_nights_period[reservation.listing_id] += overlap_nights

    total_nights_capacity = len(listing_ids) * period_days
    total_booked_nights = sum(listing_booked_nights_period.values())
    occupancy_period = (total_booked_nights / total_nights_capacity * 100) if total_nights_capacity else 0
    adr_period = (revenue_period / reservations_period) if reservations_period else 0

    listing_performance: list[ListingPerformanceOut] = []
    for listing_id in listing_ids:
        listing = listing_by_id[listing_id]
        res_count = listing_res_period[listing_id]
        revenue = listing_revenue_period[listing_id]
        booked_nights = listing_booked_nights_period[listing_id]
        occupancy = booked_nights / period_days * 100
        adr = revenue / res_count if res_count else 0
        listing_performance.append(
            ListingPerformanceOut(
                listing_id=listing_id,
                listing_title=listing.title,
                city=listing.city,
                district=listing.district,
                reservations_period=res_count,
                revenue_period=revenue,
                adr_period=adr,
                occupancy_period=occupancy,
            )
        )

    listing_performance.sort(key=lambda item: (item.revenue_period, item.reservations_period), reverse=True)
    daily_stats = [
        DailyOpsOut(
            date=day,
            reservations=daily_reservations[day],
            cancellations=daily_cancellations[day],
            revenue=daily_revenue[day],
        )
        for day in sorted(daily_reservations.keys())
    ]
    return PartnerOpsSummaryOut(
        period_days=period_days,
        arrivals_today=arrivals_today,
        departures_today=departures_today,
        active_stays_today=active_stays_today,
        cancellations_period=cancellations_period,
        reservations_period=reservations_period,
        revenue_period=revenue_period,
        adr_period=adr_period,
        occupancy_period=occupancy_period,
        daily_stats=daily_stats,
        listing_performance=listing_performance[:8],
    )
