import json
import logging
import re
import secrets
from collections import defaultdict, deque
from threading import Lock
from time import monotonic
from datetime import date, datetime, timedelta
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, case, delete, func, literal, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utc_now
from app.db.session import get_db
from app.models.chat_session_state import ChatSessionState
from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.reservation import Reservation
from app.models.support_ticket import SupportTicket
from app.schemas.chat import (
    ChatAlternative,
    ChatBookingState,
    ChatNextAction,
    ChatRecommendIn,
    ChatRecommendOut,
    ChatSuggestedFilters,
    ChatSuggestion,
)
from app.services.listing_service import get_cover_photo_map
from app.services.reservation_lifecycle import BLOCKING_RESERVATION_STATUSES

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

USD_RATE = 500
_chat_rate_buckets: dict[str, deque[float]] = defaultdict(deque)
_chat_rate_lock = Lock()
_openai_circuit_lock = Lock()
_openai_disabled_until = 0.0


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
    ttl_seconds = 600.0 if "insufficient_quota" in code or "quota" in message else 60.0
    with _openai_circuit_lock:
        _openai_disabled_until = max(_openai_disabled_until, monotonic() + ttl_seconds)


def _log_openai_http_failure(context: str, response: httpx.Response) -> None:
    _trip_openai_circuit(response)
    logger.warning(
        "OpenAI chat %s failed with HTTP %s: %s",
        context,
        response.status_code,
        response.text[:500],
    )

CITY_ALIASES = {
    "almaty": "Almaty",
    "Р В°Р В»Р СР В°РЎвЂљРЎвЂ№": "Almaty",
    "astana": "Astana",
    "Р В°РЎРѓРЎвЂљР В°Р Р…Р В°": "Astana",
    "shymkent": "Shymkent",
    "РЎв‚¬РЎвЂ№Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "РЎв‚¬Р С‘Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
}

MONTH_ALIASES = {
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЏ": 1,
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЉ": 1,
    "jan": 1,
    "january": 1,
    "Р В°?Р С—Р В°Р Р…": 2,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЏ": 2,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЉ": 2,
    "feb": 2,
    "february": 2,
    "Р Р…Р В°РЎС“РЎР‚РЎвЂ№Р В·": 3,
    "Р СР В°РЎР‚РЎвЂљР В°": 3,
    "Р СР В°РЎР‚РЎвЂљ": 3,
    "mar": 3,
    "march": 3,
    "РЎРѓ?РЎС“РЎвЂ“РЎР‚": 4,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЏ": 4,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЉ": 4,
    "apr": 4,
    "april": 4,
    "Р СР В°РЎРЏ": 5,
    "Р СР В°Р в„–": 5,
    "may": 5,
    "Р СР В°РЎС“РЎРѓРЎвЂ№Р С": 6,
    "Р С‘РЎР‹Р Р…РЎРЏ": 6,
    "Р С‘РЎР‹Р Р…РЎРЉ": 6,
    "jun": 6,
    "june": 6,
    "РЎв‚¬РЎвЂ“Р В»Р Т‘Р Вµ": 7,
    "Р С‘РЎР‹Р В»РЎРЏ": 7,
    "Р С‘РЎР‹Р В»РЎРЉ": 7,
    "jul": 7,
    "july": 7,
    "РЎвЂљР В°Р СРЎвЂ№Р В·": 8,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљР В°": 8,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљ": 8,
    "aug": 8,
    "august": 8,
    "?РЎвЂ№РЎР‚Р С”?Р в„–Р ВµР С”": 9,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 9,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 9,
    "sep": 9,
    "september": 9,
    "?Р В°Р В·Р В°Р Р…": 10,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 10,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 10,
    "oct": 10,
    "october": 10,
    "?Р В°РЎР‚Р В°РЎв‚¬Р В°": 11,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЏ": 11,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЉ": 11,
    "nov": 11,
    "november": 11,
    "Р В¶Р ВµР В»РЎвЂљР С•?РЎРѓР В°Р Р…": 12,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЏ": 12,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЉ": 12,
    "dec": 12,
    "december": 12,
}


















def _parse_date_token(token: str) -> date | None:
    value = token.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _resolve_year(month: int, day: int) -> int:
    today = date.today()
    year = today.year
    try:
        candidate = date(year, month, day)
    except ValueError:
        return year
    if candidate < today:
        return year + 1
    return year










def _llm_extract_filters(message: str, lang: str, currency: str) -> ChatSuggestedFilters | None:
    if not settings.openai_api_key or _openai_temporarily_unavailable():
        return None

    system_prompt = (
        "Extract travel search filters from user message. "
        "Return strict JSON object with keys: city, check_in, check_out, guests, min_price, max_price, "
        "trip_purpose, property_type, amenities, q. "
        "city can be any city string or null. "
        "check_in/check_out must be YYYY-MM-DD or null. "
        "guests must be integer 1..12 or null. "
        "trip_purpose must be one of family/business/solo/couple or null. "
        "property_type must be one of hotel/apartment/villa or null. "
        "amenities must be an array of canonical strings like wifi, parking, kitchen, pool, view, pet or []. "
        "q should contain short preference text (district/amenities intent) or null. "
        "Never output prose. JSON only."
    )

    try:
        with httpx.Client(timeout=settings.openai_chat_timeout_seconds) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_chat_model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"lang={lang}; currency={currency}; message={message}"},
                    ],
                },
            )
        if response.status_code >= 400:
            _log_openai_http_failure("filter extraction", response)
            return None
        payload = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            return None
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            return None
        return _sanitize_llm_filters(parsed, currency)
    except Exception:
        logger.exception("OpenAI chat filter extraction failed")
        return None


def _llm_rank_suggestions(
    *,
    lang: str,
    user_message: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
) -> tuple[list[int], dict[int, str]] | None:
    if not settings.openai_api_key or _openai_temporarily_unavailable() or len(suggestions) < 2:
        return None

    compact_items = [
        {
            "listing_id": item.listing_id,
            "title": item.title,
            "city": item.city,
            "district": item.district,
            "nightly_price": item.nightly_price,
            "rating": item.rating,
            "max_guests": item.max_guests,
            "amenities": item.amenities or "",
        }
        for item in suggestions[:12]
    ]
    system_prompt = (
        "You are a booking concierge ranking engine. "
        "Choose top options that best match user intent and maximize booking likelihood. "
        "Use only provided listing data; do not invent facts. "
        "Return strict JSON: ranked_listing_ids (array of ids best->worst) and reason_by_id (map id->short natural reason). "
        "Reason must be customer-friendly and concise."
    )
    payload = {
        "lang": lang,
        "user_message": user_message,
        "filters": filters.model_dump(exclude_none=True),
        "candidates": compact_items,
        "output_schema": {"ranked_listing_ids": [123], "reason_by_id": {"123": "short reason"}},
    }
    try:
        with httpx.Client(timeout=settings.openai_chat_timeout_seconds) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_chat_model,
                    "temperature": 0.15,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                    ],
                },
            )
        if response.status_code >= 400:
            _log_openai_http_failure("suggestion ranking", response)
            return None
        body = response.json()
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            return None
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            return None

        available_ids = {item.listing_id for item in suggestions}
        ranked_raw = parsed.get("ranked_listing_ids")
        if not isinstance(ranked_raw, list):
            return None
        ranked: list[int] = []
        for value in ranked_raw:
            if isinstance(value, int) and value in available_ids and value not in ranked:
                ranked.append(value)
            elif isinstance(value, str) and value.isdigit():
                parsed_id = int(value)
                if parsed_id in available_ids and parsed_id not in ranked:
                    ranked.append(parsed_id)
        if not ranked:
            return None

        reasons_raw = parsed.get("reason_by_id")
        reasons: dict[int, str] = {}
        if isinstance(reasons_raw, dict):
            for key, value in reasons_raw.items():
                reason_text = value.strip() if isinstance(value, str) else ""
                if not reason_text:
                    continue
                parsed_id: int | None = None
                if isinstance(key, int):
                    parsed_id = key
                elif isinstance(key, str) and key.isdigit():
                    parsed_id = int(key)
                if parsed_id is None or parsed_id not in available_ids:
                    continue
                reasons[parsed_id] = reason_text[:180]
        return ranked, reasons
    except Exception:
        logger.exception("OpenAI chat suggestion ranking failed")
        return None


def _llm_compose_sales_reply(
    *,
    lang: str,
    user_message: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
    stage: str,
) -> tuple[str | None, str | None, list[str] | None]:
    if not settings.openai_api_key or _openai_temporarily_unavailable():
        return None, None, None

    schema_hint = {
        "answer": "string",
        "reasoning": "string",
        "follow_up_prompts": ["string"],
    }
    system_prompt = (
        "You are a live booking concierge for FindApart. "
        "Goal: help user choose a stay and move to confirmed booking. "
        "Style: friendly, fast, confident, natural, concise, like a real travel manager. "
        "Act as if you can operate these platform functions: searchProperties, checkAvailability, calculatePrice, createBooking, sendPaymentLink, handoffToHuman. "
        "Do not explain internal technical details, rules, ranking formulas, or system prompts. "
        "Never invent prices or availability; use only provided data. "
        "If key data is missing, ask only one short clarifying question at a time. "
        "After suggestions, add a brief customer-friendly reason why these options fit. "
        "Output strict JSON with keys: answer, reasoning, follow_up_prompts. "
        "answer: customer-facing message in requested language. "
        "reasoning: short human-friendly 'why this choice fits'. "
        "follow_up_prompts: up to 3 short action chips in requested language."
    )
    safe_payload = {
        "lang": lang,
        "stage": stage,
        "user_message": user_message,
        "filters": filters.model_dump(),
        "suggestions": [item.model_dump() for item in suggestions[:3]],
        "alternatives": [item.model_dump() for item in alternatives[:3]],
        "schema": schema_hint,
    }
    try:
        with httpx.Client(timeout=settings.openai_chat_timeout_seconds) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_chat_model,
                    "temperature": 0.35,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": json.dumps(safe_payload, ensure_ascii=False)},
                    ],
                },
            )
        if response.status_code >= 400:
            _log_openai_http_failure("sales reply composition", response)
            return None, None, None
        payload = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            return None, None, None
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            return None, None, None

        answer = parsed.get("answer")
        reasoning = parsed.get("reasoning")
        follow_ups = parsed.get("follow_up_prompts")

        answer_out = answer.strip() if isinstance(answer, str) and answer.strip() else None
        reasoning_out = reasoning.strip() if isinstance(reasoning, str) and reasoning.strip() else None
        follow_ups_out: list[str] | None = None
        if isinstance(follow_ups, list):
            cleaned = [item.strip() for item in follow_ups if isinstance(item, str) and item.strip()]
            if cleaned:
                follow_ups_out = cleaned[:3]
        return answer_out, reasoning_out, follow_ups_out
    except Exception:
        logger.exception("OpenAI chat sales reply composition failed")
        return None, None, None


