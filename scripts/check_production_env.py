#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


PLACEHOLDER_MARKERS = (
    "replace_with",
    "your-domain.example",
    "example.com",
    "changeme",
    "change_me",
    "<",
    ">",
)

REQUIRED_KEYS = (
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "SECRET_KEY",
    "CORS_ORIGINS",
    "NEXT_PUBLIC_API_URL",
    "AUTH_COOKIE_SECURE",
    "CSRF_ENFORCE",
    "PAYMENT_WEBHOOK_SECRET",
    "SENTRY_ENVIRONMENT",
)

BOOL_KEYS = (
    "AUTH_COOKIE_SECURE",
    "CSRF_ENFORCE",
    "NOTIFICATION_EMAIL_ENABLED",
    "NOTIFICATION_TELEGRAM_ENABLED",
    "SMTP_USE_TLS",
)

INT_KEYS = (
    "BACKEND_PORT",
    "FRONTEND_PORT",
    "SMTP_PORT",
    "API_RATE_LIMIT_PER_MINUTE",
    "CHAT_RATE_LIMIT_PER_MINUTE",
    "OBSERVABILITY_METRICS_WINDOW_MINUTES",
)

FLOAT_KEYS = (
    "SENTRY_TRACES_SAMPLE_RATE",
    "OBSERVABILITY_ALERT_PAYMENT_FAIL_RATE",
    "OBSERVABILITY_ALERT_COMMUNICATION_FAIL_RATE",
)


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"{path}:{line_number}: invalid env key {key!r}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def is_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def validate_url(value: str, *, key: str, production: bool, errors: list[str], warnings: list[str]) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        errors.append(f"{key} must be an absolute http(s) URL")
        return
    if parsed.path not in {"", "/"}:
        warnings.append(f"{key} includes a path; usually only the origin is expected")
    if production and parsed.scheme != "https":
        errors.append(f"{key} must use https in production")
    hostname = (parsed.hostname or "").lower()
    if production and hostname in {"localhost", "127.0.0.1", "::1"}:
        errors.append(f"{key} must not point to localhost in production")


