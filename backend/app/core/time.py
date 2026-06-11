from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return current UTC timestamp as naive datetime for DB compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_now_iso_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