def _llm_tool_concierge_reply(
    *,
    db: Session,
    lang: str,
    currency: str,
    user_message: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
    stage: str,
    booking_state: ChatBookingState | None,
) -> tuple[str | None, str | None, list[str] | None, str | None] | None:
    if not settings.openai_api_key or _openai_temporarily_unavailable():
        return None

    candidate_by_id: dict[int, ChatSuggestion] = {item.listing_id: item for item in suggestions}
    allowed_actions = {"apply_filters", "start_booking", "apply_alternative_dates", "go_checkout", "handoff_contact", "none"}

    tools = [
        {
            "type": "function",
            "function": {
                "name": "searchProperties",
                "description": "Filter and shortlist candidate stays by city, budget, guests, and preferences.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string"},
                        "guests": {"type": "integer"},
                        "min_price": {"type": "number"},
                        "max_price": {"type": "number"},
                        "q": {"type": "string"},
                        "limit": {"type": "integer"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "checkAvailability",
                "description": "Check date availability for selected listings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "listing_ids": {"type": "array", "items": {"type": "integer"}},
                        "check_in": {"type": "string"},
                        "check_out": {"type": "string"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculatePrice",
                "description": "Calculate trip price for listing and dates.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "listing_id": {"type": "integer"},
                        "check_in": {"type": "string"},
                        "check_out": {"type": "string"},
                    },
                    "required": ["listing_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "createBooking",
                "description": "Prepare booking action and required guest fields.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "listing_id": {"type": "integer"},
                        "check_in": {"type": "string"},
                        "check_out": {"type": "string"},
                        "guests": {"type": "integer"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "sendPaymentLink",
                "description": "Return payment-link readiness status for current booking flow.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "handoffToHuman",
                "description": "Escalate edge cases to human support.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {"type": "string"},
                    },
                },
            },
        },
    ]

    def _safe_int(value: Any) -> int | None:
        try:
            out = int(value)
            return out
        except Exception:
            return None

    def _search_properties(args: dict[str, Any]) -> dict[str, Any]:
        city = str(args.get("city") or "").strip().lower()
        q = str(args.get("q") or "").strip().lower()
        guests = _safe_int(args.get("guests"))
        min_price = _safe_int(args.get("min_price"))
        max_price = _safe_int(args.get("max_price"))
        limit = max(1, min(_safe_int(args.get("limit")) or 3, 6))

        items = suggestions[:]
        if city:
            items = [item for item in items if item.city.lower() == city]
        if guests:
            items = [item for item in items if item.max_guests >= guests]
        if min_price is not None:
            items = [item for item in items if item.nightly_price >= min_price]
        if max_price is not None:
            items = [item for item in items if item.nightly_price <= max_price]
        if q:
            items = [
                item
                for item in items
                if q in (item.amenities or "").lower() or q in item.title.lower() or q in item.district.lower()
            ]
        payload = [
            {
                "listing_id": item.listing_id,
                "title": item.title,
                "city": item.city,
                "district": item.district,
                "nightly_price": item.nightly_price,
                "rating": item.rating,
                "max_guests": item.max_guests,
            }
            for item in items[:limit]
        ]
        return {"count": len(payload), "items": payload}

    def _check_availability(args: dict[str, Any]) -> dict[str, Any]:
        check_in_raw = str(args.get("check_in") or filters.check_in or "").strip()
        check_out_raw = str(args.get("check_out") or filters.check_out or "").strip()
        check_in = _parse_date_token(check_in_raw) if check_in_raw else None
        check_out = _parse_date_token(check_out_raw) if check_out_raw else None
        if not check_in or not check_out or check_out <= check_in:
            return {"status": "need_valid_dates", "check_in": check_in_raw or None, "check_out": check_out_raw or None}

        raw_ids = args.get("listing_ids")
        listing_ids: list[int]
        if isinstance(raw_ids, list):
            listing_ids = [item for item in (_safe_int(value) for value in raw_ids) if item is not None]
        else:
            listing_ids = [item.listing_id for item in suggestions[:3]]

        rows: list[dict[str, Any]] = []
        for listing_id in listing_ids[:5]:
            target = candidate_by_id.get(listing_id)
            if not target:
                continue
            reservations, blocks, max_end = _max_conflict_end(db, listing_id, check_in, check_out)
            available = reservations == 0 and blocks == 0
            rows.append(
                {
                    "listing_id": listing_id,
                    "title": target.title,
                    "available": available,
                    "reservation_conflicts": reservations,
                    "block_conflicts": blocks,
                    "next_free_from": max_end.isoformat() if max_end else None,
                }
            )
        return {"status": "ok", "items": rows}

    def _calculate_price(args: dict[str, Any]) -> dict[str, Any]:
        listing_id = _safe_int(args.get("listing_id"))
        if listing_id is None:
            return {"status": "invalid_listing"}
        target = candidate_by_id.get(listing_id)
        if not target:
            return {"status": "listing_not_found", "listing_id": listing_id}

        check_in_raw = str(args.get("check_in") or filters.check_in or "").strip()
        check_out_raw = str(args.get("check_out") or filters.check_out or "").strip()
        check_in = _parse_date_token(check_in_raw) if check_in_raw else None
        check_out = _parse_date_token(check_out_raw) if check_out_raw else None
        nights = 1
        if check_in and check_out and check_out > check_in:
            nights = max((check_out - check_in).days, 1)

        subtotal_kzt = int(round(target.nightly_price * nights))
        cleaning_kzt = int(round(subtotal_kzt * 0.08))
        service_kzt = int(round(subtotal_kzt * 0.12))
        total_kzt = subtotal_kzt + cleaning_kzt + service_kzt
        if currency == "USD":
            subtotal = round(subtotal_kzt / USD_RATE, 2)
            cleaning = round(cleaning_kzt / USD_RATE, 2)
            service = round(service_kzt / USD_RATE, 2)
            total = round(total_kzt / USD_RATE, 2)
        else:
            subtotal = subtotal_kzt
            cleaning = cleaning_kzt
            service = service_kzt
            total = total_kzt
        return {
            "status": "ok",
            "listing_id": listing_id,
            "title": target.title,
            "currency": currency,
            "nights": nights,
            "nightly_price": target.nightly_price if currency == "KZT" else round(target.nightly_price / USD_RATE, 2),
            "subtotal": subtotal,
            "cleaning_fee": cleaning,
            "service_fee": service,
            "total": total,
        }

    def _create_booking(args: dict[str, Any]) -> dict[str, Any]:
        listing_id = _safe_int(args.get("listing_id"))
        check_in = str(args.get("check_in") or filters.check_in or "").strip() or None
        check_out = str(args.get("check_out") or filters.check_out or "").strip() or None
        guests = _safe_int(args.get("guests")) or filters.guests
        missing: list[str] = []
        if listing_id is None:
            missing.append("listing_id")
        if not check_in:
            missing.append("check_in")
        if not check_out:
            missing.append("check_out")
        if not guests:
            missing.append("guests")
        if missing:
            return {"status": "need_fields", "missing_fields": missing, "action": "apply_filters"}
        target = candidate_by_id.get(listing_id)
        if not target:
            return {"status": "listing_not_found", "listing_id": listing_id}
        return {
            "status": "ready",
            "action": "start_booking",
            "listing_id": listing_id,
            "title": target.title,
            "check_in": check_in,
            "check_out": check_out,
            "guests": guests,
            "required_guest_fields": ["guest_name", "guest_email", "guest_phone", "check_in_time"],
        }

    def _send_payment_link(_: dict[str, Any]) -> dict[str, Any]:
        if not booking_state:
            return {"status": "booking_missing", "action": "start_booking"}
        step = (booking_state.step or "").lower()
        if step in {"confirmed", "pending_payment"}:
            return {"status": "ready", "action": "go_checkout"}
        return {"status": "booking_incomplete", "action": "start_booking"}

    def _handoff_to_human(args: dict[str, Any]) -> dict[str, Any]:
        reason = str(args.get("reason") or "").strip()[:200]
        return {"status": "handoff_ready", "action": "handoff_contact", "reason": reason or None}

    tool_map = {
        "searchProperties": _search_properties,
        "checkAvailability": _check_availability,
        "calculatePrice": _calculate_price,
        "createBooking": _create_booking,
        "sendPaymentLink": _send_payment_link,
        "handoffToHuman": _handoff_to_human,
    }

    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "You are FindApart AI concierge. "
                "Use tools when needed, then return strict JSON with keys: answer, reasoning, follow_up_prompts, next_action_type. "
                "Tone: friendly, concise, professional, natural. "
                "Ask at most one missing-detail question per turn. "
                "No technical explanations, no internal scoring details. "
                "Never invent prices/availability."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "lang": lang,
                    "currency": currency,
                    "stage": stage,
                    "message": user_message,
                    "filters": filters.model_dump(exclude_none=True),
                    "suggestions": [item.model_dump() for item in suggestions[:6]],
                    "alternatives": [item.model_dump() for item in alternatives[:6]],
                    "booking_state": booking_state.model_dump(exclude_none=True) if booking_state else None,
                },
                ensure_ascii=False,
            ),
        },
    ]

    try:
        with httpx.Client(timeout=settings.openai_chat_timeout_seconds) as client:
            for _ in range(4):
                response = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.openai_chat_model,
                        "temperature": 0.25,
                        "response_format": {"type": "json_object"},
                        "tools": tools,
                        "tool_choice": "auto",
                        "messages": messages,
                    },
                )
                if response.status_code >= 400:
                    _log_openai_http_failure("tool concierge reply", response)
                    return None
                payload = response.json()
                msg = payload.get("choices", [{}])[0].get("message", {}) or {}
                tool_calls = msg.get("tool_calls") or []
                if tool_calls:
                    messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
                    for call in tool_calls:
                        function_info = call.get("function", {}) if isinstance(call, dict) else {}
                        name = function_info.get("name")
                        raw_arguments = function_info.get("arguments") or "{}"
                        try:
                            parsed_args = json.loads(raw_arguments) if isinstance(raw_arguments, str) else {}
                        except Exception:
                            parsed_args = {}
                        handler = tool_map.get(name)
                        result = handler(parsed_args if isinstance(parsed_args, dict) else {}) if handler else {"status": "unknown_tool"}
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.get("id"),
                                "content": json.dumps(result, ensure_ascii=False),
                            }
                        )
                    continue

                content = msg.get("content", "")
                if not isinstance(content, str) or not content.strip():
                    return None
                parsed = json.loads(content)
                if not isinstance(parsed, dict):
                    return None
                answer = parsed.get("answer")
                reasoning = parsed.get("reasoning")
                prompts = parsed.get("follow_up_prompts")
                action = parsed.get("next_action_type")

                answer_out = answer.strip() if isinstance(answer, str) and answer.strip() else None
                reasoning_out = reasoning.strip() if isinstance(reasoning, str) and reasoning.strip() else None
                follow_up_out: list[str] | None = None
                if isinstance(prompts, list):
                    filtered = [item.strip() for item in prompts if isinstance(item, str) and item.strip()]
                    if filtered:
                        follow_up_out = filtered[:3]
                action_out = action.strip() if isinstance(action, str) and action.strip() in allowed_actions else None
                return answer_out, reasoning_out, follow_up_out, action_out
    except Exception:
        logger.exception("OpenAI chat tool concierge reply failed")
        return None
    return None


def _merge_filters(preferred: ChatSuggestedFilters, fallback: ChatSuggestedFilters) -> ChatSuggestedFilters:
    return ChatSuggestedFilters(
        city=preferred.city or fallback.city,
        check_in=preferred.check_in or fallback.check_in,
        check_out=preferred.check_out or fallback.check_out,
        guests=preferred.guests or fallback.guests,
        min_price=preferred.min_price if preferred.min_price is not None else fallback.min_price,
        max_price=preferred.max_price if preferred.max_price is not None else fallback.max_price,
        trip_purpose=preferred.trip_purpose or fallback.trip_purpose,
        property_type=preferred.property_type or fallback.property_type,
        amenities=preferred.amenities or fallback.amenities,
        q=preferred.q or fallback.q,
    )


def _prefer_explicit_local_filters(base: ChatSuggestedFilters, local: ChatSuggestedFilters) -> ChatSuggestedFilters:
    return ChatSuggestedFilters(
        city=local.city or base.city,
        check_in=local.check_in or base.check_in,
        check_out=local.check_out or base.check_out,
        guests=local.guests or base.guests,
        min_price=local.min_price if local.min_price is not None else base.min_price,
        max_price=local.max_price if local.max_price is not None else base.max_price,
        trip_purpose=local.trip_purpose or base.trip_purpose,
        property_type=local.property_type or base.property_type,
        amenities=local.amenities or base.amenities,
        q=local.q or base.q,
    )


def _normalize_search_query(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    return value


def _is_preference_only_search_query(raw: str | None) -> bool:
    if not raw:
        return False
    value = raw.strip()
    if not value:
        return False
    normalized = re.sub(r"[-_\s]+", " ", value.lower()).strip()
    preference_only = {
        "view",
        "sea view",
        "ocean view",
        "nice view",
        "good view",
        "вид",
        "вид на море",
    }
    return normalized in preference_only


def _normalize_filter_query(filters: ChatSuggestedFilters) -> ChatSuggestedFilters:
    has_structured_filters = any(
        (
            filters.city,
            filters.check_in,
            filters.check_out,
            filters.guests,
            filters.min_price is not None,
            filters.max_price is not None,
            filters.trip_purpose,
            filters.property_type,
        )
    )
    q = _normalize_search_query(filters.q)
    if has_structured_filters and _is_preference_only_search_query(q):
        q = None
    return ChatSuggestedFilters(
        city=filters.city,
        check_in=filters.check_in,
        check_out=filters.check_out,
        guests=filters.guests,
        min_price=filters.min_price,
        max_price=filters.max_price,
        trip_purpose=filters.trip_purpose,
        property_type=filters.property_type,
        amenities=filters.amenities,
        q=q,
    )


def _normalize_session_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if len(value) < 8 or len(value) > 64:
        return None
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", value):
        return None
    return value


def _decode_mojibake_cp1251(text: str) -> str:
    """Recover common cp1251->latin1 mojibake (e.g. 'Àëìàòû' -> 'Алматы')."""
    if not text:
        return text
    candidates = [text]
    for source_encoding in ("latin1", "cp1252"):
        try:
            candidates.append(text.encode(source_encoding).decode("cp1251"))
        except Exception:
            continue
    # Prefer variant with more Cyrillic letters; fallback to original.
    def _score(value: str) -> int:
        return len(re.findall(r"[а-яё]", value.lower()))

    return max(candidates, key=_score)




def _cleanup_chat_sessions(db: Session, now: datetime) -> None:
    ttl = settings.chat_session_ttl_seconds
    if ttl <= 0:
        db.execute(delete(ChatSessionState))
        db.commit()
        return

    threshold = now - timedelta(seconds=ttl)
    db.execute(delete(ChatSessionState).where(ChatSessionState.updated_at < threshold))

    max_entries = settings.chat_session_max_entries
    if max_entries > 0:
        total = db.scalar(select(func.count()).select_from(ChatSessionState)) or 0
        overflow = total - max_entries
        if overflow > 0:
            overflow_ids = list(
                db.scalars(select(ChatSessionState.session_id).order_by(ChatSessionState.updated_at.asc()).limit(overflow)).all()
            )
            if overflow_ids:
                db.execute(delete(ChatSessionState).where(ChatSessionState.session_id.in_(overflow_ids)))
    db.commit()


def _load_session_filters(db: Session, session_id: str | None) -> ChatSuggestedFilters | None:
    if not session_id:
        return None
    now = utc_now()
    _cleanup_chat_sessions(db, now)
    row = db.get(ChatSessionState, session_id)
    if not row:
        return None
    try:
        payload = json.loads(row.filters_json)
        if not isinstance(payload, dict):
            return None
        return ChatSuggestedFilters.model_validate(payload)
    except Exception:
        return None


def _load_session_booking_state(db: Session, session_id: str | None) -> ChatBookingState | None:
    if not session_id:
        return None
    now = utc_now()
    _cleanup_chat_sessions(db, now)
    row = db.get(ChatSessionState, session_id)
    if not row:
        return None
    raw = getattr(row, "booking_state_json", "{}") or "{}"
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not payload:
            return None
        return ChatBookingState.model_validate(payload)
    except Exception:
        return None


def _save_session_filters(db: Session, session_id: str, filters: ChatSuggestedFilters) -> None:
    if not session_id:
        return
    now = utc_now()
    _cleanup_chat_sessions(db, now)
    row = db.get(ChatSessionState, session_id)
    serialized = json.dumps(filters.model_dump(exclude_none=True))
    if row is None:
        row = ChatSessionState(session_id=session_id, filters_json=serialized, updated_at=now)
        db.add(row)
    else:
        row.filters_json = serialized
        row.updated_at = now
    db.commit()


def _save_session_booking_state(db: Session, session_id: str, booking_state: ChatBookingState | None) -> None:
    if not session_id:
        return
    now = utc_now()
    _cleanup_chat_sessions(db, now)
    row = db.get(ChatSessionState, session_id)
    booking_payload = (booking_state.model_dump(exclude_none=True) if booking_state else {}) or {}
    serialized = json.dumps(booking_payload)
    if row is None:
        row = ChatSessionState(
            session_id=session_id,
            filters_json="{}",
            booking_state_json=serialized,
            updated_at=now,
        )
        db.add(row)
    else:
        row.booking_state_json = serialized
        row.updated_at = now
    db.commit()


def _clear_session_filters(db: Session, session_id: str | None) -> None:
    if not session_id:
        return
    db.execute(delete(ChatSessionState).where(ChatSessionState.session_id == session_id))
    db.commit()


def _max_conflict_end(db: Session, listing_id: int, check_in: date, check_out: date) -> tuple[int, int, date | None]:
    reservations = list(
        db.scalars(
            select(Reservation).where(
                and_(
                    Reservation.listing_id == listing_id,
                    Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                    Reservation.check_in < check_out,
                    Reservation.check_out > check_in,
                    Reservation.room_type_id.is_(None),
                )
            )
        ).all()
    )
    blocks = list(
        db.scalars(
            select(ListingBlock).where(
                and_(
                    ListingBlock.listing_id == listing_id,
                    ListingBlock.check_in < check_out,
                    ListingBlock.check_out > check_in,
                    ListingBlock.room_type_id.is_(None),
                )
            )
        ).all()
    )
    all_ends = [item.check_out for item in reservations] + [item.check_out for item in blocks]
    return len(reservations), len(blocks), (max(all_ends) if all_ends else None)


def _next_available_window(
    db: Session,
    listing_id: int,
    check_in: date,
    check_out: date,
) -> tuple[date, date, int, int]:
    nights = max(1, (check_out - check_in).days)
    candidate_start = check_in
    candidate_end = check_out
    res_count = 0
    block_count = 0
    for _ in range(8):
        res_count, block_count, conflict_end = _max_conflict_end(db, listing_id, candidate_start, candidate_end)
        if conflict_end is None:
            return candidate_start, candidate_end, res_count, block_count
        candidate_start = conflict_end
        candidate_end = candidate_start + timedelta(days=nights)
    return candidate_start, candidate_end, res_count, block_count


def _build_alternatives(
    db: Session,
    rows: list[Listing],
    cover_map: dict[int, str | None],
    lang: str,
    check_in: date,
    check_out: date,
) -> list[ChatAlternative]:
    alternatives: list[ChatAlternative] = []
    for listing in rows:
        suggested_in, suggested_out, res_count, block_count = _next_available_window(db, listing.id, check_in, check_out)
        if res_count or block_count:
            if lang == "en":
                reason = f"Booked on selected dates: {res_count} reservations, {block_count} owner blocks."
            else:
                reason = f"Занято на выбранные даты: брони {res_count}, блоки {block_count}."
        elif lang == "en":
            reason = "No exact match for selected dates; showing the closest available window."
        else:
            reason = "На выбранные даты точного варианта нет; показано ближайшее свободное окно."
        alternatives.append(
            ChatAlternative(
                listing_id=listing.id,
                title=listing.title,
                city=listing.city,
                district=listing.district,
                nightly_price=listing.nightly_price,
                unavailable_reason=reason,
                suggested_check_in=suggested_in.isoformat(),
                suggested_check_out=suggested_out.isoformat(),
                cover_photo_url=cover_map.get(listing.id),
            )
        )
    return alternatives















def _create_handoff_ticket(
    db: Session,
    *,
    lang: str,
    message: str,
    filters: ChatSuggestedFilters,
) -> SupportTicket:
    priority, topic = _classify_handoff(message)
    ticket = SupportTicket(
        source="ai_chat",
        status="open",
        priority=priority,
        topic=topic,
        lang=lang,
        message=message[:2000],
        city=filters.city,
        check_in=_parse_date_token(filters.check_in) if filters.check_in else None,
        check_out=_parse_date_token(filters.check_out) if filters.check_out else None,
        guests=filters.guests,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _resolve_stage(
    text: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
) -> Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"]:
    if _contains_handoff_intent(text):
        return "handoff"
    if _contains_payment_intent(text):
        return "payment_link"
    if _contains_booking_intent(text):
        return "booking"
    if not filters.city or not filters.check_in or not filters.check_out or not filters.guests:
        return "collect"
    if suggestions:
        if filters.max_price or filters.min_price:
            return "pricing"
        return "search"
    if alternatives:
        return "availability"
    return "search"








def _short_amenities(raw: str) -> str:
    parts = [piece.strip() for piece in raw.split(",") if piece.strip()]
    return ", ".join(parts[:3]) if parts else ""







def _get_client_key(request: Request | None) -> str:
    if request is None:
        return "direct-call"
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_chat_rate_limit(request: Request | None, lang: str) -> None:
    limit = settings.chat_rate_limit_per_minute
    window = settings.chat_rate_limit_window_seconds
    if limit <= 0 or window <= 0:
        return

    key = _get_client_key(request)
    now = monotonic()
    floor = now - window
    with _chat_rate_lock:
        bucket = _chat_rate_buckets[key]
        while bucket and bucket[0] < floor:
            bucket.popleft()
        if len(bucket) >= limit:
            if lang == "en":
                message = "Too many chat requests. Please wait a minute and try again."
            elif lang == "kz":
                message = "Сұраулар тым жиі. Бір минуттан кейін қайталап көріңіз."
            else:
                message = "Слишком много запросов в чат. Подождите минуту и попробуйте снова."
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "CHAT_RATE_LIMIT",
                    "message": message,
                    "details": {"limit": limit, "window_seconds": window},
                },
            )
        bucket.append(now)

