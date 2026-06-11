import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from threading import Lock
from time import monotonic
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.reservation_access import reservation_access_token_matches
from app.db.session import get_db
from app.models.listing import Listing
from app.models.menu_item import MenuItem
from app.models.restaurant import Restaurant, RestaurantBookingEvent, RestaurantTableBooking
from app.models.reservation import Reservation
from app.models.room_service_order import RoomServiceOrder, RoomServiceOrderItem
from app.schemas.ai_concierge import (
    AiConciergeActionOut,
    AiConciergeContextOut,
    AiConciergeMessageIn,
    AiConciergeMessageOut,
)

router = APIRouter(prefix="/ai", tags=["ai_concierge"])
logger = logging.getLogger(__name__)

USD_RATE = 500
ALLOWED_IN_STAY_RESERVATION_STATUSES = {"confirmed", "checked_in"}
ACTIVE_ORDER_STATUSES = {"submitted", "accepted", "preparing"}
ACTIVE_TABLE_STATUSES = {"submitted", "confirmed", "seated"}
OPENAI_DISABLED_TTL_SECONDS = 60.0
OPENAI_QUOTA_DISABLED_TTL_SECONDS = 600.0
TEST_RESTAURANT_PATTERN = re.compile(r"(test|e2e)", re.IGNORECASE)
TRAILING_ID_PATTERN = re.compile(r"\s+\d{6,}$")

_openai_circuit_lock = Lock()
_openai_disabled_until = 0.0


@dataclass
class InStayConciergeContext:
    listing: Listing
    reservation: Reservation | None
    menu: list[MenuItem]
    restaurants: list[Restaurant]
    orders: list[RoomServiceOrder]
    order_items_by_order_id: dict[int, list[RoomServiceOrderItem]]
    table_bookings: list[RestaurantTableBooking]
    booking_events: list[RestaurantBookingEvent]


def _openai_temporarily_unavailable() -> bool:
    with _openai_circuit_lock:
        return monotonic() < _openai_disabled_until


def _trip_openai_circuit(response: httpx.Response) -> None:
    global _openai_disabled_until
    if response.status_code != 429:
        return
    try:
        error = response.json().get("error", {})
    except Exception:
        error = {}
    code = str(error.get("code") or "").lower()
    message = str(error.get("message") or "").lower()
    ttl_seconds = OPENAI_QUOTA_DISABLED_TTL_SECONDS if "insufficient_quota" in code or "quota" in message else OPENAI_DISABLED_TTL_SECONDS
    with _openai_circuit_lock:
        _openai_disabled_until = max(_openai_disabled_until, monotonic() + ttl_seconds)


def _log_openai_http_failure(context: str, response: httpx.Response) -> None:
    _trip_openai_circuit(response)
    logger.warning("OpenAI in-stay concierge %s failed with HTTP %s: %s", context, response.status_code, response.text[:500])


def _normalize_search_text(value: str) -> str:
    return re.sub(r"[^0-9a-zа-я]+", " ", value.lower().replace("ё", "е")).strip()


def _tokenize(value: str) -> list[str]:
    return [token for token in _normalize_search_text(value).split() if len(token) >= 2]


def _score_search(query: str, target: str) -> int:
    normalized_query = _normalize_search_text(query)
    normalized_target = _normalize_search_text(target)
    if not normalized_query or not normalized_target:
        return 0
    if normalized_query in normalized_target:
        return 80 + min(len(normalized_query), 40)
    if normalized_target in normalized_query:
        return 100 + min(len(normalized_target), 50)

    query_tokens = _tokenize(normalized_query)
    target_tokens = _tokenize(normalized_target)
    target_token_set = set(target_tokens)
    score = 0
    for token in query_tokens:
        if token in target_token_set:
            score += 12 if len(token) >= 4 else 6
            continue
        if any(target.startswith(token) or token.startswith(target) for target in target_tokens):
            score += 4
    return score


def _format_price_from_kzt(value: float, currency: str, lang: str) -> str:
    if currency == "USD":
        amount = round(float(value) / USD_RATE)
        return f"${amount}"
    amount = round(float(value))
    return f"{amount:,}".replace(",", " ") + (" KZT" if lang == "en" else " KZT")


