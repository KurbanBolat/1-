from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.observability import set_sentry_user_context
from app.db.session import get_db
from app.models.user import User


def _extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header:
        return None
    prefix = "bearer "
    if not header.lower().startswith(prefix):
        return None
    token = header[len(prefix):].strip()
    return token or None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    bearer_token = _extract_bearer_token(request)
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    candidates = [token for token in [bearer_token, cookie_token] if token]
    if not candidates:
        raise credentials_exception

    for token in candidates:
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
            user_id = int(payload.get("sub", "0"))
            token_version = int(payload.get("tv", 0))
        except (JWTError, ValueError):
            continue

        user = db.get(User, user_id)
        if not user:
            continue
        if int(getattr(user, "token_version", 0)) != token_version:
            continue
        set_sentry_user_context(user_id=int(user.id), role=str(user.role))
        return user

    raise credentials_exception


def get_optional_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    bearer_token = _extract_bearer_token(request)
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    candidates = [token for token in [bearer_token, cookie_token] if token]

    for token in candidates:
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
            user_id = int(payload.get("sub", "0"))
            token_version = int(payload.get("tv", 0))
        except (JWTError, ValueError):
            continue

        user = db.get(User, user_id)
        if not user:
            continue
        if int(getattr(user, "token_version", 0)) != token_version:
            continue
        return user
    return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def require_partner(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"admin", "partner"}:
        raise HTTPException(status_code=403, detail="Partner role required")
    return user