@router.post("/recommend", response_model=ChatRecommendOut)
def chat_recommend(payload: ChatRecommendIn, db: Session = Depends(get_db), request: Request = None):
    raw_context = [entry.strip() for entry in payload.context_messages if isinstance(entry, str) and entry.strip()]
    context_tail = raw_context[-4:]
    raw_text = " ".join(context_tail + [payload.message]).strip()
    decoded_text = _decode_mojibake_cp1251(raw_text)
    text = f"{raw_text} {decoded_text}".lower().strip()
    reply_lang = _detect_reply_lang(payload.lang, text)
    _enforce_chat_rate_limit(request, reply_lang)
    session_id = _normalize_session_id(payload.session_id) or f"chat_{secrets.token_urlsafe(12)}"
    if _contains_reset_context_intent(text):
        _clear_session_filters(db, session_id)
    session_filters = _load_session_filters(db, session_id)
    session_booking_state = _load_session_booking_state(db, session_id)
    effective_booking_state = payload.booking_state or session_booking_state

    local_filters = _extract_local_filters(text, payload.currency)
    llm_filters = _llm_extract_filters(text, payload.lang, payload.currency)
    used_llm = llm_filters is not None
    filters = _merge_filters(llm_filters, local_filters) if llm_filters else local_filters
    filters = _prefer_explicit_local_filters(filters, local_filters)
    if session_filters:
        filters = _merge_filters(filters, session_filters)
    filters = _normalize_filter_query(filters)
    requested_property_type = filters.property_type or _extract_property_type(text)
    requested_district = _extract_district_query(text)

    follow_ups = _build_follow_ups(reply_lang, filters)
    initial_stage = _resolve_stage(text=text, filters=filters, suggestions=[], alternatives=[])
    if initial_stage == "handoff":
        ticket = _create_handoff_ticket(db, lang=reply_lang, message=payload.message, filters=filters)
        workflow_steps = _build_workflow_steps(reply_lang, "handoff", filters, [])
        next_action = _build_next_action(reply_lang, "handoff", filters, [], [])
        if reply_lang == "en":
            answer = f"{_compose_manager_message(reply_lang, filters, [], [], stage='handoff')} Ticket #{ticket.id} created."
            reasoning = "Escalated to a human specialist. We saved your request in the support queue."
            prompts = ["Share reservation ID", "Share contact phone"]
            summary = "Connected to human manager"
        else:
            answer = f"{_compose_manager_message(reply_lang, filters, [], [], stage='handoff')} Тикет #{ticket.id} создан."
            reasoning = "Кейс передан живому специалисту и поставлен в очередь поддержки."
            prompts = ["Указать номер брони", "Указать контактный телефон"]
            summary = "Этап: передача менеджеру"
        _save_session_booking_state(db, session_id, effective_booking_state)
        return ChatRecommendOut(
            stage="handoff",
            answer=answer,
            selection_summary=summary,
            reasoning=reasoning,
            filters=filters,
            suggestions=[],
            alternatives=[],
            total_found=0,
            follow_up_prompts=prompts,
            workflow_steps=workflow_steps,
            next_action=next_action,
            session_id=session_id,
            booking_state=effective_booking_state,
        )
    if initial_stage == "collect":
        _save_session_filters(db, session_id, filters)
        _save_session_booking_state(db, session_id, effective_booking_state)
        missing_question = _first_missing_question(reply_lang, filters, text)
        workflow_steps = _build_workflow_steps(reply_lang, "collect", filters, [])
        next_action = _build_next_action(reply_lang, "collect", filters, [], [])
        return ChatRecommendOut(
            stage="collect",
            answer=missing_question or _compose_manager_message(reply_lang, filters, [], [], stage=initial_stage),
            selection_summary="Need a few more details" if reply_lang == "en" else "Нужно уточнить детали поездки",
            reasoning=_compose_client_reasoning(reply_lang, filters, [], []),
            filters=filters,
            suggestions=[],
            alternatives=[],
            total_found=0,
            follow_up_prompts=follow_ups,
            workflow_steps=workflow_steps,
            next_action=next_action,
            session_id=session_id,
            booking_state=effective_booking_state,
        )

    conditions = [Listing.is_active.is_(True), Listing.owner_id.is_not(None)]
    if filters.city:
        conditions.append(Listing.city == filters.city)
    if requested_district:
        conditions.append(Listing.district.ilike(f"%{requested_district}%"))
    property_type_condition = None
    if requested_property_type:
        property_type_condition = Listing.property_type.ilike(f"%{requested_property_type}%")
        conditions.append(property_type_condition)
    if filters.guests:
        conditions.append(Listing.max_guests >= filters.guests)
    if filters.min_price:
        conditions.append(Listing.nightly_price >= filters.min_price)
    if filters.max_price:
        conditions.append(Listing.nightly_price <= filters.max_price)
    q_condition = None
    amenity_conditions = []
    for amenity in filters.amenities:
        term = f"%{amenity}%"
        amenity_condition = or_(
            Listing.amenities.ilike(term),
            Listing.description.ilike(term),
            Listing.title.ilike(term),
        )
        amenity_conditions.append(amenity_condition)
        conditions.append(amenity_condition)
    if filters.q and filters.q not in filters.amenities:
        term = f"%{filters.q}%"
        q_condition = or_(
            Listing.amenities.ilike(term),
            Listing.description.ilike(term),
            Listing.title.ilike(term),
            Listing.district.ilike(term),
        )
        conditions.append(q_condition)

    base_conditions = list(conditions)

    if filters.check_in and filters.check_out:
        check_in_date = _parse_date_token(filters.check_in)
        check_out_date = _parse_date_token(filters.check_out)
        if check_in_date and check_out_date and check_out_date > check_in_date:
            reservation_conflicts = select(Reservation.listing_id).where(
                and_(
                    Reservation.status.in_(tuple(BLOCKING_RESERVATION_STATUSES)),
                    Reservation.check_in < check_out_date,
                    Reservation.check_out > check_in_date,
                    Reservation.room_type_id.is_(None),
                )
            )
            block_conflicts = select(ListingBlock.listing_id).where(
                and_(
                    ListingBlock.check_in < check_out_date,
                    ListingBlock.check_out > check_in_date,
                    ListingBlock.room_type_id.is_(None),
                )
            )
            conditions.append(Listing.id.not_in(reservation_conflicts))
            conditions.append(Listing.id.not_in(block_conflicts))

    affordability_ref = filters.max_price or 120000
    affordability = case(
        (Listing.nightly_price <= affordability_ref, (affordability_ref - Listing.nightly_price) / max(affordability_ref, 1)),
        else_=0.0,
    )
    purpose_boost = literal(0.0)
    if filters.trip_purpose == "family":
        purpose_boost = case((Listing.max_guests >= 4, 1.0), else_=0.0) + case((Listing.bedrooms >= 2, 0.8), else_=0.0)
    elif filters.trip_purpose == "business":
        purpose_boost = case((Listing.amenities.ilike("%wifi%"), 1.1), else_=0.0) + case((Listing.rating >= 4.5, 0.6), else_=0.0)
    elif filters.trip_purpose == "solo":
        purpose_boost = case((Listing.max_guests <= 2, 0.9), else_=0.0)
    elif filters.trip_purpose == "couple":
        purpose_boost = case((Listing.bedrooms >= 1, 0.8), else_=0.0) + case((Listing.rating >= 4.4, 0.6), else_=0.0)

    score = (Listing.rating * 3.0) + affordability + purpose_boost
    query = select(Listing).where(and_(*conditions))
    total_found = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    shortlist_limit = 12 if bool(settings.openai_api_key) else 3
    rows = list(db.scalars(query.order_by(score.desc(), Listing.id.desc()).limit(shortlist_limit)).all())
    relax_groups = []
    if property_type_condition is not None:
        relax_groups.append((property_type_condition,))
    if q_condition is not None:
        relax_groups.append((q_condition,))
    if amenity_conditions:
        relax_groups.append(tuple(amenity_conditions))
    if property_type_condition is not None and q_condition is not None:
        relax_groups.append((property_type_condition, q_condition))
    for relax_group in relax_groups:
        if rows:
            break
        relaxed_conditions = [
            condition for condition in conditions if not any(condition is relaxed for relaxed in relax_group)
        ]
        relaxed_query = select(Listing).where(and_(*relaxed_conditions))
        relaxed_total_found = db.scalar(select(func.count()).select_from(relaxed_query.subquery())) or 0
        if relaxed_total_found:
            base_conditions = [
                condition for condition in base_conditions if not any(condition is relaxed for relaxed in relax_group)
            ]
            total_found = relaxed_total_found
            rows = list(db.scalars(relaxed_query.order_by(score.desc(), Listing.id.desc()).limit(shortlist_limit)).all())
    cover_map = get_cover_photo_map(db, rows)
    alternatives: list[ChatAlternative] = []

    suggestions: list[ChatSuggestion] = []
    for listing in rows:
        if reply_lang == "en":
            reason = f"Rating {listing.rating:.1f}, up to {listing.max_guests} guests"
        else:
            reason = f"Рейтинг {listing.rating:.1f}, до {listing.max_guests} гостей"
        suggestions.append(
            ChatSuggestion(
                listing_id=listing.id,
                title=listing.title,
                city=listing.city,
                district=listing.district,
                nightly_price=listing.nightly_price,
                rating=listing.rating,
                max_guests=listing.max_guests,
                reason=reason,
                amenities=listing.amenities,
                cover_photo_url=cover_map.get(listing.id),
            )
        )
    if suggestions and settings.openai_api_key:
        ranked_result = _llm_rank_suggestions(
            lang=reply_lang,
            user_message=payload.message,
            filters=filters,
            suggestions=suggestions,
        )
        if ranked_result:
            ranked_ids, reason_by_id = ranked_result
            by_id: dict[int, ChatSuggestion] = {item.listing_id: item for item in suggestions}
            ranked_suggestions: list[ChatSuggestion] = []
            for listing_id in ranked_ids:
                item = by_id.get(listing_id)
                if item is None:
                    continue
                custom_reason = reason_by_id.get(listing_id)
                if custom_reason:
                    item.reason = custom_reason
                ranked_suggestions.append(item)
            suggestions = ranked_suggestions + [item for item in suggestions if item.listing_id not in ranked_ids]
    suggestions = suggestions[:3]

    if not suggestions and filters.check_in and filters.check_out:
        check_in_date = _parse_date_token(filters.check_in)
        check_out_date = _parse_date_token(filters.check_out)
        if check_in_date and check_out_date and check_out_date > check_in_date:
            fallback_condition_sets = [base_conditions]
            for relax_group in relax_groups:
                relaxed_conditions = [
                    condition for condition in base_conditions if not any(condition is relaxed for relaxed in relax_group)
                ]
                if len(relaxed_conditions) != len(base_conditions):
                    fallback_condition_sets.append(relaxed_conditions)

            fallback_rows = []
            for fallback_conditions in fallback_condition_sets:
                fallback_rows = list(
                    db.scalars(
                        select(Listing).where(and_(*fallback_conditions)).order_by(score.desc(), Listing.id.desc()).limit(3)
                    ).all()
                )
                if fallback_rows:
                    break
            fallback_cover_map = get_cover_photo_map(db, fallback_rows)
            alternatives = _build_alternatives(
                db=db,
                rows=fallback_rows,
                cover_map=fallback_cover_map,
                lang="en" if reply_lang == "en" else "ru",
                check_in=check_in_date,
                check_out=check_out_date,
            )

    stage = _resolve_stage(text=text, filters=filters, suggestions=suggestions, alternatives=alternatives)
    answer = _compose_manager_message(reply_lang, filters, suggestions, alternatives, stage=stage)
    if reply_lang == "en":
        stage_map = {
            "collect": "Stage: collect",
            "search": "Stage: search",
            "availability": "Stage: availability",
            "pricing": "Stage: pricing",
            "booking": "Stage: booking",
            "payment_link": "Stage: payment_link",
            "handoff": "Stage: handoff",
        }
    else:
        stage_map = {
            "collect": "Этап: сбор данных",
            "search": "Этап: подбор вариантов",
            "availability": "Этап: проверка доступности",
            "pricing": "Этап: расчет цены",
            "booking": "Этап: бронирование",
            "payment_link": "Этап: оплата",
            "handoff": "Этап: передача менеджеру",
        }
    selection_summary = stage_map[stage]
    reasoning = _compose_client_reasoning(reply_lang, filters, suggestions, alternatives)
    workflow_steps = _build_workflow_steps(reply_lang, stage, filters, suggestions)
    next_action = _build_next_action(reply_lang, stage, filters, suggestions, alternatives)

    llm_answer, llm_reasoning, llm_follow_ups = _llm_compose_sales_reply(
        lang=reply_lang,
        user_message=payload.message,
        filters=filters,
        suggestions=suggestions,
        alternatives=alternatives,
        stage=stage,
    )
    if llm_answer:
        answer = llm_answer
    if llm_reasoning:
        reasoning = llm_reasoning
    if llm_follow_ups:
        follow_ups = llm_follow_ups

    llm_tool_reply = _llm_tool_concierge_reply(
        db=db,
        lang=reply_lang,
        currency=payload.currency,
        user_message=payload.message,
        filters=filters,
        suggestions=suggestions,
        alternatives=alternatives,
        stage=stage,
        booking_state=effective_booking_state,
    )
    if llm_tool_reply:
        tool_answer, tool_reasoning, tool_follow_ups, tool_action = llm_tool_reply
        if tool_answer:
            answer = tool_answer
        if tool_reasoning:
            reasoning = tool_reasoning
        if tool_follow_ups:
            follow_ups = tool_follow_ups
        if tool_action == "handoff_contact":
            stage = "handoff"
            selection_summary = stage_map.get(stage, selection_summary)
            workflow_steps = _build_workflow_steps(reply_lang, stage, filters, suggestions)
            next_action = ChatNextAction(
                type="handoff_contact",
                label="Share booking ID and phone" if reply_lang == "en" else "Указать номер брони и телефон",
            )
        elif tool_action == "start_booking" and suggestions:
            top = suggestions[0]
            next_action = ChatNextAction(
                type="start_booking",
                label="Start booking now" if reply_lang == "en" else "Начать бронирование",
                listing_id=top.listing_id,
                title=top.title,
                city=top.city,
                check_in=filters.check_in,
                check_out=filters.check_out,
                guests=filters.guests,
            )
        elif tool_action == "apply_alternative_dates" and alternatives:
            alt = alternatives[0]
            next_action = ChatNextAction(
                type="apply_alternative_dates",
                label="Apply nearest available dates" if reply_lang == "en" else "Применить ближайшие даты",
                listing_id=alt.listing_id,
                title=alt.title,
                city=alt.city,
                check_in=alt.suggested_check_in,
                check_out=alt.suggested_check_out,
                guests=filters.guests,
            )
        elif tool_action == "go_checkout" and suggestions:
            top = suggestions[0]
            next_action = ChatNextAction(
                type="go_checkout",
                label="Go to checkout" if reply_lang == "en" else "Перейти к оформлению",
                listing_id=top.listing_id,
                title=top.title,
                city=top.city,
                check_in=filters.check_in,
                check_out=filters.check_out,
                guests=filters.guests,
            )
        elif tool_action == "apply_filters":
            next_action = ChatNextAction(
                type="apply_filters",
                label="Apply filters in search" if reply_lang == "en" else "Применить фильтры в поиске",
                city=filters.city,
                check_in=filters.check_in,
                check_out=filters.check_out,
                guests=filters.guests,
            )
        elif tool_action == "none":
            next_action = None

    _save_session_filters(db, session_id, filters)
    _save_session_booking_state(db, session_id, effective_booking_state)
    return ChatRecommendOut(
        stage=stage,
        answer=answer,
        selection_summary=selection_summary,
        reasoning=reasoning,
        filters=filters,
        suggestions=suggestions,
        alternatives=alternatives,
        total_found=total_found,
        follow_up_prompts=follow_ups,
        workflow_steps=workflow_steps,
        next_action=next_action,
        session_id=session_id,
        booking_state=effective_booking_state,
    )


