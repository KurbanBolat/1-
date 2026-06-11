from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utc_now
from app.models.reservation_payment_attempt import ReservationPaymentAttempt
from app.schemas.ops import AlertMetricOut, ChannelMetricOut, ObservabilityMetricsOut, OpsComponentOut, OpsStatusOut


def _parse_iso_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _collect_communication_metrics(window_start: datetime) -> list[ChannelMetricOut]:
    backend_root = Path(__file__).resolve().parents[2]
    log_file = backend_root / "runtime_logs" / "communication_events.log"
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "failed": 0})
    if not log_file.exists():
        return []
    try:
        lines = log_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in lines:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        created_at = payload.get("created_at")
        channel = str(payload.get("channel", "")).strip().lower()
        status = str(payload.get("status", "")).strip().lower()
        if channel not in {"webhook", "email", "telegram"}:
            continue
        if not isinstance(created_at, str):
            continue
        dt = _parse_iso_datetime(created_at)
        if dt is None or dt < window_start:
            continue
        counts[channel]["total"] += 1
        if status == "failed":
            counts[channel]["failed"] += 1

    metrics: list[ChannelMetricOut] = []
    for channel in sorted(counts.keys()):
        total = counts[channel]["total"]
        failed = counts[channel]["failed"]
        rate = round((failed / total), 4) if total > 0 else 0.0
        metrics.append(ChannelMetricOut(channel=channel, total=total, failed=failed, fail_rate=rate))
    return metrics


def _collect_payment_metrics(db: Session, window_start: datetime) -> tuple[int, int, float]:
    base_stmt = select(func.count()).select_from(ReservationPaymentAttempt).where(
        ReservationPaymentAttempt.created_at >= window_start
    )
    total = int(db.scalar(base_stmt) or 0)
    failed = int(
        db.scalar(
            base_stmt.where(
                ReservationPaymentAttempt.status == "failed",
            )
        )
        or 0
    )
    rate = round((failed / total), 4) if total > 0 else 0.0
    return total, failed, rate


def get_observability_metrics(db: Session) -> ObservabilityMetricsOut:
    window_minutes = max(5, int(settings.observability_metrics_window_minutes))
    window_start = utc_now() - timedelta(minutes=window_minutes)

    communication = _collect_communication_metrics(window_start)
    payment_total, payment_failed, payment_fail_rate = _collect_payment_metrics(db, window_start)

    communication_total = sum(item.total for item in communication)
    communication_failed = sum(item.failed for item in communication)
    communication_fail_rate = round((communication_failed / communication_total), 4) if communication_total else 0.0

    alerts = [
        AlertMetricOut(
            key="payment_fail_rate",
            triggered=payment_fail_rate >= float(settings.observability_alert_payment_fail_rate),
            threshold=float(settings.observability_alert_payment_fail_rate),
            actual=payment_fail_rate,
        ),
        AlertMetricOut(
            key="communication_fail_rate",
            triggered=communication_fail_rate >= float(settings.observability_alert_communication_fail_rate),
            threshold=float(settings.observability_alert_communication_fail_rate),
            actual=communication_fail_rate,
        ),
    ]

    return ObservabilityMetricsOut(
        window_minutes=window_minutes,
        communication=communication,
        payment_total=payment_total,
        payment_failed=payment_failed,
        payment_fail_rate=payment_fail_rate,
        alerts=alerts,
    )


def _component(key: str, status: str, detail: str, *, required: bool = False) -> OpsComponentOut:
    return OpsComponentOut(key=key, status=status, detail=detail, required=required)


def get_ops_status(db: Session) -> OpsStatusOut:
    environment = settings.sentry_environment.strip() or "local"
    production = environment.lower() == "production"
    components: list[OpsComponentOut] = []

    try:
        db.execute(text("SELECT 1"))
        components.append(_component("database", "ok", "database query succeeded", required=True))
    except Exception as exc:
        components.append(_component("database", "fail", f"database query failed: {type(exc).__name__}", required=True))

    cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    if not cors_origins:
        components.append(_component("cors", "fail", "CORS_ORIGINS is empty", required=True))
    elif any(origin == "*" for origin in cors_origins):
        components.append(_component("cors", "fail", "wildcard CORS is not allowed", required=True))
    else:
        components.append(_component("cors", "ok", f"{len(cors_origins)} origin(s) configured", required=True))

    if production and not settings.auth_cookie_secure:
        components.append(_component("auth_cookie_secure", "fail", "secure auth cookie is disabled", required=True))
    else:
        components.append(_component("auth_cookie_secure", "ok", f"secure={bool(settings.auth_cookie_secure)}", required=production))

    if production and not settings.csrf_enforce:
        components.append(_component("csrf", "fail", "CSRF enforcement is disabled", required=True))
    else:
        components.append(_component("csrf", "ok", f"enforced={bool(settings.csrf_enforce)}", required=production))

    if settings.payment_webhook_secret.strip():
        components.append(_component("payment_webhook", "ok", "HMAC secret configured", required=production))
    else:
        components.append(
            _component(
                "payment_webhook",
                "fail" if production else "warn",
                "PAYMENT_WEBHOOK_SECRET is not configured",
                required=production,
            )
        )

    if settings.openai_api_key.strip():
        components.append(_component("openai", "ok", f"model={settings.openai_chat_model}", required=False))
    else:
        components.append(_component("openai", "disabled", "GPT mode disabled; deterministic fallback active", required=False))

    if settings.sentry_dsn.strip():
        components.append(_component("sentry", "ok", "SENTRY_DSN configured", required=False))
    else:
        components.append(_component("sentry", "warn" if production else "disabled", "SENTRY_DSN is not configured", required=False))

    notification_channels: list[str] = []
    if settings.notification_webhook_url.strip():
        notification_channels.append("webhook")
    if settings.notification_email_enabled:
        notification_channels.append("email")
    if settings.notification_telegram_enabled:
        notification_channels.append("telegram")
    if notification_channels:
        components.append(_component("notifications", "ok", ",".join(notification_channels), required=False))
    else:
        components.append(_component("notifications", "disabled", "no outbound notification channel enabled", required=False))

    metrics = get_observability_metrics(db)
    triggered_alerts = [alert for alert in metrics.alerts if alert.triggered]
    if triggered_alerts:
        components.append(_component("alerts", "warn", f"{len(triggered_alerts)} alert(s) triggered", required=False))
    else:
        components.append(_component("alerts", "ok", "no alert thresholds triggered", required=False))

    has_fail = any(component.status == "fail" for component in components)
    has_warn = any(component.status == "warn" for component in components)
    overall = "failed" if has_fail else "degraded" if has_warn else "ready"

    return OpsStatusOut(
        status=overall,
        environment=environment,
        generated_at=utc_now(),
        components=components,
        alerts=metrics.alerts,
    )
