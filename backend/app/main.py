import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.observability_middleware import RequestObservabilityMiddleware
from app.api.csrf_middleware import CsrfOriginMiddleware
from app.api.rate_limit import SimpleRateLimitMiddleware
from app.api.router import api_router
from app.core.config import settings
from app.core.observability import configure_logging, configure_sentry
from app.core.security import get_password_hash
from app.db.session import Base, SessionLocal
from app.models.analytics_event import AnalyticsEvent
from app.models.auth_token import AuthToken
from app.models.chat_session_state import ChatSessionState
from app.models.lead import Lead
from app.models.listing import Listing
from app.models.listing_block import ListingBlock
from app.models.listing_photo import ListingPhoto
from app.models.menu_item import MenuItem
from app.models.partner_notification_read import PartnerNotificationRead
from app.models.payment_webhook_event import PaymentWebhookEvent
from app.models.property import Property
from app.models.quote_lock import QuoteLock
from app.models.restaurant import Restaurant, RestaurantBookingEvent, RestaurantTableBooking
from app.models.reservation import Reservation
from app.models.reservation_payment import ReservationPayment
from app.models.reservation_payment_attempt import ReservationPaymentAttempt
from app.models.room_type import RoomType
from app.models.room_service_order import RoomServiceOrder, RoomServiceOrderItem
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.services.room_inventory_service import backfill_room_types
from app.services.reservation_lifecycle import expire_stale_pending_reservations


configure_logging()
configure_sentry()

logger = logging.getLogger("app.lifecycle")
media_dir = Path(__file__).resolve().parents[0] / "media"
media_dir.mkdir(parents=True, exist_ok=True)


def _run_startup_migrations() -> None:
    _validate_security_settings()
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=db.get_bind())
        AuthToken.__table__.create(bind=db.get_bind(), checkfirst=True)
        ReservationPayment.__table__.create(bind=db.get_bind(), checkfirst=True)
        ReservationPaymentAttempt.__table__.create(bind=db.get_bind(), checkfirst=True)
        PaymentWebhookEvent.__table__.create(bind=db.get_bind(), checkfirst=True)
        QuoteLock.__table__.create(bind=db.get_bind(), checkfirst=True)
        RoomType.__table__.create(bind=db.get_bind(), checkfirst=True)
        SupportTicket.__table__.create(bind=db.get_bind(), checkfirst=True)
        MenuItem.__table__.create(bind=db.get_bind(), checkfirst=True)
        RoomServiceOrder.__table__.create(bind=db.get_bind(), checkfirst=True)
        RoomServiceOrderItem.__table__.create(bind=db.get_bind(), checkfirst=True)
        Restaurant.__table__.create(bind=db.get_bind(), checkfirst=True)
        RestaurantTableBooking.__table__.create(bind=db.get_bind(), checkfirst=True)
        RestaurantBookingEvent.__table__.create(bind=db.get_bind(), checkfirst=True)
        PartnerNotificationRead.__table__.create(bind=db.get_bind(), checkfirst=True)
        ChatSessionState.__table__.create(bind=db.get_bind(), checkfirst=True)
        AnalyticsEvent.__table__.create(bind=db.get_bind(), checkfirst=True)
        _ensure_support_ticket_columns(db)
        _ensure_chat_session_columns(db)
        _ensure_user_columns(db)
        _ensure_inventory_columns(db)
        backfill_room_types(db)

        if settings.seed_admin_enabled:
            if not settings.seed_admin_email or not settings.seed_admin_password:
                raise RuntimeError("seed_admin_enabled=true requires seed_admin_email and seed_admin_password")
            admin = db.query(User).filter(User.email == settings.seed_admin_email.lower()).first()
            if not admin:
                db.add(
                    User(
                        email=settings.seed_admin_email.lower(),
                        full_name=settings.seed_admin_full_name,
                        hashed_password=get_password_hash(settings.seed_admin_password),
                        role="admin",
                        email_verified=True,
                    )
                )
                db.commit()
            else:
                # Deterministic bootstrap for local/dev/e2e runs.
                admin.hashed_password = get_password_hash(settings.seed_admin_password)
                admin.full_name = settings.seed_admin_full_name
                admin.role = "admin"
                admin.email_verified = True
                db.commit()

        # backfill existing rows if they were created before fee/policy support
        db.query(Listing).filter(Listing.cleaning_fee <= 0).update({Listing.cleaning_fee: 7000}, synchronize_session=False)
        db.query(Listing).filter(Listing.service_fee_percent <= 0).update({Listing.service_fee_percent: 10}, synchronize_session=False)
        db.query(Listing).filter(Listing.cancellation_policy == "").update({Listing.cancellation_policy: "flexible"}, synchronize_session=False)
        db.commit()
    finally:
        db.close()


