#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
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


def check_json_health(name: str, url: str, *, timeout: float, expected_status: int = 200) -> CheckResult:
    try:
        status, body = request_text(url, timeout=timeout)
    except HTTPError as exc:
        return CheckResult(name, False, f"HTTP {exc.code}")
    except (OSError, URLError) as exc:
        return CheckResult(name, False, str(exc))

    if status != expected_status:
        return CheckResult(name, False, f"HTTP {status}")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return CheckResult(name, False, "response is not JSON")

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

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return CheckResult("ops status", False, "response is not JSON")

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

    failed = False
    for result in results:
        prefix = "OK" if result.ok else "FAIL"
        print(f"{prefix}: {result.name}: {result.detail}")
        failed = failed or not result.ok

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