def _public_restaurant_name(name: str) -> str:
    normalized = TRAILING_ID_PATTERN.sub("", (name or "").strip())
    if not normalized:
        return "Signature Restaurant"
    if TEST_RESTAURANT_PATTERN.search(normalized):
        return "Signature Restaurant"
    return normalized


def _to_iso_day(value: date) -> str:
    return value.isoformat()


def _parse_clock_time(text: str) -> str | None:
    match = re.search(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b", text)
    if not match:
        return None
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _parse_guest_count(text: str) -> int | None:
    match = re.search(r"\b(\d{1,2})\s*(?:гост|чел|персон|guest|people|person)", text, re.IGNORECASE)
    if not match:
        return None
    return max(1, min(20, int(match.group(1))))


def _parse_quantity(text: str) -> int:
    match = re.search(r"\b(\d{1,2})\b", text)
    if not match:
        return 1
    return max(1, min(9, int(match.group(1))))


def _parse_booking_date(text: str) -> str | None:
    lowered = text.lower()
    today = date.today()
    if re.search(r"\b(today|сегодня)\b", lowered):
        return _to_iso_day(today)
    if re.search(r"\b(tomorrow|завтра)\b", lowered):
        return _to_iso_day(today + timedelta(days=1))

    iso = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if iso:
        try:
            return datetime.strptime(iso.group(1), "%Y-%m-%d").date().isoformat()
        except ValueError:
            return None

    dot = re.search(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b", text)
    if not dot:
        return None
    day = int(dot.group(1))
    month = int(dot.group(2))
    year = int(dot.group(3)) if dot.group(3) else today.year
    try:
        candidate = date(year, month, day)
    except ValueError:
        return None
    if not dot.group(3) and candidate < today:
        candidate = date(year + 1, month, day)
    return candidate.isoformat()


def _action_label(action_type: str, lang: str) -> str:
    if lang == "ru":
        return {
            "add_item": "Добавить в заказ",
            "submit_room_order": "Отправить заказ",
            "submit_draft_order": "Отправить заказ",
            "select_restaurant": "Выбрать ресторан",
            "book_table": "Забронировать столик",
        }.get(action_type, "")
    return {
        "add_item": "Add to order",
        "submit_room_order": "Send order",
        "submit_draft_order": "Send order",
        "select_restaurant": "Select restaurant",
        "book_table": "Book table",
    }.get(action_type, "")


def _room_order_status_label(status: str, lang: str) -> str:
    if lang == "ru":
        return {
            "submitted": "Отправлен",
            "accepted": "Принят",
            "preparing": "Готовится",
            "delivered": "Доставлен",
            "closed": "Закрыт",
            "cancelled": "Отменен",
        }.get(status, status)
    return {
        "submitted": "Submitted",
        "accepted": "Accepted",
        "preparing": "Preparing",
        "delivered": "Delivered",
        "closed": "Closed",
        "cancelled": "Cancelled",
    }.get(status, status)


def _restaurant_booking_status_label(status: str, lang: str) -> str:
    if lang == "ru":
        return {
            "submitted": "Отправлена",
            "confirmed": "Подтверждена",
            "seated": "Гость в ресторане",
            "completed": "Завершена",
            "cancelled": "Отменена",
        }.get(status, status)
    return {
        "submitted": "Submitted",
        "confirmed": "Confirmed",
        "seated": "Seated",
        "completed": "Completed",
        "cancelled": "Cancelled",
    }.get(status, status)


def _load_context(db: Session, payload: AiConciergeMessageIn) -> InStayConciergeContext:
    reservation: Reservation | None = None
    listing_id = payload.listing_id

    if payload.reservation_id is not None:
        if not payload.guest_email:
            raise HTTPException(status_code=400, detail="guest_email is required for reservation context")
        reservation = db.get(Reservation, payload.reservation_id)
        if not reservation:
            raise HTTPException(status_code=404, detail="Reservation not found")
        if reservation.guest_email.lower() != str(payload.guest_email).strip().lower():
            raise HTTPException(status_code=403, detail="Guest email does not match reservation")
        if not reservation_access_token_matches(payload.access_token, reservation.id, reservation.guest_email):
            raise HTTPException(status_code=403, detail="Reservation access token is missing or invalid")
        if reservation.status not in ALLOWED_IN_STAY_RESERVATION_STATUSES:
            raise HTTPException(status_code=409, detail="In-stay concierge is available only for active stays")
        if listing_id is not None and listing_id != reservation.listing_id:
            raise HTTPException(status_code=400, detail="Listing does not match reservation")
        listing_id = reservation.listing_id

    if listing_id is None:
        raise HTTPException(status_code=400, detail="listing_id or reservation_id is required")

    listing = db.get(Listing, listing_id)
    if not listing or not listing.is_active:
        raise HTTPException(status_code=404, detail="Listing not found")

    menu = list(
        db.scalars(
            select(MenuItem)
            .where(and_(MenuItem.listing_id == listing.id, MenuItem.is_active.is_(True)))
            .order_by(MenuItem.sort_order.asc(), MenuItem.id.asc())
            .limit(80)
        ).all()
    )
    restaurants = list(
        db.scalars(
            select(Restaurant)
            .where(and_(Restaurant.listing_id == listing.id, Restaurant.is_active.is_(True)))
            .order_by(Restaurant.id.desc())
            .limit(40)
        ).all()
    )

    orders: list[RoomServiceOrder] = []
    order_items_by_order_id: dict[int, list[RoomServiceOrderItem]] = {}
    table_bookings: list[RestaurantTableBooking] = []
    booking_events: list[RestaurantBookingEvent] = []

    if reservation is not None:
        orders = list(
            db.scalars(
                select(RoomServiceOrder)
                .where(and_(RoomServiceOrder.reservation_id == reservation.id, RoomServiceOrder.guest_email == reservation.guest_email))
                .order_by(RoomServiceOrder.id.desc())
                .limit(12)
            ).all()
        )
        order_ids = [order.id for order in orders]
        if order_ids:
            order_items = list(
                db.scalars(
                    select(RoomServiceOrderItem)
                    .where(RoomServiceOrderItem.order_id.in_(order_ids))
                    .order_by(RoomServiceOrderItem.id.asc())
                ).all()
            )
            for item in order_items:
                order_items_by_order_id.setdefault(item.order_id, []).append(item)

        table_bookings = list(
            db.scalars(
                select(RestaurantTableBooking)
                .where(and_(RestaurantTableBooking.reservation_id == reservation.id, RestaurantTableBooking.guest_email == reservation.guest_email))
                .order_by(RestaurantTableBooking.id.desc())
                .limit(12)
            ).all()
        )
        booking_events = list(
            db.scalars(
                select(RestaurantBookingEvent)
                .where(and_(RestaurantBookingEvent.reservation_id == reservation.id, RestaurantBookingEvent.guest_email == reservation.guest_email))
                .order_by(RestaurantBookingEvent.id.desc())
                .limit(8)
            ).all()
        )

    return InStayConciergeContext(
        listing=listing,
        reservation=reservation,
        menu=menu,
        restaurants=restaurants,
        orders=orders,
        order_items_by_order_id=order_items_by_order_id,
        table_bookings=table_bookings,
        booking_events=booking_events,
    )


def _context_summary(ctx: InStayConciergeContext) -> AiConciergeContextOut:
    return AiConciergeContextOut(
        listing_id=ctx.listing.id,
        reservation_id=ctx.reservation.id if ctx.reservation else None,
        menu_count=len(ctx.menu),
        restaurant_count=len(ctx.restaurants),
        active_order_count=len([row for row in ctx.orders if row.status in ACTIVE_ORDER_STATUSES]),
        active_table_booking_count=len([row for row in ctx.table_bookings if row.status in ACTIVE_TABLE_STATUSES]),
    )


def _menu_for_llm(item: MenuItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "category": item.category,
        "price_kzt": item.price,
    }


def _restaurant_for_llm(item: Restaurant) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": _public_restaurant_name(item.name),
        "aliases": [item.name] if item.name != _public_restaurant_name(item.name) else [],
        "cuisine": item.cuisine,
        "description": item.description,
        "open_from": item.open_from,
        "open_to": item.open_to,
        "avg_check_kzt": item.avg_check_kzt,
    }


def _orders_for_llm(ctx: InStayConciergeContext) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for order in ctx.orders[:8]:
        rows.append(
            {
                "id": order.id,
                "status": order.status,
                "total_price_kzt": order.total_price,
                "delivery_note": order.delivery_note,
                "items": [
                    {"name": item.item_name, "quantity": item.quantity, "line_total_kzt": item.line_total}
                    for item in ctx.order_items_by_order_id.get(order.id, [])
                ],
            }
        )
    return rows


def _table_bookings_for_llm(ctx: InStayConciergeContext) -> list[dict[str, Any]]:
    restaurant_by_id = {row.id: row for row in ctx.restaurants}
    rows: list[dict[str, Any]] = []
    for booking in ctx.table_bookings[:8]:
        restaurant = restaurant_by_id.get(booking.restaurant_id)
        rows.append(
            {
                "id": booking.id,
                "restaurant_id": booking.restaurant_id,
                "restaurant_name": restaurant.name if restaurant else f"Restaurant #{booking.restaurant_id}",
                "booking_date": booking.booking_date.isoformat(),
                "booking_time": booking.booking_time,
                "guests": booking.guests,
                "status": booking.status,
            }
        )
    return rows


def _build_llm_payload(ctx: InStayConciergeContext, payload: AiConciergeMessageIn) -> dict[str, Any]:
    reservation = ctx.reservation
    return {
        "lang": payload.lang,
        "currency": payload.currency,
        "message": payload.message,
        "history": [row.model_dump() for row in payload.history[-8:]],
        "listing": {
            "id": ctx.listing.id,
            "title": ctx.listing.title,
            "city": ctx.listing.city,
            "district": ctx.listing.district,
            "property_type": ctx.listing.property_type,
        },
        "reservation": {
            "id": reservation.id,
            "check_in": reservation.check_in.isoformat(),
            "check_out": reservation.check_out.isoformat(),
            "guests": reservation.guests,
            "status": reservation.status,
        }
        if reservation
        else None,
        "menu": [_menu_for_llm(item) for item in ctx.menu[:40]],
        "restaurants": [_restaurant_for_llm(item) for item in ctx.restaurants[:24]],
        "room_service_orders": _orders_for_llm(ctx),
        "table_bookings": _table_bookings_for_llm(ctx),
        "draft_items": payload.draft_items,
        "action_contract": {
            "type": "One of add_item, submit_room_order, submit_draft_order, select_restaurant, book_table, none.",
            "item_id": "Required only for add_item and submit_room_order; must be an id from menu.",
            "restaurant_id": "Required only for select_restaurant and book_table; must be an id from restaurants.",
            "quantity": "1..9 for submit_room_order.",
            "booking_date": "YYYY-MM-DD for book_table.",
            "booking_time": "HH:MM for book_table.",
            "guests": "1..20 for book_table.",
        },
    }


def _extract_response_text(payload: dict[str, Any]) -> str | None:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    for output_item in payload.get("output") or []:
        if not isinstance(output_item, dict):
            continue
        for content in output_item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"].strip()
    return None


def _sanitize_follow_ups(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned = [item.strip()[:90] for item in value if isinstance(item, str) and item.strip()]
    return cleaned[:4]


def _sanitize_action(raw: dict[str, Any], ctx: InStayConciergeContext, lang: str, fallback_note: str) -> AiConciergeActionOut | None:
    action_type = str(raw.get("action_type") or raw.get("type") or "none").strip()
    if action_type == "none":
        return None

    menu_ids = {item.id for item in ctx.menu}
    restaurant_ids = {item.id for item in ctx.restaurants}
    label = str(raw.get("action_label") or raw.get("label") or _action_label(action_type, lang)).strip()
    note = str(raw.get("note") or fallback_note).strip()[:500] or None

    if action_type == "add_item":
        item_id = _coerce_int(raw.get("item_id"))
        if item_id not in menu_ids:
            return None
        return AiConciergeActionOut(type="add_item", item_id=item_id, label=label or _action_label(action_type, lang))

    if action_type == "submit_room_order":
        item_id = _coerce_int(raw.get("item_id"))
        if item_id not in menu_ids:
            return None
        quantity = max(1, min(9, _coerce_int(raw.get("quantity")) or 1))
        return AiConciergeActionOut(
            type="submit_room_order",
            item_id=item_id,
            quantity=quantity,
            note=note,
            label=label or _action_label(action_type, lang),
        )

    if action_type == "submit_draft_order":
        return AiConciergeActionOut(type="submit_draft_order", note=note, label=label or _action_label(action_type, lang))

    if action_type == "select_restaurant":
        restaurant_id = _coerce_int(raw.get("restaurant_id"))
        if restaurant_id not in restaurant_ids:
            return None
        return AiConciergeActionOut(
            type="select_restaurant",
            restaurant_id=restaurant_id,
            label=label or _action_label(action_type, lang),
        )

    if action_type == "book_table":
        restaurant_id = _coerce_int(raw.get("restaurant_id"))
        if restaurant_id not in restaurant_ids:
            return None
        booking_date = str(raw.get("booking_date") or "").strip()
        booking_time = str(raw.get("booking_time") or "").strip()
        if not _valid_iso_date(booking_date):
            booking_date = _to_iso_day(date.today() + timedelta(days=1))
        if not re.fullmatch(r"\d{2}:\d{2}", booking_time):
            booking_time = "19:00"
        guests = max(1, min(20, _coerce_int(raw.get("guests")) or (ctx.reservation.guests if ctx.reservation else 2)))
        return AiConciergeActionOut(
            type="book_table",
            restaurant_id=restaurant_id,
            booking_date=booking_date,
            booking_time=booking_time,
            guests=guests,
            note=note,
            label=label or _action_label(action_type, lang),
        )

    return None


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _valid_iso_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _llm_concierge_reply(ctx: InStayConciergeContext, payload: AiConciergeMessageIn) -> tuple[str, AiConciergeActionOut | None, list[str]] | None:
    if not settings.openai_api_key or _openai_temporarily_unavailable():
        return None

    system_prompt = (
        "You are StayPilot in-stay AI concierge for hotel guests. "
        "Answer naturally in the requested language. Use only supplied listing, reservation, menu, restaurants, and request status data. "
        "You can propose a safe UI action, but the frontend will ask the guest to confirm before executing it. "
        "Never claim that an order or booking has been completed unless the context already contains it. "
        "If a requested menu item or restaurant is missing, say so and suggest available options. "
        "Return strict JSON only with keys: answer, action_type, action_label, item_id, restaurant_id, quantity, booking_date, booking_time, guests, note, follow_up_prompts. "
        "Use action_type none when no concrete action is ready."
    )
    try:
        with httpx.Client(timeout=settings.openai_chat_timeout_seconds) as client:
            response = client.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_chat_model,
                    "instructions": system_prompt,
                    "input": "Return JSON for this in-stay concierge payload:\n"
                    + json.dumps(_build_llm_payload(ctx, payload), ensure_ascii=False),
                    "temperature": 0.25,
                    "max_output_tokens": 700,
                    "text": {"format": {"type": "json_object"}},
                    "store": False,
                },
            )
        if response.status_code >= 400:
            _log_openai_http_failure("reply", response)
            return None
        response_text = _extract_response_text(response.json())
        if not response_text:
            return None
        parsed = json.loads(response_text)
        if not isinstance(parsed, dict):
            return None
        answer = parsed.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            return None
        return answer.strip(), _sanitize_action(parsed, ctx, payload.lang, payload.message), _sanitize_follow_ups(parsed.get("follow_up_prompts"))
    except Exception:
        logger.exception("OpenAI in-stay concierge reply failed")
        return None


