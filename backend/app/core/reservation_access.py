from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

from app.core.config import settings


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _payload(reservation_id: int, guest_email: str) -> bytes:
    return json.dumps(
        {"rid": int(reservation_id), "email": guest_email.strip().lower()},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _signature(payload: bytes) -> bytes:
    return hmac.new(settings.secret_key.encode("utf-8"), payload, hashlib.sha256).digest()


def create_reservation_access_token(reservation_id: int, guest_email: str) -> str:
    payload = _payload(reservation_id, guest_email)
    return f"{_b64encode(payload)}.{_b64encode(_signature(payload))}"


def parse_reservation_access_token(token: str) -> dict[str, Any] | None:
    try:
        payload_part, signature_part = token.strip().split(".", 1)
        payload = _b64decode(payload_part)
        expected = _signature(payload)
        actual = _b64decode(signature_part)
        if not hmac.compare_digest(expected, actual):
            return None
        parsed = json.loads(payload.decode("utf-8"))
        if not isinstance(parsed, dict):
            return None
        return parsed
    except Exception:
        return None


def reservation_access_token_matches(token: str | None, reservation_id: int, guest_email: str) -> bool:
    if not token:
        return False
    parsed = parse_reservation_access_token(token)
    if not parsed:
        return False
    return parsed.get("rid") == int(reservation_id) and str(parsed.get("email", "")).lower() == guest_email.strip().lower()
