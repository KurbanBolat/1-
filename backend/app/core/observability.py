from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone

from app.core.config import settings

_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None) or _request_id_ctx.get()
        if request_id:
            payload["request_id"] = request_id
        for key in ("path", "method", "status_code", "latency_ms", "error_code"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def get_request_id() -> str | None:
    return _request_id_ctx.get()


def set_request_id(request_id: str | None) -> None:
    _request_id_ctx.set(request_id)


def set_sentry_request_context(*, request_id: str, method: str, path: str) -> None:
    try:
        import sentry_sdk
    except Exception:
        return

    sentry_sdk.set_tag("request_id", request_id)
    sentry_sdk.set_context(
        "http_request",
        {
            "request_id": request_id,
            "method": method,
            "path": path,
        },
    )


def set_sentry_user_context(*, user_id: int, role: str) -> None:
    try:
        import sentry_sdk
    except Exception:
        return

    sentry_sdk.set_user({"id": str(user_id), "role": role})


def clear_sentry_user_context() -> None:
    try:
        import sentry_sdk
    except Exception:
        return

    sentry_sdk.set_user(None)


def configure_logging() -> None:
    level_name = (settings.observability_log_level or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    has_json_handler = False
    for handler in root_logger.handlers:
        if isinstance(handler.formatter, JsonLogFormatter):
            has_json_handler = True
            handler.setLevel(level)
    if not has_json_handler:
        stream_handler = logging.StreamHandler()
        stream_handler.setLevel(level)
        stream_handler.setFormatter(JsonLogFormatter())
        root_logger.handlers = [stream_handler]


def configure_sentry() -> None:
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
    except Exception:
        logging.getLogger("observability").warning("sentry_sdk_not_available")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=max(0.0, min(1.0, float(settings.sentry_traces_sample_rate))),
        integrations=[FastApiIntegration()],
    )
