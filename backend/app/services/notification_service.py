from __future__ import annotations

import json
import re
import smtplib
import time
from email.message import EmailMessage
from pathlib import Path

import httpx
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utc_now_iso_z
from app.models.listing import Listing
from app.models.reservation import Reservation
from app.models.user import User

RESERVATION_STATUS_EVENT_MAP: dict[str, str] = {
    "pending_payment": "reservation_pending_payment",
    "confirmed": "reservation_confirmed",
    "cancelled": "reservation_cancelled",
    "expired": "reservation_expired",
}
CHANNEL_RETRYABLE: dict[str, bool] = {
    "webhook": True,
    "email": True,
    "telegram": False,
}


def queue_partner_reservation_notification(
    background_tasks: BackgroundTasks,
    db: Session,
    reservation: Reservation,
) -> None:
    payload = _build_partner_payload(db, reservation, event="reservation_created")
    if payload is None:
        return
    background_tasks.add_task(_append_partner_notification_log, payload)
    background_tasks.add_task(_dispatch_all_channels, payload)


def emit_reservation_status_event(
    db: Session,
    reservation: Reservation,
    status: str,
) -> None:
    event = RESERVATION_STATUS_EVENT_MAP.get(status)
    if not event:
        return
    payload = _build_partner_payload(db, reservation, event=event)
    if payload is None:
        return
    _append_partner_notification_log(payload)
    _dispatch_all_channels(payload)


def retry_partner_notification_channel(
    db: Session,
    reservation: Reservation,
    event: str,
    channel: str,
) -> dict:
    payload = _build_partner_payload(db, reservation, event=event)
    if payload is None:
        raise ValueError("Unable to build partner payload")
    return _dispatch_channel_and_log(payload, channel)


def _build_partner_payload(db: Session, reservation: Reservation, event: str) -> dict | None:
    listing = db.get(Listing, reservation.listing_id)
    if not listing or not listing.owner_id:
        return None
    owner = db.get(User, listing.owner_id)
    if not owner:
        return None
    return {
        "event": event,
        "created_at": utc_now_iso_z(),
        "partner_email": owner.email,
        "partner_id": owner.id,
        "listing_id": listing.id,
        "listing_title": listing.title,
        "reservation_id": reservation.id,
        "guest_email": reservation.guest_email,
        "guest_name": reservation.guest_name,
        "check_in": reservation.check_in.isoformat(),
        "check_out": reservation.check_out.isoformat(),
        "guests": reservation.guests,
        "total_price": reservation.total_price,
        "currency": "KZT",
        "status": reservation.status,
    }


def _append_partner_notification_log(payload: dict) -> None:
    backend_root = Path(__file__).resolve().parents[2]
    log_dir = backend_root / "runtime_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "partner_notifications.log"
    _rotate_log_if_needed(log_file)
    sanitized_payload = _mask_pii_payload(payload)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(sanitized_payload, ensure_ascii=False) + "\n")


def _append_communication_event(entry: dict) -> None:
    backend_root = Path(__file__).resolve().parents[2]
    log_dir = backend_root / "runtime_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "communication_events.log"
    _rotate_log_if_needed(log_file)
    sanitized_entry = _mask_pii_payload(entry)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(sanitized_entry, ensure_ascii=False) + "\n")


def _dispatch_all_channels(payload: dict) -> None:
    _dispatch_channel_and_log(payload, "webhook")
    _dispatch_channel_and_log(payload, "email")
    _dispatch_channel_and_log(payload, "telegram")


def _dispatch_webhook(payload: dict) -> dict:
    url = settings.notification_webhook_url.strip()
    if not url:
        return {"status": "skipped", "reason": "webhook_not_configured"}
    try:
        response = httpx.post(url, json=payload, timeout=settings.notification_webhook_timeout_seconds)
        if response.status_code >= 400:
            return {
                "status": "failed",
                "reason": f"http_{response.status_code}",
            }
        return {"status": "sent", "reason": "ok"}
    except Exception as exc:
        return {"status": "failed", "reason": str(exc)}


def _dispatch_email(payload: dict) -> dict:
    if not settings.notification_email_enabled:
        return {"status": "skipped", "reason": "email_disabled"}
    required = [settings.smtp_host.strip(), settings.smtp_from_email.strip(), payload.get("partner_email", "").strip()]
    if not all(required):
        return {"status": "skipped", "reason": "email_not_configured"}

    subject = f"[StayPilot] {payload.get('event')} #{payload.get('reservation_id')}"
    body = (
        f"Event: {payload.get('event')}\n"
        f"Reservation: #{payload.get('reservation_id')}\n"
        f"Listing: {payload.get('listing_title')} ({payload.get('listing_id')})\n"
        f"Status: {payload.get('status')}\n"
        f"Dates: {payload.get('check_in')} -> {payload.get('check_out')}\n"
        f"Guests: {payload.get('guests')}\n"
        f"Total: {payload.get('total_price')} {payload.get('currency')}\n"
    )
    msg = EmailMessage()
    msg["From"] = settings.smtp_from_email
    msg["To"] = payload["partner_email"]
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=8) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_user.strip():
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return {"status": "sent", "reason": "ok"}
    except Exception as exc:
        return {"status": "failed", "reason": str(exc)}


