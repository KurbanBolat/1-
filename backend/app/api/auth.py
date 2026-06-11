import hashlib
import logging
import secrets
import time
from collections import deque
from datetime import timedelta
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.time import utc_now
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.session import get_db
from app.models.auth_token import AuthToken
from app.models.user import User
from app.schemas.user import EmailActionIn, MessageOut, TokenActionIn, TokenOut, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
LOGIN_ATTEMPT_LIMIT = 6
LOGIN_ATTEMPT_WINDOW_SECONDS = 10 * 60
LOGIN_LOCK_SECONDS = 15 * 60
_login_attempts: dict[str, deque[float]] = {}
_login_lockouts: dict[str, float] = {}
_login_guard = Lock()


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _issue_user_token(db: Session, user_id: int, purpose: str) -> str:
    raw = secrets.token_urlsafe(32)
    token = AuthToken(
        user_id=user_id,
        purpose=purpose,
        token_hash=_token_hash(raw),
        expires_at=utc_now() + timedelta(hours=settings.auth_token_ttl_hours),
        used=False,
    )
    db.add(token)
    db.commit()
    return raw


def _consume_user_token(db: Session, raw_token: str, purpose: str) -> User:
    token_hash = _token_hash(raw_token)
    token = db.scalar(select(AuthToken).where(AuthToken.token_hash == token_hash, AuthToken.purpose == purpose))
    if not token:
        raise HTTPException(status_code=400, detail="Invalid token")
    if token.used:
        raise HTTPException(status_code=400, detail="Token already used")
    if token.expires_at < utc_now():
        raise HTTPException(status_code=400, detail="Token expired")
    user = db.get(User, token.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token.used = True
    db.commit()
    return user


def _set_auth_cookie(response: Response, token: str) -> None:
    csrf_token = secrets.token_urlsafe(24)
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_token,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


def _prune_login_limits(now_ts: float) -> None:
    stale_before = now_ts - LOGIN_ATTEMPT_WINDOW_SECONDS
    drop_attempt_keys: list[str] = []
    for key, history in _login_attempts.items():
        while history and history[0] < stale_before:
            history.popleft()
        if not history:
            drop_attempt_keys.append(key)
    for key in drop_attempt_keys:
        _login_attempts.pop(key, None)

    drop_lock_keys = [key for key, until in _login_lockouts.items() if until <= now_ts]
    for key in drop_lock_keys:
        _login_lockouts.pop(key, None)


def _rate_limit_keys(email: str, client_ip: str) -> tuple[str, str]:
    normalized_email = email.strip().lower()
    return (f"ip:{client_ip}", f"email_ip:{normalized_email}:{client_ip}")


def _assert_login_allowed(email: str, client_ip: str) -> None:
    now_ts = time.time()
    with _login_guard:
        _prune_login_limits(now_ts)
        for key in _rate_limit_keys(email, client_ip):
            lock_until = _login_lockouts.get(key, 0.0)
            if lock_until > now_ts:
                retry_after = max(1, int(lock_until - now_ts))
                raise HTTPException(
                    status_code=429,
                    detail={
                        "code": "LOGIN_RATE_LIMITED",
                        "message": "Too many login attempts. Please try again later.",
                        "details": [{"field": "login", "retry_after_seconds": retry_after}],
                    },
                )


def _mark_login_failure(email: str, client_ip: str) -> None:
    now_ts = time.time()
    with _login_guard:
        _prune_login_limits(now_ts)
        for key in _rate_limit_keys(email, client_ip):
            history = _login_attempts.get(key)
            if history is None:
                history = deque()
                _login_attempts[key] = history
            history.append(now_ts)
            if len(history) >= LOGIN_ATTEMPT_LIMIT:
                _login_lockouts[key] = now_ts + LOGIN_LOCK_SECONDS
                history.clear()


def _mark_login_success(email: str, client_ip: str) -> None:
    with _login_guard:
        for key in _rate_limit_keys(email, client_ip):
            _login_attempts.pop(key, None)
            _login_lockouts.pop(key, None)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email.lower(),
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        role="client",
        email_verified=False,
        token_version=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    _assert_login_allowed(form_data.username, client_ip)
    user = db.scalar(select(User).where(User.email == form_data.username.lower()))
    if not user or not verify_password(form_data.password, user.hashed_password):
        _mark_login_failure(form_data.username, client_ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.email_verified:
        if user.role in {"admin", "partner"}:
            user.email_verified = True
            db.commit()
        else:
            raise HTTPException(status_code=403, detail="Email is not verified")

    _mark_login_success(form_data.username, client_ip)
    token = create_access_token(subject=str(user.id), role=user.role, token_version=user.token_version)
    _set_auth_cookie(response, token)
    return TokenOut(access_token=token)


@router.get("/session", response_model=UserOut)
def get_session(user: User = Depends(get_current_user)):
    return user


@router.post("/logout", response_model=MessageOut)
def logout(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.token_version = int(getattr(user, "token_version", 0)) + 1
    db.commit()
    response.delete_cookie(settings.auth_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")
    return MessageOut(message="Logged out")


@router.post("/verify-email/request", response_model=MessageOut)
def request_verify_email(payload: EmailActionIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        return MessageOut(message="If account exists, verification instructions were generated")
    if user.email_verified:
        return MessageOut(message="Email already verified")
    _issue_user_token(db, user.id, "verify_email")
    logger.info("Issued verify-email token for user_id=%s", user.id)
    return MessageOut(message="Verification token generated. Check backend logs")


@router.post("/verify-email/confirm", response_model=MessageOut)
def confirm_verify_email(payload: TokenActionIn, db: Session = Depends(get_db)):
    user = _consume_user_token(db, payload.token, "verify_email")
    user.email_verified = True
    db.commit()
    return MessageOut(message="Email verified")


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=24, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/password-reset/request", response_model=MessageOut)
def request_password_reset(payload: EmailActionIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        return MessageOut(message="If account exists, reset instructions were generated")
    _issue_user_token(db, user.id, "reset_password")
    logger.info("Issued password-reset token for user_id=%s", user.id)
    return MessageOut(message="Reset token generated. Check backend logs")


@router.post("/password-reset/confirm", response_model=MessageOut)
def confirm_password_reset(payload: ResetPasswordIn, db: Session = Depends(get_db)):
    user = _consume_user_token(db, payload.token, "reset_password")
    user.hashed_password = get_password_hash(payload.new_password)
    user.token_version = int(getattr(user, "token_version", 0)) + 1
    db.commit()
    return MessageOut(message="Password updated")
