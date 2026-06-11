from __future__ import annotations

import secrets
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.config import settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _normalize_origin(raw: str) -> str:
    parsed = urlparse(raw.strip())
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".lower()


class CsrfOriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        trusted = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
        extra = [origin.strip() for origin in settings.csrf_trusted_origins.split(",") if origin.strip()]
        self.allowed_origins = {_normalize_origin(origin) for origin in (trusted + extra)}
        self.allowed_origins.discard("")

    async def dispatch(self, request: Request, call_next):
        if not settings.csrf_enforce:
            return await call_next(request)
        if request.method.upper() not in UNSAFE_METHODS:
            return await call_next(request)
        path = request.url.path
        if path.startswith("/health") or path.startswith("/media/"):
            return await call_next(request)

        origin = request.headers.get("origin", "").strip()
        referer = request.headers.get("referer", "").strip()
        if not origin and not referer:
            # Non-browser/internal clients often do not send these headers.
            return await call_next(request)
        candidate = _normalize_origin(origin) or _normalize_origin(referer)
        if not candidate or candidate not in self.allowed_origins:
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "CSRF_ORIGIN_DENIED",
                        "message": "Origin/Referer is not allowed",
                    }
                },
            )

        # Enforce double-submit token for cookie-authenticated browser requests.
        csrf_cookie = request.cookies.get(settings.csrf_cookie_name, "").strip()
        if csrf_cookie:
            csrf_header = request.headers.get(settings.csrf_header_name, "").strip()
            if not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "CSRF_TOKEN_INVALID",
                            "message": "CSRF token is missing or invalid",
                        }
                    },
                )
        return await call_next(request)