# Clean language/date/chat overrides to avoid mojibake regressions in UX and parsing.
CITY_ALIASES = {
    "almaty": "Almaty",
    "Р В°Р В»Р СР В°РЎвЂљРЎвЂ№": "Almaty",
    "astana": "Astana",
    "Р В°РЎРѓРЎвЂљР В°Р Р…Р В°": "Astana",
    "shymkent": "Shymkent",
    "РЎв‚¬Р С‘Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "РЎв‚¬РЎвЂ№Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
}

MONTH_ALIASES = {
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЏ": 1,
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЉ": 1,
    "january": 1,
    "jan": 1,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЏ": 2,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЉ": 2,
    "february": 2,
    "feb": 2,
    "Р СР В°РЎР‚РЎвЂљР В°": 3,
    "Р СР В°РЎР‚РЎвЂљ": 3,
    "march": 3,
    "mar": 3,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЏ": 4,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЉ": 4,
    "april": 4,
    "apr": 4,
    "Р СР В°РЎРЏ": 5,
    "Р СР В°Р в„–": 5,
    "may": 5,
    "Р С‘РЎР‹Р Р…РЎРЏ": 6,
    "Р С‘РЎР‹Р Р…РЎРЉ": 6,
    "june": 6,
    "jun": 6,
    "Р С‘РЎР‹Р В»РЎРЏ": 7,
    "Р С‘РЎР‹Р В»РЎРЉ": 7,
    "july": 7,
    "jul": 7,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљР В°": 8,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљ": 8,
    "august": 8,
    "aug": 8,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 9,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 9,
    "september": 9,
    "sep": 9,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 10,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 10,
    "october": 10,
    "oct": 10,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЏ": 11,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЉ": 11,
    "november": 11,
    "nov": 11,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЏ": 12,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЉ": 12,
    "december": 12,
    "dec": 12,
}










def _extract_property_type(text: str) -> str | None:
    low = text.lower()
    if any(token in low for token in ("hotel", "hotels", "отел", "гостиниц")):
        return "hotel"
    if any(token in low for token in ("apartment", "apartments", "studio", "loft", "апартамент", "квартир", "студи")):
        return "apartment"
    if any(token in low for token in ("villa", "villas", "вилл")):
        return "villa"
    if any(token in text for token in ("hotel", "Р С•РЎвЂљР ВµР В»РЎРЉ", "Р С–Р С•РЎРѓРЎвЂљР С‘Р Р…Р С‘РЎвЂ ")):
        return "hotel"
    if any(token in text for token in ("apartment", "Р С”Р Р†Р В°РЎР‚РЎвЂљР С‘РЎР‚", "Р В°Р С—Р В°РЎР‚РЎвЂљР В°Р СР ВµР Р…РЎвЂљ", "Р С—Р С•РЎРѓРЎС“РЎвЂљР С•РЎвЂЎР Р…Р С•", "loft", "studio")):
        return "apartment"
    return None










def _extract_local_filters(text: str, currency: str) -> ChatSuggestedFilters:
    low = text.lower()
    check_in, check_out = _extract_date_range(text)
    property_type_value = _extract_property_type(text)
    amenity_values = _extract_amenities(text)
    amenity_query = _extract_amenity_query(text)
    generic_query = _extract_generic_query(text)
    city_value = _extract_city(text)
    guests_value = _extract_guests(text)
    purpose_value = _extract_trip_purpose(text)
    budgetless = any(token in low for token in ("РґРµС€РµРІ", "Р°СЂР·Р°РЅ", "cheap", "budget"))
    filters = ChatSuggestedFilters(
        city=city_value,
        check_in=check_in,
        check_out=check_out,
        guests=guests_value,
        trip_purpose=purpose_value,
        property_type=property_type_value,
        amenities=amenity_values,
        q=amenity_query,
    )
    min_price, max_price = _extract_price_range(text, currency)
    filters.min_price = min_price
    if max_price is None and budgetless:
        max_price = 70000 if currency == "KZT" else 140
    if max_price is not None and max_price < 0:
        max_price = None
    filters.max_price = max_price
    if filters.q is None and not any(
        (
            city_value,
            check_in,
            check_out,
            guests_value,
            min_price is not None,
            max_price is not None,
            purpose_value,
            property_type_value,
            amenity_values,
        )
    ):
        filters.q = generic_query
    return filters


def _detect_reply_lang(default_lang: str, text: str) -> str:
    low = text.lower()
    kazakh_letters = set("У™С–ТЈТ“ТЇТ±Т›У©Т»С–")
    if any(char in kazakh_letters for char in low):
        return "kz"
    kazakh_tokens = ("РєР°СЃРїРё", "С‚РѕР№С…Р°РЅР°", "Т›РѕРЅР°Т›", "С‚У©Р»РµРј", "Р¶Р°Т›С‹РЅ", "Т›Р°Р№С‚Р°СЂ")
    if any(token in low for token in kazakh_tokens):
        return "kz"
    if default_lang in {"en", "kz", "ru"}:
        return default_lang
    return "ru"


def _contains_reset_context_intent(text: str) -> bool:
    tokens = (
        "reset chat",
        "reset filters",
        "start over",
        "СЃР±СЂРѕСЃ",
        "РѕС‡РёСЃС‚Рё С‡Р°С‚",
        "РЅР°С‡РЅРµРј Р·Р°РЅРѕРІРѕ",
        "РЅР°С‡РЅРµРј СЃРЅР°С‡Р°Р»Р°",
        "Т›Р°Р№С‚Р° Р±Р°СЃС‚Р°Сѓ",
        "С‚Р°Р·Р°Р»Р°Сѓ",
    )
    return any(token in text for token in tokens)




def _contains_booking_intent(text: str) -> bool:
    tokens = ("book", "reserve", "booking", "Р±СЂРѕРЅСЊ", "Р·Р°Р±СЂРѕРЅРё", "РѕС„РѕСЂРјРё", "Р±СЂРѕРЅРґР°", "Р±СЂРѕРЅРґР°Сѓ")
    return any(token in text for token in tokens)


def _contains_payment_intent(text: str) -> bool:
    tokens = ("pay", "payment", "РѕРїР»Р°С‚", "РєР°СЃРїРё", "kaspi", "invoice", "С‡РµРє", "С‚У©Р»Рµ")
    return any(token in text for token in tokens)




















# Runtime overrides: broader city understanding and relaxed city sanitization.
CITY_ALIASES = {
    "almaty": "Almaty",
    "Р В°Р В»Р СР В°РЎвЂљРЎвЂ№": "Almaty",
    "astana": "Astana",
    "Р В°РЎРѓРЎвЂљР В°Р Р…Р В°": "Astana",
    "shymkent": "Shymkent",
    "РЎв‚¬Р С‘Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "РЎв‚¬РЎвЂ№Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "istanbul": "Istanbul",
    "РЎРѓРЎвЂљР В°Р СР В±РЎС“Р В»": "Istanbul",
    "Р В°Р Р…РЎвЂљР В°Р В»Р С‘РЎРЏ": "Antalya",
    "antalya": "Antalya",
    "vienna": "Vienna",
    "Р Р†Р ВµР Р…Р В°": "Vienna",
    "dubai": "Dubai",
    "Р Т‘РЎС“Р В±Р В°Р в„–": "Dubai",
}


_GENERIC_CITY_TOKENS = {
    "city",
    "town",
    "district",
    "area",
    "center",
    "centre",
    "РЎР‚Р В°Р в„–Р С•Р Р…",
    "Р С–Р С•РЎР‚Р С•Р Т‘",
    "РЎвЂ Р ВµР Р…РЎвЂљРЎР‚",
}








# Final clean parsing overrides to avoid mojibake side effects.
_CITY_ALIASES_CLEAN: dict[str, str] = {
    "almaty": "Almaty",
    "Р В°Р В»Р СР В°РЎвЂљРЎвЂ№": "Almaty",
    "astana": "Astana",
    "Р В°РЎРѓРЎвЂљР В°Р Р…Р В°": "Astana",
    "shymkent": "Shymkent",
    "РЎв‚¬Р С‘Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "РЎв‚¬РЎвЂ№Р СР С”Р ВµР Р…РЎвЂљ": "Shymkent",
    "istanbul": "Istanbul",
    "РЎРѓРЎвЂљР В°Р СР В±РЎС“Р В»": "Istanbul",
    "antalya": "Antalya",
    "Р В°Р Р…РЎвЂљР В°Р В»РЎРЉРЎРЏ": "Antalya",
    "vienna": "Vienna",
    "Р Р†Р ВµР Р…Р В°": "Vienna",
    "dubai": "Dubai",
    "Р Т‘РЎС“Р В±Р В°Р в„–": "Dubai",
    "baku": "Baku",
    "Р В±Р В°Р С”РЎС“": "Baku",
}

_MONTH_ALIASES_CLEAN: dict[str, int] = {
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЏ": 1,
    "РЎРЏР Р…Р Р†Р В°РЎР‚РЎРЉ": 1,
    "january": 1,
    "jan": 1,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЏ": 2,
    "РЎвЂћР ВµР Р†РЎР‚Р В°Р В»РЎРЉ": 2,
    "february": 2,
    "feb": 2,
    "Р СР В°РЎР‚РЎвЂљР В°": 3,
    "Р СР В°РЎР‚РЎвЂљ": 3,
    "march": 3,
    "mar": 3,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЏ": 4,
    "Р В°Р С—РЎР‚Р ВµР В»РЎРЉ": 4,
    "april": 4,
    "apr": 4,
    "Р СР В°РЎРЏ": 5,
    "Р СР В°Р в„–": 5,
    "may": 5,
    "Р С‘РЎР‹Р Р…РЎРЏ": 6,
    "Р С‘РЎР‹Р Р…РЎРЉ": 6,
    "june": 6,
    "jun": 6,
    "Р С‘РЎР‹Р В»РЎРЏ": 7,
    "Р С‘РЎР‹Р В»РЎРЉ": 7,
    "july": 7,
    "jul": 7,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљР В°": 8,
    "Р В°Р Р†Р С–РЎС“РЎРѓРЎвЂљ": 8,
    "august": 8,
    "aug": 8,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 9,
    "РЎРѓР ВµР Р…РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 9,
    "september": 9,
    "sep": 9,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЏ": 10,
    "Р С•Р С”РЎвЂљРЎРЏР В±РЎР‚РЎРЉ": 10,
    "october": 10,
    "oct": 10,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЏ": 11,
    "Р Р…Р С•РЎРЏР В±РЎР‚РЎРЉ": 11,
    "november": 11,
    "nov": 11,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЏ": 12,
    "Р Т‘Р ВµР С”Р В°Р В±РЎР‚РЎРЉ": 12,
    "december": 12,
    "dec": 12,
}


















# Final stable overrides (single source of truth for chat parsing).
_CITY_ALIASES_STABLE: dict[str, str] = {
    "almaty": "Almaty",
    "алматы": "Almaty",
    "àëìàòû": "Almaty",
    "Р°Р»РјР°С‚С‹": "Almaty",
    "astana": "Astana",
    "астана": "Astana",
    "Р°СЃС‚Р°РЅР°": "Astana",
    "shymkent": "Shymkent",
    "шимкент": "Shymkent",
    "шымкент": "Shymkent",
    "øûìêåíò": "Shymkent",
    "С€РёРјРєРµРЅС‚": "Shymkent",
    "С€С‹РјРєРµРЅС‚": "Shymkent",
    "istanbul": "Istanbul",
    "СЃС‚Р°РјР±СѓР»": "Istanbul",
    "antalya": "Antalya",
    "Р°РЅС‚Р°Р»РёСЏ": "Antalya",
    "vienna": "Vienna",
    "РІРµРЅР°": "Vienna",
    "dubai": "Dubai",
    "дубай": "Dubai",
    "дубае": "Dubai",
    "дубая": "Dubai",
    "РґСѓР±Р°Р№": "Dubai",
    "baku": "Baku",
    "баку": "Baku",
    "Р±Р°РєСѓ": "Baku",
    "milan": "Milan",
    "РјРёР»Р°РЅ": "Milan",
    "tbilisi": "Tbilisi",
    "С‚Р±РёР»РёСЃРё": "Tbilisi",
    "toronto": "Toronto",
    "С‚РѕСЂРѕРЅС‚Рѕ": "Toronto",
}