def _find_menu_candidate(ctx: InStayConciergeContext, message: str) -> MenuItem | None:
    scored = sorted(
        (
            (item, _score_search(message, f"{item.name} {item.description or ''} {item.category or ''}"))
            for item in ctx.menu
        ),
        key=lambda pair: pair[1],
        reverse=True,
    )
    if scored and scored[0][1] >= 10:
        return scored[0][0]
    normalized = _normalize_search_text(message)
    keyword_groups = [
        ("burger", "бургер"),
        ("pizza", "пицца", "пиц"),
        ("coffee", "кофе"),
        ("breakfast", "завтрак"),
        ("salad", "салат"),
        ("steak", "стейк"),
        ("soup", "суп"),
    ]
    for group in keyword_groups:
        if not any(token in normalized for token in group):
            continue
        for item in ctx.menu:
            target = _normalize_search_text(f"{item.name} {item.description or ''} {item.category or ''}")
            if any(token in target for token in group):
                return item
    return None


def _find_restaurant_candidate(ctx: InStayConciergeContext, message: str) -> Restaurant | None:
    scored = sorted(
        (
            (item, _score_search(message, f"{item.name} {item.cuisine or ''} {item.description or ''}"))
            for item in ctx.restaurants
        ),
        key=lambda pair: pair[1],
        reverse=True,
    )
    return scored[0][0] if scored and scored[0][1] >= 10 else None


