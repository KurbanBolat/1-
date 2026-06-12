#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def request_text(url: str, *, timeout: float) -> tuple[int, str]:
    request = Request(url, headers={"User-Agent": "staypilot-smoke/1.0"})
    with urlopen(request, timeout=timeout) as response:
        status = int(response.status)
        body = response.read(1024 * 64).decode("utf-8", errors="replace")
    return status, body


def parse_json_body(body: str) -> tuple[dict | list | None, str | None]:
    try:
        return json.loads(body), None
    except json.JSONDecodeError:
        return None, "response is not JSON"


def request_json(url: str, *, timeout: float) -> tuple[int | None, dict | list | None, str | None]:
    try:
        status, body = request_text(url, timeout=timeout)
    except HTTPError as exc:
        return None, None, f"HTTP {exc.code}"
    except (OSError, URLError) as exc:
        return None, None, str(exc)

    payload, error = parse_json_body(body)
    if error:
        return status, None, error
    return status, payload, None


def check_json_health(name: str, url: str, *, timeout: float, expected_status: int = 200) -> CheckResult:
    try:
        status, body = request_text(url, timeout=timeout)
    except HTTPError as exc:
        return CheckResult(name, False, f"HTTP {exc.code}")
    except (OSError, URLError) as exc:
        return CheckResult(name, False, str(exc))

    if status != expected_status:
        return CheckResult(name, False, f"HTTP {status}")

    payload, error = parse_json_body(body)
    if error:
        return CheckResult(name, False, error)
    if not isinstance(payload, dict):
        return CheckResult(name, False, "response is not a JSON object")

    status_value = str(payload.get("status", "")).lower()
    if status_value not in {"ok", "ready"}:
        return CheckResult(name, False, f"unexpected status payload: {payload}")

    return CheckResult(name, True, f"HTTP {status}, status={status_value}")


def check_frontend(url: str, *, timeout: float) -> CheckResult:
    try:
        status, body = request_text(url, timeout=timeout)
    except HTTPError as exc:
        return CheckResult("frontend", False, f"HTTP {exc.code}")
    except (OSError, URLError) as exc:
        return CheckResult("frontend", False, str(exc))

    if status != 200:
        return CheckResult("frontend", False, f"HTTP {status}")

    body_lower = body.lower()
    if "<html" not in body_lower and "<!doctype html" not in body_lower:
        return CheckResult("frontend", False, "response does not look like HTML")

    return CheckResult("frontend", True, f"HTTP {status}, html received")


def _json_path(base_url: str, path: str, query: dict[str, str | int | float | None] | None = None) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    query_string = urlencode({key: value for key, value in (query or {}).items() if value is not None})
    return f"{normalize_base_url(base_url)}{suffix}{'?' + query_string if query_string else ''}"


def _require_json_dict(name: str, url: str, *, timeout: float) -> tuple[dict | None, CheckResult | None]:
    status, payload, error = request_json(url, timeout=timeout)
    if error:
        return None, CheckResult(name, False, error)
    if status != 200:
        return None, CheckResult(name, False, f"HTTP {status}")
    if not isinstance(payload, dict):
        return None, CheckResult(name, False, "response is not a JSON object")
    return payload, None


def _require_json_list(name: str, url: str, *, timeout: float) -> tuple[list | None, CheckResult | None]:
    status, payload, error = request_json(url, timeout=timeout)
    if error:
        return None, CheckResult(name, False, error)
    if status != 200:
        return None, CheckResult(name, False, f"HTTP {status}")
    if not isinstance(payload, list):
        return None, CheckResult(name, False, "response is not a JSON array")
    return payload, None


def check_catalog_flow(
    backend_url: str,
    *,
    city: str,
    guests: int,
    check_in: date,
    check_out: date,
    timeout: float,
    require_instay: bool,
) -> CheckResult:
    query = {
        "city": city,
        "guests": guests,
        "check_in": check_in.isoformat(),
        "check_out": check_out.isoformat(),
        "page_size": 1,
        "sort_by": "recommended",
    }
    payload, error_result = _require_json_dict(
        "catalog flow",
        _json_path(backend_url, "/listings", query),
        timeout=timeout,
    )
    if error_result:
        return error_result

    items = payload.get("items") if payload else None
    if not isinstance(items, list) or not items:
        return CheckResult("catalog flow", False, f"no public listings returned for city={city!r}")

    first = items[0]
    if not isinstance(first, dict) or not first.get("id") or not first.get("title"):
        return CheckResult("catalog flow", False, "first listing is missing id or title")

    try:
        listing_id = int(first["id"])
    except (TypeError, ValueError):
        return CheckResult("catalog flow", False, "first listing id is not numeric")
    detail, error_result = _require_json_dict("catalog flow", _json_path(backend_url, f"/listings/{listing_id}"), timeout=timeout)
    if error_result:
        return error_result
    if detail.get("id") != listing_id:
        return CheckResult("catalog flow", False, "listing detail id does not match catalog item")

    availability, error_result = _require_json_dict(
        "catalog flow",
        _json_path(
            backend_url,
            f"/listings/{listing_id}/room-availability",
            {
                "from_date": check_in.isoformat(),
                "to_date": check_out.isoformat(),
                "guests": guests,
            },
        ),
        timeout=timeout,
    )
    if error_result:
        return error_result

    room_types = availability.get("room_types") if availability else None
    if not isinstance(room_types, list) or not room_types:
        return CheckResult("catalog flow", False, f"listing {listing_id} has no room availability")
    has_available_room = False
    for room in room_types:
        if not isinstance(room, dict):
            continue
        try:
            available_count = int(room.get("available_count", 0))
        except (TypeError, ValueError):
            available_count = 0
        has_available_room = has_available_room or available_count > 0
    if not has_available_room:
        return CheckResult("catalog flow", False, f"listing {listing_id} has no available room count")

    checked = ["catalog", "detail", "room availability"]

    if require_instay:
        menu, error_result = _require_json_list("catalog flow", _json_path(backend_url, f"/in-stay/listings/{listing_id}/menu"), timeout=timeout)
        if error_result:
            return error_result
        if not menu:
            return CheckResult("catalog flow", False, f"listing {listing_id} has no room-service menu")

        restaurants, error_result = _require_json_list(
            "catalog flow",
            _json_path(backend_url, f"/in-stay/listings/{listing_id}/restaurants"),
            timeout=timeout,
        )
        if error_result:
            return error_result
        if not restaurants:
            return CheckResult("catalog flow", False, f"listing {listing_id} has no restaurants")
        checked.extend(["menu", "restaurants"])

    return CheckResult("catalog flow", True, f"listing_id={listing_id}, checked={', '.join(checked)}")


