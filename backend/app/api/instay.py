import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.deps import require_partner
from app.core.reservation_access import reservation_access_token_matches
from app.db.session import get_db
from app.models.listing import Listing
from app.models.menu_item import MenuItem
from app.models.restaurant import Restaurant, RestaurantBookingEvent, RestaurantTableBooking
from app.models.reservation import Reservation
from app.models.room_service_order import RoomServiceOrder, RoomServiceOrderItem
from app.models.user import User
from app.schemas.instay import (
    MenuItemCreate,
    MenuItemOut,
    RestaurantCreate,
    RestaurantBookingEventOut,
    RestaurantOut,
    RestaurantTableBookingCreate,
    RestaurantTableBookingOut,
    RestaurantTableBookingStatusUpdate,
    RoomServiceOrderCreate,
    RoomServiceOrderOut,
    RoomServiceOrderStatusUpdate,
)

router = APIRouter(prefix="/in-stay", tags=["in_stay"])

ALLOWED_IN_STAY_RESERVATION_STATUSES = {"confirmed", "checked_in"}
BOOKING_STATUS_EVENT_TYPE = {
    "submitted": "booking_submitted",
    "confirmed": "booking_confirmed",
    "seated": "guest_seated",
    "completed": "booking_completed",
    "cancelled": "booking_cancelled",
}
BOOKING_STATUS_MESSAGE = {
    "submitted": "Your table booking request is submitted",
    "confirmed": "Your table booking is confirmed",
    "seated": "You are checked in at the restaurant",
    "completed": "Your restaurant visit is completed",
    "cancelled": "Your table booking was cancelled",
}

TEST_RESTAURANT_PATTERN = re.compile(r"(test|e2e)", re.IGNORECASE)
TRAILING_ID_PATTERN = re.compile(r"\s+\d{6,}$")


def _public_restaurant_name(name: str) -> str:
    normalized = TRAILING_ID_PATTERN.sub("", (name or "").strip())
    if not normalized:
        return "Signature Restaurant"
    if TEST_RESTAURANT_PATTERN.search(normalized):
        return "Signature Restaurant"
    return normalized


def _ensure_partner_access_to_listing(listing: Listing | None, user: User) -> None:
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if user.role != "admin" and listing.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No access to this listing")


def _ensure_guest_reservation_access(reservation: Reservation, guest_email: str, access_token: str | None) -> None:
    if reservation.guest_email.lower() != guest_email.strip().lower():
        raise HTTPException(status_code=403, detail="Guest email does not match reservation")
    if not reservation_access_token_matches(access_token, reservation.id, reservation.guest_email):
        raise HTTPException(status_code=403, detail="Reservation access token is missing or invalid")


def _serialize_order(db: Session, order: RoomServiceOrder) -> RoomServiceOrderOut:
    items = list(
        db.scalars(
            select(RoomServiceOrderItem)
            .where(RoomServiceOrderItem.order_id == order.id)
            .order_by(RoomServiceOrderItem.id.asc())
        ).all()
    )
    return RoomServiceOrderOut(
        id=order.id,
        listing_id=order.listing_id,
        reservation_id=order.reservation_id,
        guest_email=order.guest_email,
        guest_name=order.guest_name,
        status=order.status,  # type: ignore[arg-type]
        total_price=order.total_price,
        currency=order.currency,
        delivery_note=order.delivery_note,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[
            {
                "menu_item_id": item.menu_item_id,
                "item_name": item.item_name,
                "unit_price": item.unit_price,
                "quantity": item.quantity,
                "line_total": item.line_total,
                "note": item.note,
            }
            for item in items
        ],
    )


def _serialize_restaurant_booking(db: Session, booking: RestaurantTableBooking) -> RestaurantTableBookingOut:
    restaurant = db.get(Restaurant, booking.restaurant_id)
    restaurant_name = restaurant.name if restaurant else f"Restaurant #{booking.restaurant_id}"
    return RestaurantTableBookingOut(
        id=booking.id,
        listing_id=booking.listing_id,
        restaurant_id=booking.restaurant_id,
        restaurant_name=restaurant_name,
        reservation_id=booking.reservation_id,
        guest_email=booking.guest_email,
        guest_name=booking.guest_name,
        booking_date=booking.booking_date,
        booking_time=booking.booking_time,
        guests=booking.guests,
        note=booking.note,
        status=booking.status,  # type: ignore[arg-type]
        created_at=booking.created_at,
        updated_at=booking.updated_at,
    )


def _serialize_restaurant_booking_event(event: RestaurantBookingEvent) -> RestaurantBookingEventOut:
    return RestaurantBookingEventOut(
        id=event.id,
        booking_id=event.booking_id,
        listing_id=event.listing_id,
        reservation_id=event.reservation_id,
        restaurant_id=event.restaurant_id,
        guest_email=event.guest_email,
        event_type=event.event_type,
        status=event.status,  # type: ignore[arg-type]
        message=event.message,
        actor_role=event.actor_role,
        created_at=event.created_at,
    )