def _dispatch_telegram(payload: dict) -> dict:
    if not settings.notification_telegram_enabled:
        return {"status": "skipped", "reason": "telegram_disabled"}
    token = settings.telegram_bot_token.strip()
    chat_id = settings.telegram_chat_id.strip()
    if not token or not chat_id:
        return {"status": "skipped", "reason": "telegram_not_configured"}

    text = (
        f"{payload.get('event')}\n"
        f"Reservation #{payload.get('reservation_id')}\n"
        f"{payload.get('listing_title')} ({payload.get('listing_id')})\n"
        f"{payload.get('check_in')} -> {payload.get('check_out')}, guests {payload.get('guests')}\n"
        f"{payload.get('total_price')} {payload.get('currency')}"
    )
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        response = httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=4.0)
        if response.status_code >= 400:
            return {"status": "failed", "reason": f"http_{response.status_code}"}
        return {"status": "sent", "reason": "ok"}
    except Exception as exc:
        return {"status": "failed", "reason": str(exc)}


def _dispatch_channel_and_log(payload: dict, channel: str) -> dict:
    dispatchers = {
        "webhook": _dispatch_webhook,
        "email": _dispatch_email,
        "telegram": _dispatch_telegram,
    }
    dispatch_fn = dispatchers.get(channel)
    if dispatch_fn is None:
        raise ValueError(f"Unsupported communication channel: {channel}")

    base_entry = {
        "partner_id": payload.get("partner_id"),
        "partner_email": payload.get("partner_email"),
        "listing_title": payload.get("listing_title"),
        "event": payload.get("event"),
        "reservation_id": payload.get("reservation_id"),
        "listing_id": payload.get("listing_id"),
    }
    result = _dispatch_with_retries(
        channel,
        payload,
        dispatch_fn,
        retryable=CHANNEL_RETRYABLE.get(channel, False),
    )
    entry = {
        "created_at": utc_now_iso_z(),
        "channel": channel,
        **base_entry,
        **result,
    }
    _append_communication_event(entry)
    return entry


def _dispatch_with_retries(
    channel: str,
    payload: dict,
    dispatch_fn,
    *,
    retryable: bool,
) -> dict:
    attempts = 1
    result = dispatch_fn(payload)
    max_attempts = max(1, int(settings.notification_retry_max_attempts))
    backoff = max(0.0, float(settings.notification_retry_backoff_seconds))

    if retryable:
        while result.get("status") == "failed" and attempts < max_attempts:
            delay = backoff * (2 ** (attempts - 1))
            if delay > 0:
                time.sleep(delay)
            attempts += 1
            result = dispatch_fn(payload)

    if not isinstance(result, dict):
        result = {"status": "failed", "reason": f"{channel}_invalid_dispatch_result"}
    if "status" not in result:
        result["status"] = "failed"
    if "reason" not in result:
        result["reason"] = "unknown"
    result["attempts"] = attempts
    result["retry_applied"] = retryable and attempts > 1
    return result


def _rotate_log_if_needed(log_file: Path) -> None:
    max_bytes = max(1024, int(settings.notification_log_rotate_max_bytes))
    backups = max(1, int(settings.notification_log_backup_count))
    if not log_file.exists():
        return
    try:
        if log_file.stat().st_size < max_bytes:
            return
    except OSError:
        return

    for idx in range(backups - 1, 0, -1):
        src = Path(f"{log_file}.{idx}")
        dst = Path(f"{log_file}.{idx + 1}")
        if src.exists():
            try:
                src.replace(dst)
            except OSError:
                pass
    first_backup = Path(f"{log_file}.1")
    try:
        log_file.replace(first_backup)
    except OSError:
        return
    for idx in range(backups + 1, backups + 6):
        stale = Path(f"{log_file}.{idx}")
        if stale.exists():
            try:
                stale.unlink()
            except OSError:
                pass


def _mask_email(value: str) -> str:
    cleaned = value.strip()
    if "@" not in cleaned:
        return cleaned
    local, domain = cleaned.split("@", 1)
    if not local:
        return f"***@{domain}"
    if len(local) == 1:
        return f"{local}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _mask_phone(value: str) -> str:
    digits = re.sub(r"\D+", "", value)
    if len(digits) < 4:
        return "***"
    return f"+***{digits[-4:]}"


def _mask_pii_payload(payload: dict) -> dict:
    if not settings.notification_log_mask_pii:
        return payload
    masked = dict(payload)
    email_keys = {"partner_email", "guest_email", "email"}
    phone_keys = {"guest_phone", "phone"}
    for key in email_keys:
        raw = masked.get(key)
        if isinstance(raw, str):
            masked[key] = _mask_email(raw)
    for key in phone_keys:
        raw = masked.get(key)
        if isinstance(raw, str):
            masked[key] = _mask_phone(raw)
    return masked