async def _reservation_expire_worker(stop_event: asyncio.Event) -> None:
    interval = max(15, int(settings.reservation_expire_scan_interval_seconds))
    while not stop_event.is_set():
        await asyncio.sleep(interval)
        db = SessionLocal()
        try:
            expired = expire_stale_pending_reservations(db)
            if expired > 0:
                logger.info("expired_stale_pending_reservations=%s", expired)
        except Exception:
            logger.exception("reservation_expire_worker_failed")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    _run_startup_migrations()
    stop_event = asyncio.Event()
    worker = asyncio.create_task(_reservation_expire_worker(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title=settings.app_name, lifespan=lifespan)

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if settings.api_rate_limit_per_minute > 0 and settings.api_rate_limit_window_seconds > 0:
    app.add_middleware(
        SimpleRateLimitMiddleware,
        limit=settings.api_rate_limit_per_minute,
        window_seconds=settings.api_rate_limit_window_seconds,
    )
app.add_middleware(CsrfOriginMiddleware)
app.add_middleware(RequestObservabilityMiddleware)
app.mount("/media", StaticFiles(directory=media_dir), name="media")


def _ensure_support_ticket_columns(db) -> None:
    try:
        rows = db.execute(text("PRAGMA table_info(support_tickets)")).fetchall()
        existing = {str(row[1]) for row in rows}
    except Exception:
        return

    if "priority" not in existing:
        db.execute(text("ALTER TABLE support_tickets ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'medium'"))
    if "topic" not in existing:
        db.execute(text("ALTER TABLE support_tickets ADD COLUMN topic VARCHAR(20) NOT NULL DEFAULT 'other'"))
    db.commit()


def _ensure_chat_session_columns(db) -> None:
    try:
        rows = db.execute(text("PRAGMA table_info(chat_session_states)")).fetchall()
        existing = {str(row[1]) for row in rows}
    except Exception:
        return

    if "booking_state_json" not in existing:
        db.execute(text("ALTER TABLE chat_session_states ADD COLUMN booking_state_json TEXT NOT NULL DEFAULT '{}'"))
    db.commit()


def _ensure_user_columns(db) -> None:
    try:
        rows = db.execute(text("PRAGMA table_info(users)")).fetchall()
        existing = {str(row[1]) for row in rows}
    except Exception:
        return
    if "email_verified" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"))
        db.execute(text("UPDATE users SET email_verified = 1 WHERE role IN ('admin','partner')"))
    else:
        # Keep legacy/system accounts operable after security migration.
        # Partner/admin users are managed through trusted flows and must remain loggable.
        db.execute(text("UPDATE users SET email_verified = 1 WHERE role IN ('admin','partner') AND email_verified = 0"))
    if "token_version" not in existing:
        db.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"))
    db.commit()


def _ensure_inventory_columns(db) -> None:
    try:
        reservation_rows = db.execute(text("PRAGMA table_info(reservations)")).fetchall()
        reservation_columns = {str(row[1]) for row in reservation_rows}
        quote_rows = db.execute(text("PRAGMA table_info(quote_locks)")).fetchall()
        quote_columns = {str(row[1]) for row in quote_rows}
        block_rows = db.execute(text("PRAGMA table_info(listing_blocks)")).fetchall()
        block_columns = {str(row[1]) for row in block_rows}
    except Exception:
        return

    if "room_type_id" not in reservation_columns:
        db.execute(text("ALTER TABLE reservations ADD COLUMN room_type_id INTEGER"))
    if "room_type_id" not in quote_columns:
        db.execute(text("ALTER TABLE quote_locks ADD COLUMN room_type_id INTEGER"))
    if "room_type_id" not in block_columns:
        db.execute(text("ALTER TABLE listing_blocks ADD COLUMN room_type_id INTEGER"))
    if "blocked_inventory" not in block_columns:
        db.execute(text("ALTER TABLE listing_blocks ADD COLUMN blocked_inventory INTEGER"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_reservations_room_type_id ON reservations(room_type_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_quote_locks_room_type_id ON quote_locks(room_type_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_listing_blocks_room_type_id ON listing_blocks(room_type_id)"))
    db.commit()


def _validate_security_settings() -> None:
    weak_values = {"change_me", "changeme", "secret", "default", "dev-secret", "test-secret"}
    normalized = settings.secret_key.strip().lower()
    weak_or_short = normalized in weak_values or len(settings.secret_key.strip()) < 32
    if weak_or_short:
        if settings.allow_insecure_secret_for_dev:
            logger.warning("insecure_secret_key_is_enabled_for_dev")
            return
        raise RuntimeError("SECRET_KEY is too weak. Configure a strong value via environment.")
    if settings.sentry_environment.strip().lower() == "production":
        if not settings.auth_cookie_secure:
            raise RuntimeError("AUTH_COOKIE_SECURE must be true in production.")
        if not settings.csrf_enforce:
            raise RuntimeError("CSRF_ENFORCE must be true in production.")
        if any(origin.strip() == "*" for origin in settings.cors_origins.split(",")):
            raise RuntimeError("CORS_ORIGINS must not contain '*' in production.")
        if not settings.payment_webhook_secret.strip():
            raise RuntimeError("PAYMENT_WEBHOOK_SECRET must be configured in production.")


def _error_payload(
    *,
    code: str,
    message: str,
    details: list[dict] | list | dict | None = None,
) -> dict:
    payload: dict = {"error": {"code": code, "message": message}}
    if details:
        payload["error"]["details"] = details
    return payload


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        code = str(detail.get("code") or f"HTTP_{exc.status_code}")
        message = str(detail.get("message") or detail.get("detail") or "Request failed")
        details = detail.get("details")
    elif isinstance(detail, list):
        code = f"HTTP_{exc.status_code}"
        message = "Request failed"
        details = detail
    else:
        code = f"HTTP_{exc.status_code}"
        message = str(detail or "Request failed")
        details = None
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(code=code, message=message, details=details),
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    normalized_details: list[dict] = []
    for err in exc.errors():
        loc = err.get("loc", ())
        field = ""
        if isinstance(loc, (list, tuple)) and len(loc) > 0:
            field = str(loc[-1])

        msg = str(err.get("msg") or "Invalid value")
        err_type = str(err.get("type") or "validation_error")
        if err_type.endswith("missing"):
            msg = "This field is required"

        normalized_details.append(
            {
                "loc": list(loc) if isinstance(loc, (list, tuple)) else [],
                "field": field,
                "msg": msg,
                "type": err_type,
            }
        )

    return JSONResponse(
        status_code=422,
        content=_error_payload(
            code="VALIDATION_ERROR",
            message="Validation failed",
            details=normalized_details,
        ),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/live")
def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready() -> dict[str, object]:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "READINESS_FAILED", "message": "Database is not ready"},
        ) from exc
    finally:
        db.close()
    return {"status": "ready", "checks": {"database": "ok"}}


app.include_router(api_router)
