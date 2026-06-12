from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import smoke_production


def test_catalog_flow_smoke_checks_listing_availability_and_instay(monkeypatch):
    seen_paths: list[str] = []

    def fake_request_text(url: str, *, timeout: float) -> tuple[int, str]:
        parsed = urlparse(url)
        seen_paths.append(parsed.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/listings":
            assert query["city"] == ["Dubai"]
            assert query["guests"] == ["2"]
            return 200, json.dumps({"items": [{"id": 42, "title": "Address Beach Resort"}]})
        if parsed.path == "/listings/42":
            return 200, json.dumps({"id": 42, "title": "Address Beach Resort"})
        if parsed.path == "/listings/42/room-availability":
            assert query["from_date"] == ["2026-06-13"]
            assert query["to_date"] == ["2026-06-16"]
            return 200, json.dumps({"room_types": [{"id": 7, "name": "Deluxe", "available_count": 3}]})
        if parsed.path == "/in-stay/listings/42/menu":
            return 200, json.dumps([{"id": 1, "name": "Wagyu Burger"}])
        if parsed.path == "/in-stay/listings/42/restaurants":
            return 200, json.dumps([{"id": 2, "name": "Skyline Grill"}])

        raise AssertionError(f"unexpected smoke request: {url}")

    monkeypatch.setattr(smoke_production, "request_text", fake_request_text)

    result = smoke_production.check_catalog_flow(
        "http://api.test",
        city="Dubai",
        guests=2,
        check_in=date(2026, 6, 13),
        check_out=date(2026, 6, 16),
        timeout=1,
        require_instay=True,
    )

    assert result.ok is True
    assert "listing_id=42" in result.detail
    assert seen_paths == [
        "/listings",
        "/listings/42",
        "/listings/42/room-availability",
        "/in-stay/listings/42/menu",
        "/in-stay/listings/42/restaurants",
    ]


def test_catalog_flow_smoke_fails_when_catalog_is_empty(monkeypatch):
    def fake_request_text(url: str, *, timeout: float) -> tuple[int, str]:
        return 200, json.dumps({"items": []})

    monkeypatch.setattr(smoke_production, "request_text", fake_request_text)

    result = smoke_production.check_catalog_flow(
        "http://api.test",
        city="Dubai",
        guests=2,
        check_in=date(2026, 6, 13),
        check_out=date(2026, 6, 16),
        timeout=1,
        require_instay=False,
    )

    assert result.ok is False
    assert "no public listings" in result.detail