def validate(env: dict[str, str], *, allow_placeholders: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    for key in REQUIRED_KEYS:
        if not env.get(key, "").strip():
            errors.append(f"{key} is required")

    if not allow_placeholders:
        for key, value in sorted(env.items()):
            if value.strip() and is_placeholder(value):
                errors.append(f"{key} still contains a placeholder value")

    for key in BOOL_KEYS:
        if key in env and env[key].strip().lower() not in {"", "1", "0", "true", "false", "yes", "no", "on", "off"}:
            errors.append(f"{key} must be boolean")

    for key in INT_KEYS:
        value = env.get(key, "").strip()
        if not value:
            continue
        try:
            parsed = int(value)
        except ValueError:
            errors.append(f"{key} must be an integer")
            continue
        if parsed <= 0:
            errors.append(f"{key} must be greater than 0")

    for key in FLOAT_KEYS:
        value = env.get(key, "").strip()
        if not value:
            continue
        try:
            parsed = float(value)
        except ValueError:
            errors.append(f"{key} must be a number")
            continue
        if key == "SENTRY_TRACES_SAMPLE_RATE" and not 0.0 <= parsed <= 1.0:
            errors.append("SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1")

    production = env.get("SENTRY_ENVIRONMENT", "").strip().lower() == "production"

    ai_mode = env.get("AI_CONCIERGE_MODE", "stub").strip().lower()
    if ai_mode not in {"stub", "live"}:
        errors.append("AI_CONCIERGE_MODE must be stub or live")
    if ai_mode == "live" and not env.get("OPENAI_API_KEY", "").strip():
        errors.append("OPENAI_API_KEY is required when AI_CONCIERGE_MODE=live")
    if ai_mode == "stub" and env.get("OPENAI_API_KEY", "").strip():
        warnings.append("OPENAI_API_KEY is set but AI_CONCIERGE_MODE=stub, so live GPT calls are disabled")

    payment_provider = env.get("PAYMENT_PROVIDER", "mock").strip().lower()
    if payment_provider not in {"mock", "manual", "stripe", "kaspi"}:
        errors.append("PAYMENT_PROVIDER must be mock, manual, stripe, or kaspi")
    public_payment_mode = env.get("NEXT_PUBLIC_PAYMENT_MODE", payment_provider).strip().lower()
    if public_payment_mode not in {"mock", "manual", "stripe", "kaspi"}:
        errors.append("NEXT_PUBLIC_PAYMENT_MODE must be mock, manual, stripe, or kaspi")
    if public_payment_mode != payment_provider:
        warnings.append("NEXT_PUBLIC_PAYMENT_MODE differs from PAYMENT_PROVIDER; checkout UI may describe the wrong payment mode")
    if production and payment_provider == "mock":
        warnings.append("PAYMENT_PROVIDER=mock is demo-only; use manual, stripe, or kaspi for real payments")
    if payment_provider == "stripe":
        for key in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
            if not env.get(key, "").strip():
                errors.append(f"{key} is required when PAYMENT_PROVIDER=stripe")
    if payment_provider == "kaspi":
        for key in ("KASPI_MERCHANT_ID", "KASPI_API_KEY", "KASPI_WEBHOOK_SECRET"):
            if not env.get(key, "").strip():
                errors.append(f"{key} is required when PAYMENT_PROVIDER=kaspi")

    secret_key = env.get("SECRET_KEY", "").strip()
    if secret_key and not allow_placeholders and len(secret_key) < 64:
        errors.append("SECRET_KEY must be at least 64 characters")

    postgres_password = env.get("POSTGRES_PASSWORD", "").strip()
    if postgres_password and not allow_placeholders and len(postgres_password) < 16:
        errors.append("POSTGRES_PASSWORD must be at least 16 characters")

    webhook_secret = env.get("PAYMENT_WEBHOOK_SECRET", "").strip()
    if webhook_secret and not allow_placeholders and len(webhook_secret) < 32:
        errors.append("PAYMENT_WEBHOOK_SECRET must be at least 32 characters")

    database_url = env.get("DATABASE_URL", "").strip()
    if database_url:
        parsed = urlparse(database_url)
        if parsed.scheme not in {"postgresql", "postgresql+psycopg"}:
            errors.append("DATABASE_URL must use postgresql or postgresql+psycopg")
        if production and parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
            errors.append("DATABASE_URL must not point to localhost in production")
        if postgres_password and not allow_placeholders and parsed.password and parsed.password != postgres_password:
            warnings.append("DATABASE_URL password differs from POSTGRES_PASSWORD")

    if production:
        if not truthy(env.get("AUTH_COOKIE_SECURE", "")):
            errors.append("AUTH_COOKIE_SECURE must be true in production")
        if not truthy(env.get("CSRF_ENFORCE", "")):
            errors.append("CSRF_ENFORCE must be true in production")

    samesite = env.get("AUTH_COOKIE_SAMESITE", "lax").strip().lower()
    if samesite and samesite not in {"lax", "strict", "none"}:
        errors.append("AUTH_COOKIE_SAMESITE must be lax, strict, or none")
    if samesite == "none" and not truthy(env.get("AUTH_COOKIE_SECURE", "")):
        errors.append("AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true")

    cors_origins = split_csv(env.get("CORS_ORIGINS", ""))
    if "*" in cors_origins:
        errors.append("CORS_ORIGINS must not contain '*'")
    for origin in cors_origins:
        validate_url(origin, key="CORS_ORIGINS", production=production, errors=errors, warnings=warnings)

    csrf_origins = split_csv(env.get("CSRF_TRUSTED_ORIGINS", ""))
    for origin in csrf_origins:
        validate_url(origin, key="CSRF_TRUSTED_ORIGINS", production=production, errors=errors, warnings=warnings)

    api_url = env.get("NEXT_PUBLIC_API_URL", "").strip()
    if api_url:
        validate_url(api_url, key="NEXT_PUBLIC_API_URL", production=production, errors=errors, warnings=warnings)

    if truthy(env.get("NOTIFICATION_EMAIL_ENABLED", "")):
        for key in ("SMTP_HOST", "SMTP_FROM_EMAIL"):
            if not env.get(key, "").strip():
                errors.append(f"{key} is required when NOTIFICATION_EMAIL_ENABLED=true")
        if env.get("SMTP_USER", "").strip() and not env.get("SMTP_PASSWORD", "").strip():
            errors.append("SMTP_PASSWORD is required when SMTP_USER is set")

    if truthy(env.get("NOTIFICATION_TELEGRAM_ENABLED", "")):
        for key in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
            if not env.get(key, "").strip():
                errors.append(f"{key} is required when NOTIFICATION_TELEGRAM_ENABLED=true")

    if env.get("OPENAI_API_KEY", "").strip() and not env.get("OPENAI_API_KEY", "").strip().startswith(("sk-", "sk-proj-")):
        warnings.append("OPENAI_API_KEY does not look like an OpenAI API key")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate StayPilot production env files.")
    parser.add_argument("--file", default=".env.production", help="Env file to validate")
    parser.add_argument(
        "--allow-placeholders",
        action="store_true",
        help="Allow placeholder values; use only for validating example files",
    )
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"ERROR: {path} does not exist", file=sys.stderr)
        return 1

    try:
        env = parse_env_file(path)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    errors, warnings = validate(env, allow_placeholders=args.allow_placeholders)
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if errors:
        print(f"Production env check failed: {len(errors)} error(s).", file=sys.stderr)
        return 1

    print(f"Production env check passed: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
