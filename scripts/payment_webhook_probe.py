#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def build_payload(args: argparse.Namespace) -> dict[str, object]:
    event_id = args.event_id or "qa_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    payload: dict[str, object] = {
        "provider": args.provider,
        "event_id": event_id,
        "reservation_id": int(args.reservation_id),
        "status": args.status,
        "currency": args.currency,
    }
    if args.amount is not None:
        payload["amount"] = float(args.amount)
    if args.method:
        payload["method"] = args.method
    if args.idempotency_key:
        payload["idempotency_key"] = args.idempotency_key
    return payload


def signed_headers(body: bytes, secret: str) -> dict[str, str]:
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-StayPilot-Signature": f"sha256={signature}",
        "User-Agent": "staypilot-payment-webhook-probe/1.0",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a signed StayPilot payment webhook probe.")
    parser.add_argument("--api-url", help="Backend API origin, for example https://api.example.com")
    parser.add_argument("--env-file", default=".env.production")
    parser.add_argument("--secret", help="Override PAYMENT_WEBHOOK_SECRET")
    parser.add_argument("--provider", choices=["mock", "stripe", "kaspi", "manual"], default="manual")
    parser.add_argument("--event-id")
    parser.add_argument("--reservation-id", type=int, required=True)
    parser.add_argument("--status", choices=["pending", "paid", "failed"], default="failed")
    parser.add_argument("--amount", type=float)
    parser.add_argument("--currency", default="KZT")
    parser.add_argument("--method", choices=["card", "kaspi", "apple_pay"])
    parser.add_argument("--idempotency-key")
    parser.add_argument("--expect-http-status", type=int, default=200)
    parser.add_argument("--expect-process-status", choices=["processed", "rejected", "any"], default="any")
    parser.add_argument("--allow-unsigned", action="store_true", help="Allow sending without a signature secret")
    parser.add_argument("--yes", action="store_true", help="Actually send the webhook; without this, print a dry run")
    args = parser.parse_args()

    env = parse_env_file(resolve_path(args.env_file))
    api_url = normalize_base_url(args.api_url or os.environ.get("API_URL") or env.get("NEXT_PUBLIC_API_URL", ""))
    if not api_url:
        print("ERROR: --api-url or NEXT_PUBLIC_API_URL is required", file=sys.stderr)
        return 1

    secret = args.secret or os.environ.get("PAYMENT_WEBHOOK_SECRET") or env.get("PAYMENT_WEBHOOK_SECRET", "")
    if not secret and not args.allow_unsigned:
        print("ERROR: PAYMENT_WEBHOOK_SECRET is required unless --allow-unsigned is set", file=sys.stderr)
        return 1

    payload = build_payload(args)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = signed_headers(body, secret) if secret else {"Content-Type": "application/json"}

    print("Webhook payload:")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if secret:
        print(f"Signature: {headers['X-StayPilot-Signature']}")

    if not args.yes:
        print("Dry run only. Re-run with --yes to send.", file=sys.stderr)
        return 2

    request = Request(f"{api_url}/payments/webhook", data=body, headers=headers, method="POST")
    try:
        with urlopen(request, timeout=15) as response:
            status = int(response.status)
            response_body = response.read(1024 * 64).decode("utf-8", errors="replace")
    except HTTPError as exc:
        status = int(exc.code)
        response_body = exc.read(1024 * 64).decode("utf-8", errors="replace")
    except (OSError, URLError) as exc:
        print(f"ERROR: request failed: {exc}", file=sys.stderr)
        return 1

    print(f"HTTP {status}")
    print(response_body)

    if status != args.expect_http_status:
        print(f"ERROR: expected HTTP {args.expect_http_status}, got {status}", file=sys.stderr)
        return 1

    if args.expect_process_status != "any" and response_body:
        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError:
            print("ERROR: response is not JSON", file=sys.stderr)
            return 1
        actual = parsed.get("process_status")
        if actual != args.expect_process_status:
            print(f"ERROR: expected process_status={args.expect_process_status}, got {actual}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