def _emit_restaurant_booking_event(
    db: Session,
    *,
    booking: RestaurantTableBooking,
    event_type: str,
    message: str,
    actor_role: str,
    ) -> None:
    db.add(
        RestaurantBookingEvent(
            booking_id=booking.id,
            listing_id=booking.listing_id,
            reservation_id=booking.reservation_id,
            restaurant_id=booking.restaurant_id,
            guest_email=booking.guest_email,
            event_type=event_type,
            status=booking.status,
            message=message,
            actor_role=actor_role,
        )
    )


def _event_payload_from_status(status: str) -> tuple[str, str]:
    return (
        BOOKING_STATUS_EVENT_TYPE.get(status, "status_changed"),
        BOOKING_STATUS_MESSAGE.get(status, f"Restaurant booking status updated to {status}"),
    )


@router.get("/listings/{listing_id}/menu", response_model=list[MenuItemOut])
def list_menu_items(
    listing_id: int,
    only_active: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    listing = db.get(Listing, listing_id)
    if not listing or not listing.is_active:
        raise HTTPException(status_code=404, detail="Listing not found")
    stmt = select(MenuItem).where(MenuItem.listing_id == listing_id)
    if only_active:
        stmt = stmt.where(MenuItem.is_active.is_(True))
    stmt = stmt.order_by(MenuItem.sort_order.asc(), MenuItem.id.asc())
    return list(db.scalars(stmt).all())


@router.post("/listings/{listing_id}/menu", response_model=MenuItemOut, status_code=status.HTTP_201_CREATED)
def create_menu_item(
    listing_id: int,
    payload: MenuItemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    _ensure_partner_access_to_listing(listing, user)
    item = MenuItem(listing_id=listing_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/menu/{menu_item_id}", response_model=MenuItemOut)
def update_menu_item(
    menu_item_id: int,
    payload: MenuItemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    item = db.get(MenuItem, menu_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    listing = db.get(Listing, item.listing_id)
    _ensure_partner_access_to_listing(listing, user)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/orders", response_model=RoomServiceOrderOut, status_code=status.HTTP_201_CREATED)
def create_room_service_order(
    payload: RoomServiceOrderCreate,
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, payload.reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _ensure_guest_reservation_access(reservation, payload.guest_email, payload.access_token)
    if reservation.status not in ALLOWED_IN_STAY_RESERVATION_STATUSES:
        raise HTTPException(status_code=409, detail="In-stay orders are allowed only for active stays")

    menu_ids = list({item.menu_item_id for item in payload.items})
    menu_rows = list(
        db.scalars(
            select(MenuItem).where(
                and_(
                    MenuItem.id.in_(menu_ids),
                    MenuItem.listing_id == reservation.listing_id,
                    MenuItem.is_active.is_(True),
                )
            )
        ).all()
    )
    menu_map = {row.id: row for row in menu_rows}
    missing = [menu_id for menu_id in menu_ids if menu_id not in menu_map]
    if missing:
        raise HTTPException(status_code=400, detail=f"Menu items unavailable: {missing}")

    order = RoomServiceOrder(
        listing_id=reservation.listing_id,
        reservation_id=reservation.id,
        guest_email=reservation.guest_email,
        guest_name=reservation.guest_name,
        status="submitted",
        total_price=0,
        currency="KZT",
        delivery_note=payload.delivery_note.strip(),
    )
    db.add(order)
    db.flush()

    total = 0.0
    for item_in in payload.items:
        menu_item = menu_map[item_in.menu_item_id]
        line_total = float(menu_item.price) * item_in.quantity
        total += line_total
        db.add(
            RoomServiceOrderItem(
                order_id=order.id,
                menu_item_id=menu_item.id,
                item_name=menu_item.name,
                unit_price=float(menu_item.price),
                quantity=item_in.quantity,
                line_total=line_total,
                note=item_in.note.strip(),
            )
        )
    order.total_price = total
    db.add(order)
    db.commit()
    db.refresh(order)
    return _serialize_order(db, order)


@router.get("/orders/by-reservation/{reservation_id}", response_model=list[RoomServiceOrderOut])
def list_orders_for_guest(
    reservation_id: int,
    guest_email: str = Query(...),
    access_token: str = Query(..., min_length=16, max_length=512),
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _ensure_guest_reservation_access(reservation, guest_email, access_token)
    rows = list(
        db.scalars(
            select(RoomServiceOrder)
            .where(
                and_(
                    RoomServiceOrder.reservation_id == reservation_id,
                    RoomServiceOrder.guest_email == reservation.guest_email,
                )
            )
            .order_by(RoomServiceOrder.id.desc())
        ).all()
    )
    return [_serialize_order(db, row) for row in rows]


@router.get("/orders/mine", response_model=list[RoomServiceOrderOut])
def list_orders_for_partner(
    status_filter: str | None = Query(default=None, alias="status", pattern="^(submitted|accepted|preparing|delivered|closed|cancelled)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = select(RoomServiceOrder).order_by(RoomServiceOrder.id.desc())
    if user.role != "admin":
        listing_ids = list(db.scalars(select(Listing.id).where(Listing.owner_id == user.id)).all())
        if not listing_ids:
            return []
        stmt = stmt.where(RoomServiceOrder.listing_id.in_(listing_ids))
    if status_filter:
        stmt = stmt.where(RoomServiceOrder.status == status_filter)
    rows = list(db.scalars(stmt).all())
    return [_serialize_order(db, row) for row in rows]


@router.patch("/orders/{order_id}/status", response_model=RoomServiceOrderOut)
def update_order_status(
    order_id: int,
    payload: RoomServiceOrderStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    order = db.get(RoomServiceOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    listing = db.get(Listing, order.listing_id)
    _ensure_partner_access_to_listing(listing, user)
    order.status = payload.status
    db.add(order)
    db.commit()
    db.refresh(order)
    return _serialize_order(db, order)


@router.get("/listings/{listing_id}/restaurants", response_model=list[RestaurantOut])
def list_restaurants(
    listing_id: int,
    only_active: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    listing = db.get(Listing, listing_id)
    if not listing or not listing.is_active:
        raise HTTPException(status_code=404, detail="Listing not found")
    stmt = select(Restaurant).where(Restaurant.listing_id == listing_id)
    if only_active:
        stmt = stmt.where(Restaurant.is_active.is_(True))
    stmt = stmt.order_by(Restaurant.id.asc())
    rows = list(db.scalars(stmt).all())
    sanitized: list[RestaurantOut] = []
    for row in rows:
        payload = RestaurantOut.model_validate(row).model_dump()
        payload["name"] = _public_restaurant_name(payload["name"])
        sanitized.append(RestaurantOut.model_validate(payload))
    return sanitized


@router.post("/listings/{listing_id}/restaurants", response_model=RestaurantOut, status_code=status.HTTP_201_CREATED)
def create_restaurant(
    listing_id: int,
    payload: RestaurantCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    listing = db.get(Listing, listing_id)
    _ensure_partner_access_to_listing(listing, user)
    row = Restaurant(listing_id=listing_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/restaurants/{restaurant_id}", response_model=RestaurantOut)
def update_restaurant(
    restaurant_id: int,
    payload: RestaurantCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    row = db.get(Restaurant, restaurant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    listing = db.get(Listing, row.listing_id)
    _ensure_partner_access_to_listing(listing, user)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/restaurant-bookings", response_model=RestaurantTableBookingOut, status_code=status.HTTP_201_CREATED)
def create_restaurant_booking(
    payload: RestaurantTableBookingCreate,
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, payload.reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _ensure_guest_reservation_access(reservation, payload.guest_email, payload.access_token)
    if reservation.status not in ALLOWED_IN_STAY_RESERVATION_STATUSES:
        raise HTTPException(status_code=409, detail="Restaurant booking is allowed only for active stays")

    restaurant = db.get(Restaurant, payload.restaurant_id)
    if not restaurant or not restaurant.is_active:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    if restaurant.listing_id != reservation.listing_id:
        raise HTTPException(status_code=400, detail="Restaurant does not belong to this stay")

    slot_count = db.scalar(
        select(RestaurantTableBooking.id)
        .where(
            and_(
                RestaurantTableBooking.restaurant_id == restaurant.id,
                RestaurantTableBooking.booking_date == payload.booking_date,
                RestaurantTableBooking.booking_time == payload.booking_time,
                RestaurantTableBooking.status.in_(["submitted", "confirmed", "seated"]),
            )
        )
        .limit(1)
    )
    if slot_count:
        # Simple capacity guard for MVP: one active booking per guest at same slot
        guest_slot = db.scalar(
            select(RestaurantTableBooking.id)
            .where(
                and_(
                    RestaurantTableBooking.restaurant_id == restaurant.id,
                    RestaurantTableBooking.guest_email == reservation.guest_email,
                    RestaurantTableBooking.booking_date == payload.booking_date,
                    RestaurantTableBooking.booking_time == payload.booking_time,
                    RestaurantTableBooking.status.in_(["submitted", "confirmed", "seated"]),
                )
            )
            .limit(1)
        )
        if guest_slot:
            raise HTTPException(status_code=409, detail="You already have a booking for this restaurant slot")

    booking = RestaurantTableBooking(
        listing_id=reservation.listing_id,
        restaurant_id=restaurant.id,
        reservation_id=reservation.id,
        guest_email=reservation.guest_email,
        guest_name=reservation.guest_name,
        booking_date=payload.booking_date,
        booking_time=payload.booking_time,
        guests=payload.guests,
        note=payload.note.strip(),
        status="submitted",
    )
    db.add(booking)
    db.flush()
    _emit_restaurant_booking_event(
        db,
        booking=booking,
        event_type=BOOKING_STATUS_EVENT_TYPE["submitted"],
        message=BOOKING_STATUS_MESSAGE["submitted"],
        actor_role="guest",
    )
    db.commit()
    db.refresh(booking)
    return _serialize_restaurant_booking(db, booking)


@router.get("/restaurant-bookings/by-reservation/{reservation_id}", response_model=list[RestaurantTableBookingOut])
def list_restaurant_bookings_for_guest(
    reservation_id: int,
    guest_email: str = Query(...),
    access_token: str = Query(..., min_length=16, max_length=512),
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _ensure_guest_reservation_access(reservation, guest_email, access_token)
    rows = list(
        db.scalars(
            select(RestaurantTableBooking)
            .where(
                and_(
                    RestaurantTableBooking.reservation_id == reservation_id,
                    RestaurantTableBooking.guest_email == reservation.guest_email,
                )
            )
            .order_by(RestaurantTableBooking.id.desc())
        ).all()
    )
    return [_serialize_restaurant_booking(db, row) for row in rows]


@router.get("/restaurant-bookings/mine", response_model=list[RestaurantTableBookingOut])
def list_restaurant_bookings_for_partner(
    status_filter: str | None = Query(default=None, alias="status", pattern="^(submitted|confirmed|seated|completed|cancelled)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = select(RestaurantTableBooking).order_by(RestaurantTableBooking.id.desc())
    if user.role != "admin":
        listing_ids = list(db.scalars(select(Listing.id).where(Listing.owner_id == user.id)).all())
        if not listing_ids:
            return []
        stmt = stmt.where(RestaurantTableBooking.listing_id.in_(listing_ids))
    if status_filter:
        stmt = stmt.where(RestaurantTableBooking.status == status_filter)
    rows = list(db.scalars(stmt).all())
    return [_serialize_restaurant_booking(db, row) for row in rows]


@router.patch("/restaurant-bookings/{booking_id}/status", response_model=RestaurantTableBookingOut)
def update_restaurant_booking_status(
    booking_id: int,
    payload: RestaurantTableBookingStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    booking = db.get(RestaurantTableBooking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Restaurant booking not found")
    listing = db.get(Listing, booking.listing_id)
    _ensure_partner_access_to_listing(listing, user)
    previous_status = booking.status
    booking.status = payload.status
    db.add(booking)
    if previous_status != payload.status:
        event_type, message = _event_payload_from_status(payload.status)
        _emit_restaurant_booking_event(
            db,
            booking=booking,
            event_type=event_type,
            message=message,
            actor_role="partner",
        )
    db.commit()
    db.refresh(booking)
    return _serialize_restaurant_booking(db, booking)


@router.get("/restaurant-bookings/events/by-reservation/{reservation_id}", response_model=list[RestaurantBookingEventOut])
def list_restaurant_booking_events_for_guest(
    reservation_id: int,
    guest_email: str = Query(...),
    access_token: str = Query(..., min_length=16, max_length=512),
    db: Session = Depends(get_db),
):
    reservation = db.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _ensure_guest_reservation_access(reservation, guest_email, access_token)
    rows = list(
        db.scalars(
            select(RestaurantBookingEvent)
            .where(
                and_(
                    RestaurantBookingEvent.reservation_id == reservation_id,
                    RestaurantBookingEvent.guest_email == reservation.guest_email,
                )
            )
            .order_by(RestaurantBookingEvent.id.desc())
        ).all()
    )
    return [_serialize_restaurant_booking_event(row) for row in rows]


@router.get("/restaurant-bookings/events/mine", response_model=list[RestaurantBookingEventOut])
def list_restaurant_booking_events_for_partner(
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    stmt = select(RestaurantBookingEvent).order_by(RestaurantBookingEvent.id.desc())
    if user.role != "admin":
        listing_ids = list(db.scalars(select(Listing.id).where(Listing.owner_id == user.id)).all())
        if not listing_ids:
            return []
        stmt = stmt.where(RestaurantBookingEvent.listing_id.in_(listing_ids))
    rows = list(db.scalars(stmt.limit(200)).all())
    return [_serialize_restaurant_booking_event(row) for row in rows]