def _describe_menu(ctx: InStayConciergeContext, lang: str, currency: str) -> str:
    if not ctx.menu:
        return "Меню пока недоступно." if lang == "ru" else "The menu is not available yet."
    rows = [f"• {item.name} — {_format_price_from_kzt(item.price, currency, lang)}" for item in ctx.menu[:5]]
    return ("В меню сейчас:\n" if lang == "ru" else "Available menu now:\n") + "\n".join(rows)


def _describe_restaurants(ctx: InStayConciergeContext, lang: str, currency: str) -> str:
    if not ctx.restaurants:
        return (
            "Рестораны пока не подключены, но могу помочь с заказом в номер."
            if ctx.menu and lang == "ru"
            else "Restaurants are not connected yet, but I can help with room service."
            if ctx.menu
            else "Пока не вижу подключенных in-stay сервисов." if lang == "ru" else "I do not see connected in-stay services yet."
        )
    rows = [
        f"• {_public_restaurant_name(item.name)} — {item.cuisine}, {_format_price_from_kzt(item.avg_check_kzt, currency, lang)}, {item.open_from}-{item.open_to}"
        for item in ctx.restaurants[:5]
    ]
    return ("Доступные рестораны отеля:\n" if lang == "ru" else "Available hotel restaurants:\n") + "\n".join(rows)