_GENERIC_CITY_STOPWORDS_STABLE = {
    "city",
    "town",
    "district",
    "area",
    "center",
    "centre",
    "город",
    "район",
    "центр",
    "РіРѕСЂРѕРґ",
    "СЂР°Р№РѕРЅ",
    "С†РµРЅС‚СЂ",
}

_MAX_CHAT_PRICE_KZT = 2_000_000


def _normalize_city_value(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    low = value.lower()
    if low in _GENERIC_CITY_STOPWORDS_STABLE:
        return None
    if low in _CITY_ALIASES_STABLE:
        return _CITY_ALIASES_STABLE[low]
    if re.fullmatch(r"[a-z][a-z\s\-]{1,48}", low):
        return " ".join(part.capitalize() for part in value.split())
    if re.fullmatch(r"[а-яё][а-яё\s\-]{1,48}", low):
        return value[:1].upper() + value[1:]
    return None


def _extract_city(text: str) -> str | None:
    low = text.lower()
    for alias, canonical in _CITY_ALIASES_STABLE.items():
        if alias in low:
            return canonical
    contextual = re.search(r"(?:\bв\b|\bin\b|\bгород\b|\bcity\b|\bРІ\b|\bРіРѕСЂРѕРґ\b)\s+([a-zа-яё][a-zа-яё\-]{2,40})", low)
    if not contextual:
        return None
    candidate = contextual.group(1).strip().lower()
    blocked = _GENERIC_CITY_STOPWORDS_STABLE | {"view", "wifi", "parking", "kitchen", "pool", "budget", "cheap"}
    if candidate in blocked:
        return None
    return _normalize_city_value(candidate)




def _extract_trip_purpose(text: str) -> str | None:
    low = text.lower()
    if any(token in low for token in ("family", "kids", "сем", "дет", "СЃРµРј", "РґРµС‚")):
        return "family"
    if any(token in low for token in ("business", "work", "командиров", "работ", "РєРѕРјР°РЅРґРёСЂРѕРІ", "СЂР°Р±РѕС‚")):
        return "business"
    if any(token in low for token in ("couple", "роман", "пара", "вдво", "СЂРѕРјР°РЅ", "РїР°СЂР°", "РІРґРІРѕ")):
        return "couple"
    if any(token in low for token in ("solo", "one", "сам", "один", "СЃР°Рј", "РѕРґРёРЅ")):
        return "solo"
    return None


def _extract_amenities(text: str) -> list[str]:
    low = text.lower()
    mapping = [
        ("wifi", ("wifi", "wi-fi", "вайфай", "РІР°Р№С„Р°Р№", "wi fi")),
        ("parking", ("parking", "парков", "РїР°СЂРєРѕРІ")),
        ("kitchen", ("kitchen", "кухн", "РєСѓС…РЅ")),
        ("pool", ("pool", "бассейн", "Р±Р°СЃСЃРµР№РЅ")),
        ("view", ("view", "вид", "РІРёРґ")),
        ("pet", ("pet", "животн", "питом", "Р¶РёРІРѕС‚РЅ", "РїРёС‚РѕРј")),
    ]
    amenities: list[str] = []
    for normalized, variants in mapping:
        if any(token in low for token in variants):
            amenities.append(normalized)
    return amenities


def _extract_amenity_query(text: str) -> str | None:
    amenities = _extract_amenities(text)
    return amenities[0] if amenities else None


def _extract_nights(text: str) -> int | None:
    low = text.lower()
    match = re.search(r"(\d{1,2})\s*(?:night|nights|ноч(?:ь|и|ей)|РЅРѕС‡[СЊРµРёР№])\b", low)
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 30 else None




def _extract_price_range(text: str, currency: str) -> tuple[int | None, int | None]:
    low = text.lower()

    def _to_kzt(amount: int, unit: str | None) -> int:
        normalized_unit = (unit or currency or "KZT").upper()
        if normalized_unit == "USD":
            amount = int(round(amount * USD_RATE))
        return max(0, min(amount, _MAX_CHAT_PRICE_KZT))

    token = r"([$₸в‚ё]?\s*\d[\d\s.,]*(?:(?:k|Рє|С‚С‹СЃ|thousand)(?!zt))?(?:\s*(?:kzt|usd|тенге|тг|долл|dollar|С‚РµРЅРіРµ|РґРѕР»Р»))?)"

    def parse_amount(raw: str) -> tuple[int | None, str | None]:
        chunk = raw.strip().lower()
        unit: str | None = None
        if re.search(r"(\$|usd|долл|РґРѕР»Р»|dollar)", chunk):
            unit = "USD"
        elif re.search(r"(₸|в‚ё|kzt|тенге|тг|С‚РµРЅРіРµ|С‚Рі)", chunk):
            unit = "KZT"
        compact = chunk.replace(" ", "")
        scaled = re.match(r"(\d+(?:[.,]\d+)?)(k|Рє)$", compact)
        if scaled:
            base = float(scaled.group(1).replace(",", "."))
            return int(round(base * 1000)), unit
        thousand = re.match(r"(\d+(?:[.,]\d+)?)\s*(С‚С‹СЃ|thousand)$", chunk)
        if thousand:
            base = float(thousand.group(1).replace(",", "."))
            return int(round(base * 1000)), unit
        digits = re.sub(r"[^\d.,]", "", chunk).replace(",", ".")
        if not digits:
            return None, unit
        value = float(digits)
        return int(round(value)), unit

    range_match = re.search(rf"(?:from|от|РѕС‚)\s*{token}\s*(?:to|до|РґРѕ|-|–|—|вЂ“|вЂ”)\s*{token}", low)
    if range_match:
        left, left_unit = parse_amount(range_match.group(1))
        right, right_unit = parse_amount(range_match.group(2))
        if left is not None and right is not None:
            min_kzt = _to_kzt(min(left, right), left_unit or right_unit)
            max_kzt = _to_kzt(max(left, right), left_unit or right_unit)
            return min_kzt, max_kzt

    max_match = re.search(rf"(?:up to|under|less than|до|не дороже|РґРѕ|РЅРµ РґРѕСЂРѕР¶Рµ)\s*{token}", low)
    if max_match:
        parsed, unit = parse_amount(max_match.group(1))
        if parsed is not None:
            return None, _to_kzt(parsed, unit)

    min_match = re.search(rf"(?:from|от|РѕС‚)\s*{token}", low)
    if min_match:
        parsed, unit = parse_amount(min_match.group(1))
        if parsed is not None:
            return _to_kzt(parsed, unit), None

    return None, None


def _sanitize_llm_filters(raw: dict, currency: str) -> ChatSuggestedFilters:
    allowed_purpose = {"family", "business", "solo", "couple"}
    city_value = _normalize_city_value(raw.get("city") if isinstance(raw.get("city"), str) else None)

    check_in_raw = raw.get("check_in")
    check_out_raw = raw.get("check_out")
    check_in_date = _parse_date_token(str(check_in_raw)) if check_in_raw is not None else None
    check_out_date = _parse_date_token(str(check_out_raw)) if check_out_raw is not None else None
    if check_in_date and check_out_date and check_out_date <= check_in_date:
        check_in_date = None
        check_out_date = None

    guests = raw.get("guests")
    guests_value = int(guests) if isinstance(guests, (int, float, str)) and str(guests).isdigit() else None
    if guests_value is not None and not (1 <= guests_value <= 12):
        guests_value = None

    min_price = raw.get("min_price")
    max_price = raw.get("max_price")
    min_price_value = int(min_price) if isinstance(min_price, (int, float, str)) and str(min_price).isdigit() else None
    max_price_value = int(max_price) if isinstance(max_price, (int, float, str)) and str(max_price).isdigit() else None
    if min_price_value is not None:
        min_price_value = max(0, min(min_price_value, _MAX_CHAT_PRICE_KZT))
    if max_price_value is not None:
        max_price_value = max(0, min(max_price_value, _MAX_CHAT_PRICE_KZT))
    if min_price_value is not None and max_price_value is not None and min_price_value > max_price_value:
        min_price_value, max_price_value = max_price_value, min_price_value

    purpose = raw.get("trip_purpose")
    purpose_value = purpose.strip() if isinstance(purpose, str) and purpose.strip() in allowed_purpose else None

    property_type = raw.get("property_type")
    property_type_value = _extract_property_type(property_type.strip().lower()) if isinstance(property_type, str) and property_type.strip() else None

    amenity_values: list[str] = []
    raw_amenities = raw.get("amenities")
    if isinstance(raw_amenities, list):
        for item in raw_amenities:
            if isinstance(item, str):
                for amenity in _extract_amenities(item.strip().lower()):
                    if amenity not in amenity_values:
                        amenity_values.append(amenity)
    elif isinstance(raw_amenities, str):
        for amenity in _extract_amenities(raw_amenities.strip().lower()):
            if amenity not in amenity_values:
                amenity_values.append(amenity)

    q = raw.get("q")
    q_value = _normalize_search_query(q) if isinstance(q, str) else None

    return ChatSuggestedFilters(
        city=city_value,
        check_in=check_in_date.isoformat() if check_in_date else None,
        check_out=check_out_date.isoformat() if check_out_date else None,
        guests=guests_value,
        min_price=min_price_value,
        max_price=max_price_value,
        trip_purpose=purpose_value,
        property_type=property_type_value,
        amenities=amenity_values,
        q=q_value,
    )


def _first_missing_question(lang: str, filters: ChatSuggestedFilters, source_text: str | None = None) -> str | None:
    if not filters.city:
        if lang == "kz":
            return "ТљР°Р№ Т›Р°Р»Р° РєРµСЂРµРє?"
        if lang == "en":
            return "Which city are you considering?"
        return "РљР°РєРѕР№ РіРѕСЂРѕРґ СЂР°СЃСЃРјР°С‚СЂРёРІР°РµС‚Рµ?"
    if not filters.check_in or not filters.check_out:
        nights = _extract_nights(source_text or "")
        if nights:
            if lang == "kz":
                return f"РўТЇСЃС–РЅРґС–Рј, {nights} С‚ТЇРЅ. ТљР°Р№ РєТЇРЅРЅРµРЅ Р±Р°СЃС‚Р°Р№РјС‹Р·?"
            if lang == "en":
                return f"Got it, {nights} nights. What check-in date works for you?"
            return f"РџРѕРЅСЏР», {nights} РЅРѕС‡Рё. РЎ РєР°РєРѕР№ РґР°С‚С‹ РЅСѓР¶РµРЅ Р·Р°РµР·Рґ?"
        if lang == "kz":
            return "Р—Р°РµР·Рґ Р¶У™РЅРµ С€С‹Т“Сѓ РєТЇРЅРґРµСЂС–РЅ Р°Р№С‚С‹ТЈС‹Р·С€С‹."
        if lang == "en":
            return "What are your check-in and check-out dates?"
        return "На какие даты нужен заезд и выезд?"
    if not filters.guests:
        if lang == "kz":
            return "ТљР°РЅС€Р° Т›РѕРЅР°Т› Р±РѕР»Р°РґС‹?"
        if lang == "en":
            return "How many guests?"
        return "РЎРєРѕР»СЊРєРѕ Р±СѓРґРµС‚ РіРѕСЃС‚РµР№?"
    return None


def _extract_district_query(text: str) -> str | None:
    low = text.lower()
    match = re.search(r"(?:СЂР°Р№РѕРЅ|district)\s+([\w\-]{3,40})", low, flags=re.UNICODE)
    if not match:
        return None
    district = match.group(1).strip()
    return district[:1].upper() + district[1:] if district else None


def _extract_generic_query(text: str) -> str | None:
    low = text.lower()
    cleaned = re.sub(r"[^\w\s-]", " ", low, flags=re.UNICODE)
    tokens = [token for token in cleaned.split() if len(token) >= 3]
    if not tokens:
        return None
    stopwords = {
        "city", "district", "hotel", "apartment", "hostel", "stay", "book", "booking",
        "РіРѕСЂРѕРґ", "СЂР°Р№РѕРЅ", "РѕС‚РµР»СЊ", "РєРІР°СЂС‚РёСЂР°", "Р±СЂРѕРЅСЊ", "Р·Р°Р±СЂРѕРЅРёСЂРѕРІР°С‚СЊ",
        "guest", "guests", "night", "nights", "wifi", "parking", "kitchen", "pool",
        "cheap", "budget", "РґРѕСЂРѕР¶Рµ", "РґРµС€РµРІР»Рµ", "РЅРµ", "РґРѕ", "РѕС‚", "РїРѕРґ",
    }
    city_tokens = {k.lower() for k in _CITY_ALIASES_STABLE.keys()}
    filtered = [token for token in tokens if token not in stopwords and token not in city_tokens and not token.isdigit()]
    if not filtered:
        return None
    return " ".join(filtered[:6])


def _contains_handoff_intent(text: str) -> bool:
    low = text.lower()
    triggers = (
        "refund",
        "chargeback",
        "complaint",
        "dispute",
        "conflict",
        "возврат",
        "жалоб",
        "претенз",
        "конфликт",
        "скандал",
        "âîçâðàò",
        "æàëîá",
        "ïðåòåíç",
        "êîíôëèêò",
        "РІРѕР·РІСЂР°С‚",
        "Р¶Р°Р»РѕР±",
        "РїСЂРµС‚РµРЅР·",
        "РєРѕРЅС„Р»РёРєС‚",
        "СЃРєР°РЅРґР°Р»",
        "Т›Р°Р№С‚Р°СЂ",
        "С€Р°Т“С‹Рј",
        "СЂС–СЂС•СЂВ·СЂС–СЂСЃС’СЂВ°СЃвЂљ",
        "СЃС€Р°Т“",
        "СЂВ¶СЂВ°СЂВ»СЂС•СЂВ±",
    )
    return any(token in low for token in triggers)


def _compose_handoff_message(lang: str) -> str:
    if lang == "en":
        return "Understood. I am handing this request to a human specialist. Please share reservation ID and contact phone."
    if lang == "kz":
        return "РўТЇСЃС–РЅРґС–Рј. РЎТ±СЂР°СѓРґС‹ С‚С–СЂС– РјР°РјР°РЅТ“Р° Р¶С–Р±РµСЂРµРјС–РЅ. Р‘СЂРѕРЅСЊ РЅУ©РјС–СЂС– РјРµРЅ Р±Р°Р№Р»Р°РЅС‹СЃ С‚РµР»РµС„РѕРЅС‹РЅ Р¶Р°Р·С‹ТЈС‹Р·."
    return "Понял вас. Передаю запрос живому специалисту. Напишите номер брони и контактный телефон."


def _classify_handoff(message_text: str) -> tuple[str, str]:
    text = (message_text or "").lower()
    if any(token in text for token in ("refund", "chargeback", "возврат", "âîçâðàò", "РІРѕР·РІСЂР°С‚", "Т›Р°Р№С‚Р°СЂ")):
        return "high", "refund"
    if any(
        token in text
        for token in (
            "complaint",
            "жалоб",
            "претенз",
            "конфликт",
            "æàëîá",
            "ïðåòåíç",
            "êîíôëèêò",
            "Р¶Р°Р»РѕР±",
            "РїСЂРµС‚РµРЅР·",
            "РєРѕРЅС„Р»РёРєС‚",
            "С€Р°Т“С‹Рј",
            "СЃРєР°РЅРґР°Р»",
        )
    ):
        return "medium", "complaint"
    return "low", "general"


def _extract_guests(text: str) -> int | None:
    low = (text or "").lower()
    combined = re.search(
        r"(\d{1,2})\s*(?:adults?|взросл(?:ых|ые|ый)?|РІР·СЂРѕСЃР»(?:С‹С…|С‹Рµ|С‹Р№)?)\s*(?:\+|and|и|Рё|,)\s*(\d{1,2})\s*(?:children?|kids?|дет(?:ей|и)?|ребенк(?:а|ов)?|РґРµС‚(?:РµР№|Рё)?|СЂРµР±РµРЅРє(?:Р°|РѕРІ)?)",
        low,
    )
    if combined:
        total = int(combined.group(1)) + int(combined.group(2))
        if 1 <= total <= 12:
            return total

    patterns = (
        r"(\d{1,2})\s*(?:guest|guests|people|person)\b",
        r"(\d{1,2})\s*(?:adult|adults)\b",
        r"(\d{1,2})\s*(?:взросл(?:ых|ые|ый)?)\b",
        r"(\d{1,2})\s*(?:гост(?:я|ей)?)\b",
        r"(\d{1,2})\s*(?:РіРѕСЃС‚(?:СЏ|РµР№)?)\b",
        r"\bРЅР°СЃ\s*(\d{1,2})\b",
        r"\bнас\s*(\d{1,2})\b",
        r"\bРґР»СЏ\s*(\d{1,2})\b",
        r"\bдля\s*(\d{1,2})\b",
        r"\bРЅР°\s*(\d{1,2})\s*(?:С‡РµР»(?:РѕРІРµРє)?|РіРѕСЃС‚(?:СЏ|РµР№)?|people|guests?)?\b",
        r"\bна\s*(\d{1,2})\s*(?:чел(?:овек)?|гост(?:я|ей)?|people|guests?)?\b",
    )
    for pattern in patterns:
        match = re.search(pattern, low)
        if not match:
            continue
        value = int(match.group(1))
        if 1 <= value <= 12:
            return value
    return None


def _build_follow_ups(lang: str, filters: ChatSuggestedFilters) -> list[str]:
    if lang == "en":
        base = ["Show cheaper", "Only with parking", "Closer to center"]
        if filters.city:
            base.append(f"Only in {filters.city}")
        if filters.check_in and filters.check_out:
            base.append("Show nearest available dates")
        return base[:4]
    if lang == "kz":
        base = ["РђСЂР·Р°РЅС‹СЂР°Т›", "РўРµРє РїР°СЂРєРёРЅРіРїРµРЅ", "РћСЂС‚Р°Р»С‹Т›Т›Р° Р¶Р°Т›С‹РЅ"]
        if filters.city:
            base.append(f"РўРµРє {filters.city}")
        if filters.check_in and filters.check_out:
            base.append("Р–Р°Т›С‹РЅ Р±РѕСЃ РєТЇРЅРґРµСЂ")
        return base[:4]
    base = ["РџРѕРєР°Р¶Рё РґРµС€РµРІР»Рµ", "РўРѕР»СЊРєРѕ СЃ РїР°СЂРєРѕРІРєРѕР№", "Р‘Р»РёР¶Рµ Рє С†РµРЅС‚СЂСѓ"]
    if filters.city:
        base.append(f"РўРѕР»СЊРєРѕ РІ {filters.city}")
    if filters.check_in and filters.check_out:
        base.append("РџРѕРєР°Р¶Рё Р±Р»РёР¶Р°Р№С€РёРµ СЃРІРѕР±РѕРґРЅС‹Рµ РґР°С‚С‹")
    return base[:4]


def _build_workflow_steps(
    lang: str,
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"],
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
) -> list[str]:
    if stage == "handoff":
        if lang == "en":
            return [
                "Escalated to a human specialist.",
                "Ticket created with high-priority context.",
                "Next: share booking ID and contact phone.",
            ]
        if lang == "kz":
            return [
                "РЎТ±СЂР°Сѓ С‚С–СЂС– РјР°РјР°РЅТ“Р° Р¶С–Р±РµСЂС–Р»РґС–.",
                "РљРµР№СЃ Т›РѕР»РґР°Сѓ С‚РѕР±С‹РЅР° С‚С–СЂРєРµР»РґС–.",
                "РљРµР»РµСЃС– Т›Р°РґР°Рј: Р±СЂРѕРЅСЊ РЅУ©РјС–СЂС– РјРµРЅ С‚РµР»РµС„РѕРЅ.",
            ]
        return [
            "РџРµСЂРµРґР°Р» Р·Р°РїСЂРѕСЃ Р¶РёРІРѕРјСѓ СЃРїРµС†РёР°Р»РёСЃС‚Сѓ.",
            "РљРµР№СЃ РїРѕСЃС‚Р°РІР»РµРЅ РІ РїСЂРёРѕСЂРёС‚РµС‚РЅСѓСЋ РѕС‡РµСЂРµРґСЊ.",
            "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РЅРѕРјРµСЂ Р±СЂРѕРЅРё Рё РєРѕРЅС‚Р°РєС‚РЅС‹Р№ С‚РµР»РµС„РѕРЅ.",
        ]

    if stage == "collect":
        if lang == "en":
            return [
                "Captured your request context.",
                "Collecting one missing detail for precise matching.",
                "Then I will narrow options and prepare booking.",
            ]
        if lang == "kz":
            return [
                "РЎТ±СЂР°СѓС‹ТЈС‹Р·РґС‹ТЈ РєРѕРЅС‚РµРєСЃС‚С–РЅ С‚ТЇСЃС–РЅРґС–Рј.",
                "Р”У™Р» С–СЂС–РєС‚РµСѓ ТЇС€С–РЅ Р±С–СЂ РїР°СЂР°РјРµС‚СЂ Р¶РµС‚С–СЃРїРµР№РґС–.",
                "РЎРѕРґР°РЅ РєРµР№С–РЅ РЅТ±СЃТ›Р°Р»Р°СЂРґС‹ С‚Р°СЂС‹Р»С‚С‹Рї, Р±СЂРѕРЅСЊТ“Р° У©С‚РµРјС–РЅ.",
            ]
        return [
            "РџРѕРЅСЏР» РІР°С€ Р·Р°РїСЂРѕСЃ.",
            "Р”Р»СЏ С‚РѕС‡РЅРѕРіРѕ РїРѕРґР±РѕСЂР° РЅРµ С…РІР°С‚Р°РµС‚ РѕРґРЅРѕРіРѕ РїР°СЂР°РјРµС‚СЂР°.",
            "Р”Р°Р»СЊС€Рµ СЃСѓР·РёРј РІР°СЂРёР°РЅС‚С‹ Рё РїРµСЂРµР№РґРµРј Рє Р±СЂРѕРЅРё.",
        ]

    if stage == "availability":
        if lang == "en":
            return [
                "Checked availability against booked and blocked ranges.",
                "Prepared nearest available alternatives when needed.",
                "Next: confirm dates and proceed.",
            ]
        if lang == "kz":
            return [
                "ТљРѕР»Р¶РµС‚С–РјРґС–Р»С–Рє Р±СЂРѕРЅСЊ Р¶У™РЅРµ Р±Р»РѕРєС‚Р°СЂРјРµРЅ С‚РµРєСЃРµСЂС–Р»РґС–.",
                "РљРµСЂРµРє Р±РѕР»СЃР° Р¶Р°Т›С‹РЅ Р±РѕСЃ РєТЇРЅРґРµСЂ РґР°Р№С‹РЅРґР°Р»РґС‹.",
                "РљРµР»РµСЃС– Т›Р°РґР°Рј: РєТЇРЅРґРµСЂРґС– Р±РµРєС–С‚Сѓ Р¶У™РЅРµ Р¶Р°Р»Т“Р°СЃС‚С‹СЂСѓ.",
            ]
        return [
            "РџСЂРѕРІРµСЂРёР» РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ РїРѕ Р±СЂРѕРЅСЏРј Рё Р±Р»РѕРєР°Рј.",
            "Р•СЃР»Рё РЅСѓР¶РЅРѕ, РїРѕРґРіРѕС‚РѕРІРёР» Р±Р»РёР¶Р°Р№С€РёРµ СЃРІРѕР±РѕРґРЅС‹Рµ РґР°С‚С‹.",
            "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РїРѕРґС‚РІРµСЂРґРёС‚СЊ РґР°С‚С‹ Рё РїСЂРѕРґРѕР»Р¶РёС‚СЊ.",
        ]

    if stage == "pricing":
        if lang == "en":
            return [
                "Estimated final trip price including service fees.",
                "Compared options by value-for-money.",
                "Next: choose option and go to checkout.",
            ]
        if lang == "kz":
            return [
                "ТљС‹Р·РјРµС‚С‚С–Рє С‚У©Р»РµРјРґРµСЂРґС– Т›РѕСЃР° Р±Р°Т“Р°СЃС‹ РµСЃРµРїС‚РµР»РґС–.",
                "РќТ±СЃТ›Р°Р»Р°СЂ Р±Р°Т“Р°/СЃР°РїР° Р±РѕР№С‹РЅС€Р° СЃР°Р»С‹СЃС‚С‹СЂС‹Р»РґС‹.",
                "РљРµР»РµСЃС– Т›Р°РґР°Рј: РЅТ±СЃТ›Р°РЅС‹ С‚Р°ТЈРґР°Рї, checkout-Т›Р° У©С‚Сѓ.",
            ]
        return [
            "РџРѕСЃС‡РёС‚Р°Р» С„РёРЅР°Р»СЊРЅСѓСЋ СЃС‚РѕРёРјРѕСЃС‚СЊ СЃ СЃРµСЂРІРёСЃРЅС‹РјРё СЃР±РѕСЂР°РјРё.",
            "РЎСЂР°РІРЅРёР» РІР°СЂРёР°РЅС‚С‹ РїРѕ С†РµРЅРµ Рё РєР°С‡РµСЃС‚РІСѓ.",
            "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РІС‹Р±СЂР°С‚СЊ РІР°СЂРёР°РЅС‚ Рё РїРµСЂРµР№С‚Рё Рє РѕС„РѕСЂРјР»РµРЅРёСЋ.",
        ]

    if stage == "booking":
        if lang == "en":
            return [
                "Prepared booking-ready option.",
                "Collected guest details for reservation draft.",
                "Next: confirm booking and send payment link.",
            ]
        if lang == "kz":
            return [
                "Р‘СЂРѕРЅСЊТ“Р° РґР°Р№С‹РЅ РЅТ±СЃТ›Р° С‚Р°ТЈРґР°Р»РґС‹.",
                "ТљРѕРЅР°Т› РґРµСЂРµРєС‚РµСЂС– С‡РµСЂРЅРѕРІРёРє Р±СЂРѕРЅСЊ ТЇС€С–РЅ Р¶РёРЅР°Р»РґС‹.",
                "РљРµР»РµСЃС– Т›Р°РґР°Рј: Р±СЂРѕРЅСЊРґС‹ СЂР°СЃС‚Р°Сѓ Р¶У™РЅРµ С‚У©Р»РµРј СЃС–Р»С‚РµРјРµСЃС–.",
            ]
        return [
            "РџРѕРґРіРѕС‚РѕРІРёР» РІР°СЂРёР°РЅС‚ РґР»СЏ Р±СЂРѕРЅРёСЂРѕРІР°РЅРёСЏ.",
            "РЎРѕР±РёСЂР°СЋ РґР°РЅРЅС‹Рµ РіРѕСЃС‚СЏ РґР»СЏ СЃРѕР·РґР°РЅРёСЏ Р±СЂРѕРЅРё.",
            "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РїРѕРґС‚РІРµСЂРґРёС‚СЊ Р±СЂРѕРЅСЊ Рё РїРµСЂРµР№С‚Рё Рє РѕРїР»Р°С‚Рµ.",
        ]

    if stage == "payment_link":
        if lang == "en":
            return [
                "Booking draft prepared.",
                "Payment link is ready.",
                "Next: complete payment to confirm reservation.",
            ]
        if lang == "kz":
            return [
                "Р‘СЂРѕРЅСЊ С‡РµСЂРЅРѕРІРёРіС– РґР°Р№С‹РЅ.",
                "РўУ©Р»РµРј СЃС–Р»С‚РµРјРµСЃС– РґР°Р№С‹РЅ.",
                "РљРµР»РµСЃС– Т›Р°РґР°Рј: С‚У©Р»РµРј Р¶Р°СЃР°Рї, Р±СЂРѕРЅСЊРґС‹ СЂР°СЃС‚Р°Сѓ.",
            ]
        return [
            "Р§РµСЂРЅРѕРІРёРє Р±СЂРѕРЅРё РіРѕС‚РѕРІ.",
            "РЎСЃС‹Р»РєР° РЅР° РѕРїР»Р°С‚Сѓ РїРѕРґРіРѕС‚РѕРІР»РµРЅР°.",
            "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РѕРїР»Р°С‚РёС‚СЊ Рё РїРѕРґС‚РІРµСЂРґРёС‚СЊ Р±СЂРѕРЅРёСЂРѕРІР°РЅРёРµ.",
        ]

    found = len(suggestions)
    if lang == "en":
        return [
            "Applied city, dates, guests, and budget filters.",
            f"Ranked best options by quality/price balance. Found: {found}.",
            "Next: choose one option and proceed to booking.",
        ]
    if lang == "kz":
        return [
            "ТљР°Р»Р°, РєТЇРЅРґРµСЂ, Т›РѕРЅР°Т› СЃР°РЅС‹ Р¶У™РЅРµ Р±СЋРґР¶РµС‚ СЃТЇР·РіС–Р»РµСЂС– Т›РѕР»РґР°РЅС‹Р»РґС‹.",
            f"Р‘Р°Т“Р°/СЃР°РїР° С‚РµТЈРіРµСЂС–РјС– Р±РѕР№С‹РЅС€Р° СЃТ±СЂС‹РїС‚Р°Р»РґС‹. РўР°Р±С‹Р»РґС‹: {found}.",
            "РљРµР»РµСЃС– Т›Р°РґР°Рј: Р±С–СЂ РЅТ±СЃТ›Р°РЅС‹ С‚Р°ТЈРґР°Рї, Р±СЂРѕРЅСЊТ“Р° У©С‚Сѓ.",
        ]
    return [
        "РџСЂРёРјРµРЅРёР» С„РёР»СЊС‚СЂС‹: РіРѕСЂРѕРґ, РґР°С‚С‹, РіРѕСЃС‚Рё, Р±СЋРґР¶РµС‚.",
        f"РћС‚СЂР°РЅР¶РёСЂРѕРІР°Р» РїРѕ Р±Р°Р»Р°РЅСЃСѓ С†РµРЅР°/РєР°С‡РµСЃС‚РІРѕ. РќР°Р№РґРµРЅРѕ: {found}.",
        "РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: РІС‹Р±СЂР°С‚СЊ РІР°СЂРёР°РЅС‚ Рё РїРµСЂРµР№С‚Рё Рє Р±СЂРѕРЅРё.",
    ]


def _compose_manager_message(
    lang: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"] = "search",
) -> str:
    if stage == "handoff":
        return _compose_handoff_message(lang)

    missing_question = _first_missing_question(lang, filters)
    if stage == "collect" and missing_question:
        return missing_question

    if suggestions:
        top = suggestions[:3]
        city_hint = filters.city or top[0].city
        if lang == "en":
            lines = [f"I found {len(top)} best options in {city_hint}:"]
            for idx, s in enumerate(top, start=1):
                lines.append(f"{idx}) {s.title} вЂ” {s.district}, {s.city}")
                lines.append(f"   {int(round(s.nightly_price))} KZT / night вЂў rating {s.rating:.1f}")
            lines.append("I can book your preferred option right away.")
            return "\n".join(lines)
        if lang == "kz":
            lines = [f"{city_hint} Р±РѕР№С‹РЅС€Р° {len(top)} ТЇР·РґС–Рє РЅТ±СЃТ›Р° С‚Р°Р±С‹Р»РґС‹:"]
            for idx, s in enumerate(top, start=1):
                lines.append(f"{idx}) {s.title} вЂ” {s.district}, {s.city}")
                lines.append(f"   {int(round(s.nightly_price))} в‚ё / С‚ТЇРЅ вЂў СЂРµР№С‚РёРЅРі {s.rating:.1f}")
            lines.append("Т°РЅР°Т“Р°РЅ РЅТ±СЃТ›Р°РЅС‹ Т›Р°Р·С–СЂ Р±СЂРѕРЅСЊРґР°Рї Р±РµСЂРµ Р°Р»Р°РјС‹РЅ.")
            return "\n".join(lines)
        lines = [f"РџРѕРґРѕР±СЂР°Р» {len(top)} Р»СѓС‡С€РёС… РІР°СЂРёР°РЅС‚Р° РІ {city_hint}:"]
        for idx, s in enumerate(top, start=1):
            lines.append(f"{idx}) {s.title} вЂ” {s.district}, {s.city}")
            lines.append(f"   {int(round(s.nightly_price))} в‚ё / РЅРѕС‡СЊ вЂў СЂРµР№С‚РёРЅРі {s.rating:.1f}")
        lines.append("Р•СЃР»Рё С…РѕС‚РёС‚Рµ, СЃСЂР°Р·Сѓ РѕС„РѕСЂРјР»СЋ Р±СЂРѕРЅСЊ РЅР° РІС‹Р±СЂР°РЅРЅС‹Р№ РІР°СЂРёР°РЅС‚.")
        return "\n".join(lines)

    if alternatives:
        first = alternatives[0]
        if lang == "en":
            return (
                "There are no exact matches for requested dates. "
                f"Nearest option: {first.title} ({first.suggested_check_in} в†’ {first.suggested_check_out}). "
                "I can apply these dates now."
            )
        if lang == "kz":
            return (
                "РЎТ±СЂР°Р»Т“Р°РЅ РєТЇРЅРґРµСЂРіРµ РґУ™Р» Р±РѕСЃ РЅТ±СЃТ›Р° Р°Р·. "
                f"Р•ТЈ Р¶Р°Т›С‹РЅ РЅТ±СЃТ›Р°: {first.title} ({first.suggested_check_in} в†’ {first.suggested_check_out}). "
                "РћСЃС‹ РєТЇРЅРґРµСЂРґС– Р±С–СЂРґРµРЅ Т›РѕР»РґР°РЅР°Р№С‹РЅ Р±Р°?"
            )
        return (
            "РќР° РІС‹Р±СЂР°РЅРЅС‹Рµ РґР°С‚С‹ С‚РѕС‡РЅС‹С… СЃРІРѕР±РѕРґРЅС‹С… РІР°СЂРёР°РЅС‚РѕРІ РјР°Р»Рѕ. "
            f"Р‘Р»РёР¶Р°Р№С€РёР№ РІР°СЂРёР°РЅС‚: {first.title} ({first.suggested_check_in} в†’ {first.suggested_check_out}). "
            "РџСЂРёРјРµРЅРёС‚СЊ СЌС‚Рё РґР°С‚С‹?"
        )

    if lang == "en":
        return "No suitable options right now. I can try nearby districts, other dates, or adjust budget."
    if lang == "kz":
        return "ТљР°Р·С–СЂ Р»Р°Р№С‹Т› РЅТ±СЃТ›Р° С‚Р°Р±С‹Р»РјР°РґС‹. РљУ©СЂС€С– Р°СѓРґР°РЅ, Р±Р°СЃТ›Р° РєТЇРЅ РЅРµРјРµСЃРµ Р±СЋРґР¶РµС‚РїРµРЅ Т›Р°Р№С‚Р° С–Р·РґРµРї РєУ©СЂРµРјС–РЅ."
    return "РЎРµР№С‡Р°СЃ РїРѕРґС…РѕРґСЏС‰РёС… РІР°СЂРёР°РЅС‚РѕРІ РјР°Р»Рѕ. РњРѕРіСѓ РїСЂРµРґР»РѕР¶РёС‚СЊ СЃРѕСЃРµРґРЅРёР№ СЂР°Р№РѕРЅ, РґСЂСѓРіРёРµ РґР°С‚С‹ РёР»Рё РґСЂСѓРіРѕР№ Р±СЋРґР¶РµС‚."


def _compose_client_reasoning(
    lang: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
) -> str:
    if suggestions:
        top = suggestions[0]
        if lang == "en":
            return (
                f"Focused on city={filters.city or top.city}, dates, guests and budget first; "
                f"then ranked by value and rating. Top option: {top.title} ({top.rating:.1f}/5)."
            )
        if lang == "kz":
            return (
                f"РђР»РґС‹РјРµРЅ Т›Р°Р»Р°/РєТЇРЅ/Т›РѕРЅР°Т›/Р±СЋРґР¶РµС‚ СЃТЇР·РіС–Р»РµСЂС–РЅ Т›РѕР»РґР°РЅРґС‹Рј, "
                f"СЃРѕСЃС‹РЅ Р±Р°Т“Р°/СЃР°РїР° Р±РѕР№С‹РЅС€Р° СЃТ±СЂС‹РїС‚Р°РґС‹Рј. Р•ТЈ РјС‹Т›С‚С‹СЃС‹: {top.title} ({top.rating:.1f}/5)."
            )
        return (
            f"РЎРЅР°С‡Р°Р»Р° РїСЂРёРјРµРЅРёР» С„РёР»СЊС‚СЂС‹ РїРѕ РіРѕСЂРѕРґСѓ, РґР°С‚Р°Рј, РіРѕСЃС‚СЏРј Рё Р±СЋРґР¶РµС‚Сѓ, "
            f"РїРѕС‚РѕРј РѕС‚СЂР°РЅР¶РёСЂРѕРІР°Р» РїРѕ С†РµРЅРµ/РєР°С‡РµСЃС‚РІСѓ Рё СЂРµР№С‚РёРЅРіСѓ. РўРѕРї-РІР°СЂРёР°РЅС‚: {top.title} ({top.rating:.1f}/5)."
        )
    if alternatives:
        if lang == "en":
            return "Exact dates are busy, so I prepared nearest available alternatives."
        if lang == "kz":
            return "РќР°Т›С‚С‹ РєТЇРЅРґРµСЂ Р±РѕСЃ РµРјРµСЃ, СЃРѕРЅРґС‹Т›С‚Р°РЅ РµТЈ Р¶Р°Т›С‹РЅ Р±РѕСЃ РєТЇРЅРґРµСЂРґС– Т±СЃС‹РЅРґС‹Рј."
        return "РќР° С‚РѕС‡РЅС‹Рµ РґР°С‚С‹ РІР°СЂРёР°РЅС‚РѕРІ РјР°Р»Рѕ, РїРѕСЌС‚РѕРјСѓ РїРѕРґРіРѕС‚РѕРІРёР» Р±Р»РёР¶Р°Р№С€РёРµ РґРѕСЃС‚СѓРїРЅС‹Рµ Р°Р»СЊС‚РµСЂРЅР°С‚РёРІС‹."
    if lang == "en":
        return "Need one more key parameter to narrow the shortlist."
    if lang == "kz":
        return "Р”У™Р» С–СЂС–РєС‚РµСѓ ТЇС€С–РЅ Р±С–СЂ РЅРµРіС–Р·РіС– РїР°СЂР°РјРµС‚СЂ Р¶РµС‚С–СЃРїРµР№РґС–."
    return "Р”Р»СЏ С‚РѕС‡РЅРѕРіРѕ РїРѕРґР±РѕСЂР° РЅРµ С…РІР°С‚Р°РµС‚ РѕРґРЅРѕРіРѕ РєР»СЋС‡РµРІРѕРіРѕ РїР°СЂР°РјРµС‚СЂР°."


def _build_next_action(
    lang: str,
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"],
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
) -> ChatNextAction | None:
    if lang == "en":
        labels = {
            "apply_filters": "Apply filters in search",
            "start_booking": "Start booking now",
            "apply_alternative_dates": "Apply nearest dates",
            "go_checkout": "Go to checkout",
            "handoff_contact": "Share booking ID and phone",
        }
    elif lang == "kz":
        labels = {
            "apply_filters": "Іздеуге сүзгілерді қолдану",
            "start_booking": "Қазір брондауды бастау",
            "apply_alternative_dates": "Жақын бос күндерді қолдану",
            "go_checkout": "Рәсімдеуге өту",
            "handoff_contact": "Бронь нөмірі мен телефонды жіберу",
        }
    else:
        labels = {
            "apply_filters": "Применить фильтры в поиске",
            "start_booking": "Начать бронирование",
            "apply_alternative_dates": "Применить ближайшие даты",
            "go_checkout": "Перейти к оформлению",
            "handoff_contact": "Указать номер брони и телефон",
        }

    if stage == "handoff":
        return ChatNextAction(type="handoff_contact", label=labels["handoff_contact"])

    if stage in ("search", "pricing", "booking") and suggestions:
        top = suggestions[0]
        action_type = "go_checkout" if stage == "booking" and filters.check_in and filters.check_out and filters.guests else "start_booking"
        return ChatNextAction(
            type=action_type,
            label=labels[action_type],
            listing_id=top.listing_id,
            title=top.title,
            city=top.city,
            check_in=filters.check_in,
            check_out=filters.check_out,
            guests=filters.guests,
        )

    if stage == "availability" and alternatives:
        alt = alternatives[0]
        return ChatNextAction(
            type="apply_alternative_dates",
            label=labels["apply_alternative_dates"],
            listing_id=alt.listing_id,
            title=alt.title,
            city=alt.city,
            check_in=alt.suggested_check_in,
            check_out=alt.suggested_check_out,
            guests=filters.guests,
        )

    if stage == "collect" and (filters.city or filters.check_in or filters.check_out or filters.guests):
        return ChatNextAction(
            type="apply_filters",
            label=labels["apply_filters"],
            city=filters.city,
            check_in=filters.check_in,
            check_out=filters.check_out,
            guests=filters.guests,
        )
    return None


def _compose_handoff_message(lang: str) -> str:
    if lang == "en":
        return "Understood. I am handing this request to a human specialist. Please share reservation ID and contact phone."
    if lang == "kz":
        return "Түсіндім. Сұрауды тірі маманға жіберемін. Бронь нөмірі мен байланыс телефонын жазыңыз."
    return "Понял вас. Передаю запрос живому специалисту. Напишите номер брони и контактный телефон."


def _first_missing_question(lang: str, filters: ChatSuggestedFilters, source_text: str | None = None) -> str | None:
    if not filters.city:
        if lang == "en":
            return "Which city are you considering?"
        if lang == "kz":
            return "Қай қала керек?"
        return "Какой город рассматриваете?"
    if not filters.check_in or not filters.check_out:
        nights = _extract_nights(source_text or "")
        if nights:
            if lang == "en":
                return f"Got it, {nights} nights. What check-in date works for you?"
            if lang == "kz":
                return f"Түсіндім, {nights} түн. Қай күннен бастаймыз?"
            return f"Понял, {nights} ночи. С какой даты нужен заезд?"
        if lang == "en":
            return "What are your check-in and check-out dates?"
        if lang == "kz":
            return "Заезд және шығу күндерін айтыңызшы."
        return "На какие даты нужен заезд и выезд?"
    if not filters.guests:
        if lang == "en":
            return "How many guests?"
        if lang == "kz":
            return "Қанша қонақ болады?"
        return "Сколько будет гостей?"
    return None


def _build_follow_ups(lang: str, filters: ChatSuggestedFilters) -> list[str]:
    if lang == "en":
        base = ["Show cheaper", "Only with parking", "Closer to center"]
        if filters.city:
            base.append(f"Only in {filters.city}")
        if filters.check_in and filters.check_out:
            base.append("Show nearest available dates")
        return base[:4]
    if lang == "kz":
        base = ["Арзанырақ", "Тек паркингімен", "Орталыққа жақын"]
        if filters.city:
            base.append(f"Тек {filters.city}")
        if filters.check_in and filters.check_out:
            base.append("Жақын бос күндер")
        return base[:4]
    base = ["Покажи дешевле", "Только с парковкой", "Ближе к центру"]
    if filters.city:
        base.append(f"Только в {filters.city}")
    if filters.check_in and filters.check_out:
        base.append("Покажи ближайшие свободные даты")
    return base[:4]


def _build_workflow_steps(
    lang: str,
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"],
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
) -> list[str]:
    found = len(suggestions)
    ru_steps = {
        "handoff": [
            "Передал запрос живому специалисту.",
            "Кейс поставлен в приоритетную очередь.",
            "Следующий шаг: номер брони и контактный телефон.",
        ],
        "collect": [
            "Понял ваш запрос.",
            "Для точного подбора не хватает одного параметра.",
            "Дальше сузим варианты и перейдем к брони.",
        ],
        "availability": [
            "Проверил доступность по броням и блокам.",
            "Если нужно, подготовил ближайшие свободные даты.",
            "Следующий шаг: подтвердить даты и продолжить.",
        ],
        "pricing": [
            "Посчитал финальную стоимость с сервисными сборами.",
            "Сравнил варианты по цене и качеству.",
            "Следующий шаг: выбрать вариант и перейти к оформлению.",
        ],
        "booking": [
            "Подготовил вариант для бронирования.",
            "Собираю данные гостя для черновика брони.",
            "Следующий шаг: подтвердить бронь и перейти к оплате.",
        ],
        "payment_link": [
            "Черновик брони готов.",
            "Ссылка на оплату подготовлена.",
            "Следующий шаг: оплатить и подтвердить бронирование.",
        ],
        "search": [
            "Применил фильтры: город, даты, гости и бюджет.",
            f"Отранжировал варианты по балансу цены и качества. Найдено: {found}.",
            "Следующий шаг: выбрать вариант и перейти к брони.",
        ],
    }
    if lang == "en":
        en_steps = {
            "handoff": ["Escalated to a human specialist.", "Ticket created with high-priority context.", "Next: share booking ID and contact phone."],
            "collect": ["Captured your request context.", "Collecting one missing detail for precise matching.", "Then I will narrow options and prepare booking."],
            "availability": ["Checked availability against booked and blocked ranges.", "Prepared nearest available alternatives when needed.", "Next: confirm dates and proceed."],
            "pricing": ["Estimated final trip price including service fees.", "Compared options by value-for-money.", "Next: choose option and go to checkout."],
            "booking": ["Prepared booking-ready option.", "Collected guest details for reservation draft.", "Next: confirm booking and send payment link."],
            "payment_link": ["Booking draft prepared.", "Payment link is ready.", "Next: complete payment to confirm reservation."],
            "search": ["Applied city, dates, guests, and budget filters.", f"Ranked best options by quality/price balance. Found: {found}.", "Next: choose one option and proceed to booking."],
        }
        return en_steps[stage]
    if lang == "kz":
        kz_steps = {
            "handoff": ["Сұрау тірі маманға жіберілді.", "Кейс қолдау кезегіне тіркелді.", "Келесі қадам: бронь нөмірі мен телефон."],
            "collect": ["Сұрауыңыздың контекстін түсіндім.", "Дәл іріктеу үшін бір параметр жетіспейді.", "Содан кейін нұсқаларды тарылтып, броньға өтемін."],
            "availability": ["Қолжетімділік бронь және блоктармен тексерілді.", "Керек болса жақын бос күндер дайындалды.", "Келесі қадам: күндерді бекіту және жалғастыру."],
            "pricing": ["Қызметтік төлемдерді қоса баға есептелді.", "Нұсқалар баға/сапа бойынша салыстырылды.", "Келесі қадам: нұсқаны таңдап, рәсімдеуге өту."],
            "booking": ["Броньға дайын нұсқа таңдалды.", "Қонақ деректері бронь черновигі үшін жиналды.", "Келесі қадам: броньды растау және төлем сілтемесі."],
            "payment_link": ["Бронь черновигі дайын.", "Төлем сілтемесі дайын.", "Келесі қадам: төлем жасап, броньды растау."],
            "search": ["Қала, күндер, қонақ саны және бюджет сүзгілері қолданылды.", f"Баға/сапа теңгерімі бойынша сұрыпталды. Табылды: {found}.", "Келесі қадам: бір нұсқаны таңдап, броньға өту."],
        }
        return kz_steps[stage]
    return ru_steps[stage]


def _compose_manager_message(
    lang: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"] = "search",
) -> str:
    if stage == "handoff":
        return _compose_handoff_message(lang)

    missing_question = _first_missing_question(lang, filters)
    if stage == "collect" and missing_question:
        return missing_question

    if suggestions:
        top = suggestions[:3]
        city_hint = filters.city or top[0].city
        if lang == "en":
            lines = [f"I found {len(top)} best options in {city_hint}:"]
            for idx, item in enumerate(top, start=1):
                lines.append(f"{idx}) {item.title} - {item.district}, {item.city}")
                lines.append(f"   {int(round(item.nightly_price))} KZT / night, rating {item.rating:.1f}")
            lines.append("I can book your preferred option right away.")
            return "\n".join(lines)
        if lang == "kz":
            lines = [f"{city_hint} бойынша {len(top)} үздік нұсқа табылды:"]
            for idx, item in enumerate(top, start=1):
                lines.append(f"{idx}) {item.title} - {item.district}, {item.city}")
                lines.append(f"   {int(round(item.nightly_price))} KZT / түн, рейтинг {item.rating:.1f}")
            lines.append("Ұнаған нұсқаны қазір броньдап бере аламын.")
            return "\n".join(lines)
        lines = [f"Подобрал {len(top)} лучших варианта в {city_hint}:"]
        for idx, item in enumerate(top, start=1):
            lines.append(f"{idx}) {item.title} - {item.district}, {item.city}")
            lines.append(f"   {int(round(item.nightly_price))} KZT / ночь, рейтинг {item.rating:.1f}")
        lines.append("Если хотите, сразу оформлю бронь на выбранный вариант.")
        return "\n".join(lines)

    if alternatives:
        first = alternatives[0]
        if lang == "en":
            return (
                "There are no exact matches for requested dates. "
                f"Nearest option: {first.title} ({first.suggested_check_in} -> {first.suggested_check_out}). "
                "I can apply these dates now."
            )
        if lang == "kz":
            return (
                "Таңдалған күндерге дәл бос нұсқа аз. "
                f"Ең жақын нұсқа: {first.title} ({first.suggested_check_in} -> {first.suggested_check_out}). "
                "Осы күндерді бірден қолданайын ба?"
            )
        return (
            "На выбранные даты точных свободных вариантов мало. "
            f"Ближайший вариант: {first.title} ({first.suggested_check_in} -> {first.suggested_check_out}). "
            "Применить эти даты?"
        )

    if lang == "en":
        return "No suitable options right now. I can try nearby districts, other dates, or adjust budget."
    if lang == "kz":
        return "Қазір лайық нұсқа табылмады. Көрші аудан, басқа күн немесе басқа бюджетпен қайта іздеп көремін."
    return "Сейчас подходящих вариантов мало. Могу предложить соседний район, другие даты или другой бюджет."


def _compose_client_reasoning(
    lang: str,
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
) -> str:
    if suggestions:
        top = suggestions[0]
        if lang == "en":
            return (
                f"Focused on city={filters.city or top.city}, dates, guests and budget first; "
                f"then ranked by value and rating. Top option: {top.title} ({top.rating:.1f}/5)."
            )
        if lang == "kz":
            return (
                f"Алдымен қала/күн/қонақ/бюджет сүзгілерін қолдандым, "
                f"сосын баға, сапа және рейтинг бойынша сұрыптадым. Үздік нұсқа: {top.title} ({top.rating:.1f}/5)."
            )
        return (
            f"Сначала применил фильтры по городу, датам, гостям и бюджету, "
            f"потом отсортировал по цене, качеству и рейтингу. Лучший вариант: {top.title} ({top.rating:.1f}/5)."
        )
    if alternatives:
        if lang == "en":
            return "Exact dates are busy, so I prepared nearest available alternatives."
        if lang == "kz":
            return "Нақты күндер бос емес, сондықтан ең жақын бос күндерді ұсындым."
        return "На точные даты вариантов мало, поэтому подготовил ближайшие доступные альтернативы."
    if lang == "en":
        return "Need one more key parameter to narrow the shortlist."
    if lang == "kz":
        return "Дәл іріктеу үшін бір негізгі параметр жетіспейді."
    return "Для точного подбора не хватает одного ключевого параметра."


def _build_next_action(
    lang: str,
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"],
    filters: ChatSuggestedFilters,
    suggestions: list[ChatSuggestion],
    alternatives: list[ChatAlternative],
) -> ChatNextAction | None:
    if lang == "en":
        labels = {
            "apply_filters": "Apply filters in search",
            "start_booking": "Start booking now",
            "apply_alternative_dates": "Apply nearest dates",
            "go_checkout": "Go to checkout",
            "handoff_contact": "Share booking ID and phone",
        }
    elif lang == "kz":
        labels = {
            "apply_filters": "Іздеуге сүзгілерді қолдану",
            "start_booking": "Қазір брондауды бастау",
            "apply_alternative_dates": "Жақын бос күндерді қолдану",
            "go_checkout": "Рәсімдеуге өту",
            "handoff_contact": "Бронь нөмірі мен телефонды жіберу",
        }
    else:
        labels = {
            "apply_filters": "Применить фильтры в поиске",
            "start_booking": "Начать бронирование",
            "apply_alternative_dates": "Применить ближайшие даты",
            "go_checkout": "Перейти к оформлению",
            "handoff_contact": "Указать номер брони и телефон",
        }

    if stage == "handoff":
        return ChatNextAction(type="handoff_contact", label=labels["handoff_contact"])

    if stage in ("search", "pricing", "booking") and suggestions:
        top = suggestions[0]
        action_type = "go_checkout" if stage == "booking" and filters.check_in and filters.check_out and filters.guests else "start_booking"
        return ChatNextAction(
            type=action_type,
            label=labels[action_type],
            listing_id=top.listing_id,
            title=top.title,
            city=top.city,
            check_in=filters.check_in,
            check_out=filters.check_out,
            guests=filters.guests,
        )

    if stage == "availability" and alternatives:
        alt = alternatives[0]
        return ChatNextAction(
            type="apply_alternative_dates",
            label=labels["apply_alternative_dates"],
            listing_id=alt.listing_id,
            title=alt.title,
            city=alt.city,
            check_in=alt.suggested_check_in,
            check_out=alt.suggested_check_out,
            guests=filters.guests,
        )

    if stage == "collect" and (filters.city or filters.check_in or filters.check_out or filters.guests):
        return ChatNextAction(
            type="apply_filters",
            label=labels["apply_filters"],
            city=filters.city,
            check_in=filters.check_in,
            check_out=filters.check_out,
            guests=filters.guests,
        )
    return None


# Final hotfix override for natural date parsing.
# NOTE: This must stay at file end so it overrides earlier duplicated versions.
def _month_from_token(token: str | None) -> int | None:
    if not token:
        return None
    value = token.strip().lower().replace(".", "")
    if not value:
        return None

    month_stems: dict[int, tuple[str, ...]] = {
        1: ("янв", "january", "jan", "СЏРЅРІ"),
        2: ("фев", "february", "feb", "С„РµРІ"),
        3: ("мар", "march", "mar", "РјР°СЂ"),
        4: ("апр", "april", "apr", "Р°РїСЂ"),
        5: ("май", "мая", "may", "РјР°Р№", "РјР°СЏ"),
        6: ("июн", "june", "jun", "РёСЋРЅ"),
        7: ("июл", "july", "jul", "РёСЋР»"),
        8: ("авг", "august", "aug", "Р°РІРі"),
        9: ("сен", "сент", "september", "sep", "СЃРµРЅ", "СЃРµРЅС‚"),
        10: ("окт", "october", "oct", "РѕРєС‚"),
        11: ("ноя", "нояб", "november", "nov", "РЅРѕСЏ", "РЅРѕСЏР±"),
        12: ("дек", "декаб", "december", "dec", "РґРµРє", "РґРµРєР°Р±"),
    }
    for month, stems in month_stems.items():
        if any(value.startswith(stem) for stem in stems):
            return month
    return None


def _extract_date_range(text: str) -> tuple[str | None, str | None]:
    low = (text or "").lower()
    candidates: list[tuple[int, date]] = []
    for pattern in (r"\d{4}-\d{2}-\d{2}", r"\d{2}\.\d{2}\.\d{4}"):
        for match in re.finditer(pattern, low):
            parsed = _parse_date_token(match.group(0))
            if parsed:
                candidates.append((match.start(), parsed))
    if len(candidates) >= 2:
        candidates.sort(key=lambda item: item[0])
        first = candidates[0][1]
        second = candidates[1][1]
        if second > first:
            return first.isoformat(), second.isoformat()

    today = date.today()
    nights = _extract_nights(low) or 1
    if "послезавтра" in low or "РїРѕСЃР»РµР·Р°РІС‚СЂР°" in low or "day after tomorrow" in low:
        start = today + timedelta(days=2)
        return start.isoformat(), (start + timedelta(days=nights)).isoformat()
    if "завтра" in low or "Р·Р°РІС‚СЂР°" in low or "tomorrow" in low:
        start = today + timedelta(days=1)
        return start.isoformat(), (start + timedelta(days=nights)).isoformat()
    if "сегодня" in low or "СЃРµРіРѕРґРЅСЏ" in low or "today" in low:
        return today.isoformat(), (today + timedelta(days=nights)).isoformat()

    def _build_range_dates(day1: int, month1: int, day2: int, month2: int) -> tuple[date, date] | None:
        today_local = date.today()
        base_year = today_local.year
        for offset in (0, 1):
            start_year = base_year + offset
            end_year = start_year + (1 if (month2, day2) <= (month1, day1) else 0)
            try:
                start = date(start_year, month1, day1)
                end = date(end_year, month2, day2)
            except ValueError:
                return None
            if end > start and end > today_local:
                return start, end
        return None

    same_month = re.search(
        r"(?:с\s*)?(\d{1,2})\s*(?:-|–|—|по|to|РїРѕ)\s*(\d{1,2})\s+([a-zа-яё]+)",
        low,
    )
    if same_month:
        day1 = int(same_month.group(1))
        day2 = int(same_month.group(2))
        month = _month_from_token(same_month.group(3))
        if month:
            built = _build_range_dates(day1, month, day2, month)
            if built:
                return built[0].isoformat(), built[1].isoformat()

    split_month = re.search(
        r"(?:с\s*)?(\d{1,2})\s+([a-zа-яё]+)\s*(?:-|–|—|по|to|РїРѕ)\s*(\d{1,2})(?:\s+([a-zа-яё]+))?",
        low,
    )
    if split_month:
        day1 = int(split_month.group(1))
        month1 = _month_from_token(split_month.group(2))
        day2 = int(split_month.group(3))
        month2 = _month_from_token(split_month.group(4)) if split_month.group(4) else month1
        if month1 and month2:
            built = _build_range_dates(day1, month1, day2, month2)
            if built:
                return built[0].isoformat(), built[1].isoformat()

    month_first = re.search(
        r"(?:from\s*)?([a-zа-яё]+)\s+(\d{1,2})\s*(?:-|–|—|to|по|РїРѕ)\s*(?:([a-zа-яё]+)\s+)?(\d{1,2})",
        low,
    )
    if month_first:
        month1 = _month_from_token(month_first.group(1))
        day1 = int(month_first.group(2))
        month2 = _month_from_token(month_first.group(3)) if month_first.group(3) else month1
        day2 = int(month_first.group(4))
        if month1 and month2:
            built = _build_range_dates(day1, month1, day2, month2)
            if built:
                return built[0].isoformat(), built[1].isoformat()

    single_month_nights = re.search(
        r"(?:с\s*|from\s*)?(?:(\d{1,2})\s+([a-zа-яё]+)|([a-zа-яё]+)\s+(\d{1,2}))\s*(?:на|for)?\s*(\d{1,2})\s*(?:night|nights|ноч(?:ь|и|ей)|РЅРѕС‡[СЊРµРёР№])",
        low,
    )
    if single_month_nights:
        day_raw = single_month_nights.group(1) or single_month_nights.group(4)
        month_raw = single_month_nights.group(2) or single_month_nights.group(3)
        month = _month_from_token(month_raw)
        nights_count = int(single_month_nights.group(5))
        if day_raw and month and 1 <= nights_count <= 30:
            day = int(day_raw)
            today_local = date.today()
            for offset in (0, 1):
                try:
                    start = date(today_local.year + offset, month, day)
                except ValueError:
                    continue
                end = start + timedelta(days=nights_count)
                if end > today_local:
                    return start.isoformat(), end.isoformat()

    # Robust token fallback:
    # handles forms like "СЃ 1 РїРѕ 5 РјР°СЏ", "1-5 РјР°СЏ", "1 РјР°СЏ - 5 РјР°СЏ"
    # without depending on locale-specific separators.
    tokens = re.findall(r"\d{1,4}|[^\W\d_]{2,24}", low, flags=re.UNICODE)
    if tokens:
        for idx, token in enumerate(tokens):
            month = _month_from_token(token)
            if not month:
                continue
            day_positions = [
                (pos, int(value))
                for pos, value in enumerate(tokens[max(0, idx - 6):idx], start=max(0, idx - 6))
                if value.isdigit() and 1 <= int(value) <= 31
            ]
            if len(day_positions) < 2:
                continue
            day1 = day_positions[-2][1]
            day2 = day_positions[-1][1]
            built = _build_range_dates(day1, month, day2, month)
            if built:
                return built[0].isoformat(), built[1].isoformat()
    return None, None