def check_ops_status(url: str, *, token: str, timeout: float) -> CheckResult:
    request = Request(
        f"{normalize_base_url(url)}/ops/status",
        headers={"User-Agent": "staypilot-smoke/1.0", "Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = int(response.status)
            body = response.read(1024 * 64).decode("utf-8", errors="replace")
    except HTTPError as exc:
        return CheckResult("ops status", False, f"HTTP {exc.code}")
    except (OSError, URLError) as exc:
        return CheckResult("ops status", False, str(exc))

    if status != 200:
        return CheckResult("ops status", False, f"HTTP {status}")

    payload, error = parse_json_body(body)
    if error:
        return CheckResult("ops status", False, error)
    if not isinstance(payload, dict):
        return CheckResult("ops status", False, "response is not a JSON object")

    ops_status = str(payload.get("status", "")).lower()
    if ops_status == "failed":
        return CheckResult("ops status", False, "status=failed")
    if ops_status not in {"ready", "degraded"}:
        return CheckResult("ops status", False, f"unexpected status={ops_status!r}")
    return CheckResult("ops status", True, f"status={ops_status}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-check a deployed StayPilot environment.")
    parser.add_argument("--backend-url", required=True, help="Public backend API origin, for example https://api.example.com")
    parser.add_argument("--frontend-url", help="Public frontend origin, for example https://app.example.com")
    parser.add_argument("--admin-token", help="Optional admin bearer token for /ops/status smoke check")
    parser.add_argument("--timeout", type=float, default=10.0, help="Request timeout in seconds")
    parser.add_argument("--require-catalog", action="store_true", help="Require a working listing/detail/room-availability flow")
    parser.add_argument("--require-instay", action="store_true", help="Also require menu and restaurant data for the smoke listing")
    parser.add_argument("--catalog-city", default="Dubai", help="City to use for catalog smoke checks")
    parser.add_argument("--catalog-guests", type=int, default=2, help="Guest count to use for catalog smoke checks")
    parser.add_argument("--catalog-check-in", type=date.fromisoformat, help="YYYY-MM-DD check-in date for catalog smoke checks")
    parser.add_argument("--catalog-check-out", type=date.fromisoformat, help="YYYY-MM-DD check-out date for catalog smoke checks")
    args = parser.parse_args()

    backend_url = normalize_base_url(args.backend_url)
    results = [
        check_json_health("backend live", f"{backend_url}/health/live", timeout=args.timeout),
        check_json_health("backend ready", f"{backend_url}/health/ready", timeout=args.timeout),
    ]

    if args.frontend_url:
        results.append(check_frontend(normalize_base_url(args.frontend_url), timeout=args.timeout))
    if args.admin_token:
        results.append(check_ops_status(backend_url, token=args.admin_token, timeout=args.timeout))
    if args.require_instay and not args.require_catalog:
        results.append(CheckResult("catalog flow", False, "--require-instay requires --require-catalog"))
    if args.require_catalog:
        check_in = args.catalog_check_in or (date.today() + timedelta(days=1))
        check_out = args.catalog_check_out or (check_in + timedelta(days=3))
        if check_out <= check_in:
            results.append(CheckResult("catalog flow", False, "catalog check-out must be after check-in"))
        else:
            results.append(
                check_catalog_flow(
                    backend_url,
                    city=args.catalog_city,
                    guests=args.catalog_guests,
                    check_in=check_in,
                    check_out=check_out,
                    timeout=args.timeout,
                    require_instay=args.require_instay,
                )
            )

    failed = False
    for result in results:
        prefix = "OK" if result.ok else "FAIL"
        print(f"{prefix}: {result.name}: {result.detail}")
        failed = failed or not result.ok

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