def _describe_status(ctx: InStayConciergeContext, lang: str, currency: str) -> str:
    lines: list[str] = []
    for order in ctx.orders[:3]:
        items = ", ".join(f"{item.item_name} x{item.quantity}" for item in ctx.order_items_by_order_id.get(order.id, []))
        lines.append(f"• Room service #{order.id}: {_room_order_status_label(order.status, lang)}, {_format_price_from_kzt(order.total_price, currency, lang)} — {items}")
    restaurant_by_id = {row.id: row for row in ctx.restaurants}
    for booking in ctx.table_bookings[:3]:
        restaurant = restaurant_by_id.get(booking.restaurant_id)
        name = restaurant.name if restaurant else f"Restaurant #{booking.restaurant_id}"
        if lang == "ru":
            lines.append(f"• Столик #{booking.id}: {name}, {booking.booking_date.isoformat()} {booking.booking_time}, {_restaurant_booking_status_label(booking.status, lang)}")
        else:
            lines.append(f"• Table #{booking.id}: {name}, {booking.booking_date.isoformat()} {booking.booking_time}, {_restaurant_booking_status_label(booking.status, lang)}")
    if not lines:
        return (
            "Пока нет активных заявок. Могу собрать заказ в номер или забронировать столик."
            if lang == "ru"
            else "No active requests yet. I can build a room-service order or reserve a table."
        )
    return ("По этой брони сейчас вижу:\n" if lang == "ru" else "For this reservation I can see:\n") + "\n".join(lines)


