from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_optional_current_user, require_partner
from app.core.reservation_access import (
    create_reservation_access_token,
    parse_reservation_access_token,
    reservation_access_token_matches,
)
from app.db.session import get_db
from app.models.listing import Listing
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.models.room_type import RoomType
from app.models.user import User
from app.schemas.reservation import (
    CancellationTermsOut,
    ListingPerformanceOut,
    PartnerCommunicationBatchRetryIn,
    PartnerCommunicationBatchRetryOut,
    PartnerCommunicationEventOut,
    PartnerCommunicationRetryOut,
    PartnerNotificationOut,
    PartnerNotificationReadIn,
    PartnerNotificationReadOut,
    PartnerOpsSummaryOut,
    PartnerReservationOut,
    ReservationCancelOut,
    ReservationPaymentAttempt,
    ReservationPaymentOut,
    ReservationCancel,
    ReservationCreate,
    ReservationOut,
)
from app.services.payment_service import get_reservation_payment, queue_mock_payment_attempt
from app.services.reservation_service import (
    build_partner_summary,
    calculate_cancellation_terms,
    cancel_reservation_by_guest_email,
    create_reservation as create_reservation_service,
    list_partner_notifications,
    mark_partner_notifications_read,
    list_partner_communication_events,
    listing_scope_filter,
    partner_cancel_reservation as partner_cancel_reservation_service,
    partner_confirm_reservation as partner_confirm_reservation_service,
    retry_partner_communication_event as retry_partner_communication_event_service,
    retry_partner_communication_events_batch as retry_partner_communication_events_batch_service,
)
from app.services.notification_service import queue_partner_reservation_notification

router = APIRouter(prefix="/reservations", tags=["reservations"])


def _room_type_name(db: Session, reservation: Reservation) -> str | None:
    if reservation.room_type_id is None:
        return None
    room_type = db.get(RoomType, reservation.room_type_id)
    return room_type.name if room_type else None


def _reservation_out(reservation: Reservation, db: Session) -> ReservationOut:
    payload = ReservationOut.model_validate(reservation).model_dump()
    payload["room_type_name"] = _room_type_name(db, reservation)
    payload["access_token"] = create_reservation_access_token(reservation.id, reservation.guest_email)
    return ReservationOut.model_validate(payload)


def _reservation_cancel_out(reservation: Reservation, terms: dict, db: Session) -> ReservationCancelOut:
    return ReservationCancelOut(
        id=reservation.id,
        listing_id=reservation.listing_id,
        room_type_id=reservation.room_type_id,
        room_type_name=_room_type_name(db, reservation),
        guest_name=reservation.guest_name,
        guest_email=reservation.guest_email,
        guest_phone=reservation.guest_phone,
        check_in=reservation.check_in,
        check_out=reservation.check_out,
        guests=reservation.guests,
        tariff_plan=reservation.tariff_plan,
        total_price=reservation.total_price,
        status=reservation.status,
        access_token=create_reservation_access_token(reservation.id, reservation.guest_email),
        cancellation_terms=CancellationTermsOut(**terms),
    )


def _partner_can_access_reservation(db: Session, reservation: Reservation, user: User | None) -> bool:
    if not user:
        return False
    if user.role == "admin":
        return True
    listing = db.get(Listing, reservation.listing_id)
    return bool(listing and listing.owner_id == user.id)


def _require_reservation_guest_or_partner(
    *,
    db: Session,
    reservation: Reservation,
    access_token: str | None,
    user: User | None,
) -> None:
    if _partner_can_access_reservation(db, reservation, user):
        return
    if reservation_access_token_matches(access_token, reservation.id, reservation.guest_email):
        return
    raise HTTPException(status_code=403, detail="Reservation access token is missing or invalid")