def _fallback_reply(ctx: InStayConciergeContext, payload: AiConciergeMessageIn) -> tuple[str, AiConciergeActionOut | None, list[str]]:
    message = payload.message.strip()
    low = message.lower()
    lang = payload.lang
    currency = payload.currency
    menu_intent = any(token in low for token in ["меню", "блюда", "позиции", "что есть", "menu", "dish", "dishes"])
    food_intent = any(token in low for token in ["еда", "поесть", "бургер", "pizza", "пиц", "food", "order", "закаж", "заказать", "room service"])
    table_intent = any(token in low for token in ["столик", "ресторан", "ужин", "reserve", "table", "restaurant"])
    restaurant_list_intent = bool(re.search(r"(какие|покажи|список|есть|available|show|list).*(ресторан|restaurant)|\brestaurants\b", low))
    status_intent = bool(re.search(r"статус|заявк|истори|где.*заказ|мой заказ|мои заказы|status|history|request|where.*order", low))
    transfer_intent = any(token in low for token in ["трансфер", "такси", "аэропорт", "transfer", "taxi", "airport", "shuttle"])
    direct_food_order_intent = bool(re.search(r"закаж|заказать|оформи|принес|принеси|достав|в\s+номер|room service|order|bring|deliver|send", low))
    direct_table_booking_intent = bool(re.search(r"заброни|бронь|зарезерв|reserve|book", low))

    if status_intent:
        return _describe_status(ctx, lang, currency), None, _follow_ups(ctx, lang)

    if transfer_intent:
        answer = (
            "Трансфер пока не подключен к API. Сейчас могу помочь с рестораном отеля или заказом в номер."
            if lang == "ru"
            else "Transfer is not connected to the API yet. I can help with hotel restaurants or room service now."
        )
        return answer, None, _follow_ups(ctx, lang)

    if restaurant_list_intent and not direct_table_booking_intent:
        first = ctx.restaurants[0] if ctx.restaurants else None
        action = (
            AiConciergeActionOut(type="select_restaurant", restaurant_id=first.id, label=_action_label("select_restaurant", lang))
            if first
            else None
        )
        return _describe_restaurants(ctx, lang, currency), action, _follow_ups(ctx, lang)

    if menu_intent:
        first = ctx.menu[0] if ctx.menu else None
        action = AiConciergeActionOut(type="add_item", item_id=first.id, label=_action_label("add_item", lang)) if first else None
        return _describe_menu(ctx, lang, currency), action, _follow_ups(ctx, lang)

    if food_intent:
        if not ctx.menu:
            answer = (
                "Сейчас меню недоступно. Если рестораны подключены, могу забронировать столик."
                if lang == "ru"
                else "Menu is unavailable right now. If restaurants are connected, I can reserve a table instead."
            )
            action = (
                AiConciergeActionOut(type="select_restaurant", restaurant_id=ctx.restaurants[0].id, label=_action_label("select_restaurant", lang))
                if ctx.restaurants
                else None
            )
            return answer, action, _follow_ups(ctx, lang)
        candidate = _find_menu_candidate(ctx, message)
        if not candidate:
            answer = (
                f"Не вижу такую позицию в меню. {_describe_menu(ctx, lang, currency)}"
                if lang == "ru"
                else f"I do not see that item on the menu. {_describe_menu(ctx, lang, currency)}"
            )
            return answer, None, _follow_ups(ctx, lang)
        quantity = _parse_quantity(low)
        if direct_food_order_intent:
            answer = (
                f"Нашел {candidate.name} — {_format_price_from_kzt(candidate.price, currency, lang)}. Могу отправить заказ x{quantity} персоналу."
                if lang == "ru"
                else f"I found {candidate.name} — {_format_price_from_kzt(candidate.price, currency, lang)}. I can send order x{quantity} to staff."
            )
            action = AiConciergeActionOut(
                type="submit_room_order",
                item_id=candidate.id,
                quantity=quantity,
                note=message,
                label=_action_label("submit_room_order", lang),
            )
            return answer, action, _follow_ups(ctx, lang)
        answer = (
            f"Есть вариант: {candidate.name} — {_format_price_from_kzt(candidate.price, currency, lang)}. Добавить в заказ?"
            if lang == "ru"
            else f"I found this option: {candidate.name} — {_format_price_from_kzt(candidate.price, currency, lang)}. Add to order?"
        )
        return answer, AiConciergeActionOut(type="add_item", item_id=candidate.id, label=_action_label("add_item", lang)), _follow_ups(ctx, lang)

    if table_intent:
        if not ctx.restaurants:
            return _describe_restaurants(ctx, lang, currency), None, _follow_ups(ctx, lang)
        restaurant = _find_restaurant_candidate(ctx, message) or ctx.restaurants[0]
        restaurant_display_name = _public_restaurant_name(restaurant.name)
        booking_date = _parse_booking_date(message) or (ctx.reservation.check_in.isoformat() if ctx.reservation else _to_iso_day(date.today() + timedelta(days=1)))
        booking_time = _parse_clock_time(message) or "19:00"
        guests = _parse_guest_count(message) or (ctx.reservation.guests if ctx.reservation else 2)
        if direct_table_booking_intent:
            answer = (
                f"Выбрал {restaurant_display_name}: {booking_date} в {booking_time}, гостей: {guests}. Могу отправить бронь в отель."
                if lang == "ru"
                else f"I selected {restaurant_display_name}: {booking_date} at {booking_time}, guests: {guests}. I can send the table request to the hotel."
            )
            action = AiConciergeActionOut(
                type="book_table",
                restaurant_id=restaurant.id,
                booking_date=booking_date,
                booking_time=booking_time,
                guests=guests,
                note="Создано через AI-консьержа" if lang == "ru" else "Created by AI concierge",
                label=_action_label("book_table", lang),
            )
            return answer, action, _follow_ups(ctx, lang)
        answer = (
            f"Подойдет {restaurant_display_name}. Средний чек {_format_price_from_kzt(restaurant.avg_check_kzt, currency, lang)}. Выбрать его для брони?"
            if lang == "ru"
            else f"{restaurant_display_name} looks good. Average check is {_format_price_from_kzt(restaurant.avg_check_kzt, currency, lang)}. Use it for booking?"
        )
        action = AiConciergeActionOut(type="select_restaurant", restaurant_id=restaurant.id, label=_action_label("select_restaurant", lang))
        return answer, action, _follow_ups(ctx, lang)

    if ctx.menu and ctx.restaurants:
        answer = (
            "Могу собрать заказ в номер или забронировать столик в ресторане. Что выберем?"
            if lang == "ru"
            else "I can build a room-service order or reserve a restaurant table. Which one should we do?"
        )
    elif ctx.menu:
        answer = (
            "Рестораны пока не подключены, зато room service доступен. Могу показать меню или добавить блюдо в заказ."
            if lang == "ru"
            else "Restaurants are not connected yet, but room service is available. I can show the menu or add an item to your order."
        )
    elif ctx.restaurants:
        answer = (
            "Меню room service пока недоступно, но могу забронировать столик в ресторане отеля."
            if lang == "ru"
            else "Room-service menu is unavailable, but I can reserve a table at the hotel restaurant."
        )
    else:
        answer = (
            "Пока не вижу подключенных in-stay сервисов для этого объекта."
            if lang == "ru"
            else "I do not see connected in-stay services for this property yet."
        )
    return answer, None, _follow_ups(ctx, lang)


def _follow_ups(ctx: InStayConciergeContext, lang: str) -> list[str]:
    if lang == "ru":
        prompts = []
        if ctx.menu:
            prompts.append("Что есть в меню?")
            prompts.append("Хочу бургер")
        if ctx.restaurants:
            prompts.append("Забронируй столик на 19:00")
        if ctx.orders or ctx.table_bookings:
            prompts.append("Покажи статус заявок")
        return prompts[:4]
    prompts = []
    if ctx.menu:
        prompts.append("What is on the menu?")
        prompts.append("I want a burger")
    if ctx.restaurants:
        prompts.append("Reserve a table at 19:00")
    if ctx.orders or ctx.table_bookings:
        prompts.append("Show request status")
    return prompts[:4]


@router.post("/in-stay/concierge", response_model=AiConciergeMessageOut)
def in_stay_concierge(payload: AiConciergeMessageIn, db: Session = Depends(get_db)):
    ctx = _load_context(db, payload)
    llm_result = _llm_concierge_reply(ctx, payload)
    if llm_result is not None:
        answer, action, follow_ups = llm_result
        return AiConciergeMessageOut(
            mode="openai",
            answer=answer,
            action=action,
            follow_up_prompts=follow_ups or _follow_ups(ctx, payload.lang),
            context=_context_summary(ctx),
        )

    answer, action, follow_ups = _fallback_reply(ctx, payload)
    return AiConciergeMessageOut(
        mode="fallback",
        answer=answer,
        action=action,
        follow_up_prompts=follow_ups,
        context=_context_summary(ctx),
    )