@router.post("", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def create_reservation(
    payload: ReservationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    reservation = create_reservation_service(db, payload)
    queue_partner_reservation_notification(background_tasks, db, reservation)
    return _reservation_out(reservation, db)


@router.get("/by-email/{guest_email}", response_model=list[ReservationOut])
def list_reservations_by_email(
    guest_email: str,
    access_token: list[str] = Query(default_factory=list),
    db: Session = Depends(get_db),
):
    normalized_email = guest_email.strip().lower()
    if not access_token:
        raise HTTPException(status_code=403, detail="Reservation access token is required")

    rows: list[Reservation] = []
    seen_ids: set[int] = set()
    for token in access_token:
        parsed = parse_reservation_access_token(token)
        if not parsed or str(parsed.get("email", "")).lower() != normalized_email:
            continue
        reservation_id = parsed.get("rid")
        if not isinstance(reservation_id, int) or reservation_id in seen_ids:
            continue
        reservation = db.get(Reservation, reservation_id)
        if not reservation:
            continue
        if not reservation_access_token_matches(token, reservation.id, reservation.guest_email):
            continue
        if reservation.guest_email.lower() != normalized_email:
            continue
        seen_ids.add(reservation.id)
        rows.append(reservation)

    rows.sort(key=lambda item: item.id, reverse=True)
    return [_reservation_out(row, db) for row in rows]


@router.get("/guest/{reservation_id}", response_model=ReservationOut)
def get_guest_reservation(
    reservation_id: int,
    access_token: str = Query(..., min_length=16, max_length=512),
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _require_reservation_guest_or_partner(db=db, reservation=reservation, access_token=access_token, user=None)
    return _reservation_out(reservation, db)


@router.get("/mine", response_model=list[PartnerReservationOut])
def list_my_reservations(
    status_filter: str | None = Query(default=None, alias="status", pattern="^(draft|pending_payment|confirmed|checked_in|checked_out|cancelled|expired)$"),
    payment_status: str | None = Query(default=None, pattern="^(pending|paid|failed|refunded)$"),
    listing_id: int | None = Query(default=None, ge=1),
    guest_query: str | None = Query(default=None, min_length=1, max_length=255),
    check_in_from: date | None = Query(default=None),
    check_out_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = (
        select(
            Reservation,
            Listing.title,
            Listing.city,
            Listing.district,
            RoomType.name,
            ReservationPayment.payment_status,
            ReservationPayment.payment_method,
        )
        .join(Listing, Listing.id == Reservation.listing_id)
        .outerjoin(RoomType, RoomType.id == Reservation.room_type_id)
        .outerjoin(ReservationPayment, ReservationPayment.reservation_id == Reservation.id)
        .order_by(Reservation.id.desc())
    )

    scope_filter = listing_scope_filter(user)
    if scope_filter is not None:
        stmt = stmt.where(scope_filter)

    if status_filter:
        stmt = stmt.where(Reservation.status == status_filter)
    if payment_status:
        stmt = stmt.where(ReservationPayment.payment_status == payment_status)
    if listing_id:
        stmt = stmt.where(Reservation.listing_id == listing_id)
    if guest_query:
        normalized = f"%{guest_query.strip().lower()}%"
        stmt = stmt.where(
            Reservation.guest_name.ilike(normalized)
            | Reservation.guest_email.ilike(normalized)
            | Reservation.guest_phone.ilike(normalized)
        )
    if check_in_from:
        stmt = stmt.where(Reservation.check_in >= check_in_from)
    if check_out_to:
        stmt = stmt.where(Reservation.check_out <= check_out_to)

    rows = db.execute(stmt).all()
    return [
        PartnerReservationOut(
            id=reservation.id,
            listing_id=reservation.listing_id,
            room_type_id=reservation.room_type_id,
            room_type_name=room_type_name,
            guest_name=reservation.guest_name,
            guest_email=reservation.guest_email,
            guest_phone=reservation.guest_phone,
            check_in=reservation.check_in,
            check_out=reservation.check_out,
            guests=reservation.guests,
            tariff_plan=reservation.tariff_plan,
            total_price=reservation.total_price,
            status=reservation.status,
            listing_title=title,
            city=city,
            district=district,
            payment_status=(pay_status or "pending"),
            payment_method=pay_method,
        )
        for reservation, title, city, district, room_type_name, pay_status, pay_method in rows
    ]


@router.get("/mine/summary", response_model=PartnerOpsSummaryOut)
def get_my_reservations_summary(
    period_days: int = Query(default=30, ge=7, le=90),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return build_partner_summary(db, user, period_days)


@router.get("/mine/notifications", response_model=list[PartnerNotificationOut])
def get_my_notifications(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return list_partner_notifications(db=db, user=user, limit=limit)


@router.post("/mine/notifications/read", response_model=PartnerNotificationReadOut)
def mark_my_notifications_read(
    payload: PartnerNotificationReadIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return mark_partner_notifications_read(db=db, user=user, event_ids=payload.event_ids)


@router.get("/mine/communications", response_model=list[PartnerCommunicationEventOut])
def get_my_communication_events(
    limit: int = Query(default=120, ge=1, le=500),
    channel: str | None = Query(default=None, pattern="^(webhook|email|telegram)$"),
    status: str | None = Query(default=None, pattern="^(sent|failed|skipped)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return list_partner_communication_events(
        db=db,
        user=user,
        limit=limit,
        channel=channel,
        status=status,
    )


@router.post("/mine/communications/{event_id}/retry", response_model=PartnerCommunicationRetryOut)
def retry_my_communication_event(
    event_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    previous_event, retried_event = retry_partner_communication_event_service(
        db=db,
        user=user,
        event_id=event_id,
    )
    return PartnerCommunicationRetryOut(
        previous_event=previous_event,
        retried_event=retried_event,
    )


@router.post("/mine/communications/retry-batch", response_model=PartnerCommunicationBatchRetryOut)
def retry_my_communication_events_batch(
    payload: PartnerCommunicationBatchRetryIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    return retry_partner_communication_events_batch_service(
        db=db,
        user=user,
        event_ids=payload.event_ids,
    )


@router.get("/{reservation_id}/cancellation-terms", response_model=CancellationTermsOut)
def get_cancellation_terms(
    reservation_id: int,
    access_token: str | None = Query(default=None, min_length=16, max_length=512),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_current_user),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _require_reservation_guest_or_partner(db=db, reservation=reservation, access_token=access_token, user=user)
    return CancellationTermsOut(**calculate_cancellation_terms(reservation))


@router.patch("/{reservation_id}/cancel", response_model=ReservationCancelOut)
def cancel_reservation(
    reservation_id: int,
    payload: ReservationCancel,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_current_user),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _require_reservation_guest_or_partner(db=db, reservation=reservation, access_token=payload.access_token, user=user)
    terms = calculate_cancellation_terms(reservation)
    updated = cancel_reservation_by_guest_email(db, reservation_id, payload.guest_email)
    return _reservation_cancel_out(updated, terms, db)


@router.patch("/{reservation_id}/partner-cancel", response_model=ReservationCancelOut)
def partner_cancel_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    terms = calculate_cancellation_terms(reservation)
    updated = partner_cancel_reservation_service(db, reservation_id, user)
    return _reservation_cancel_out(updated, terms, db)


@router.patch("/{reservation_id}/partner-confirm", response_model=ReservationOut)
def partner_confirm_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    updated = partner_confirm_reservation_service(db, reservation_id, user)
    return _reservation_out(updated, db)


@router.get("/{reservation_id}/payment", response_model=ReservationPaymentOut)
def get_payment_status(
    reservation_id: int,
    access_token: str | None = Query(default=None, min_length=16, max_length=512),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_current_user),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _require_reservation_guest_or_partner(db=db, reservation=reservation, access_token=access_token, user=user)
    return get_reservation_payment(db, reservation_id)


@router.post("/{reservation_id}/payment/attempt", response_model=ReservationPaymentOut)
def make_mock_payment(
    reservation_id: int,
    payload: ReservationPaymentAttempt,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_current_user),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _require_reservation_guest_or_partner(db=db, reservation=reservation, access_token=payload.access_token, user=user)
    return queue_mock_payment_attempt(
        db,
        reservation_id=reservation_id,
        method=payload.method,
        idempotency_key=payload.idempotency_key,
        force_fail=payload.force_fail,
        background_tasks=background_tasks,
    )
