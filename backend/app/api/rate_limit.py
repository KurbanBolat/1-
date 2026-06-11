from collections import deque
from time import time
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class SimpleRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limit: int = 60, window_seconds: int = 60):
        super().__init__(app)
        self.limit = limit
        self.window_seconds = window_seconds
        self.clients: dict[str, deque[float]] = {}
        self._request_counter = 0
        self._cleanup_every = 200

    async def dispatch(self, request: Request, call_next: Callable):
        ip = request.client.host if request.client else "unknown"
        now = time()
        self._request_counter += 1
        if self._request_counter % self._cleanup_every == 0:
            self._cleanup(now)

        history = self.clients.get(ip)
        if history is None:
            history = deque()
            self.clients[ip] = history

        while history and now - history[0] >= self.window_seconds:
            history.popleft()

        if len(history) >= self.limit:
            retry_after = max(1, int(self.window_seconds - (now - history[0]))) if history else self.window_seconds
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many requests",
                    }
                },
            )

        history.append(now)
        return await call_next(request)

    def _cleanup(self, now: float) -> None:
        to_delete: list[str] = []
        for ip, history in self.clients.items():
            while history and now - history[0] >= self.window_seconds:
                history.popleft()
            if not history:
                to_delete.append(ip)
        for ip in to_delete:
            self.clients.pop(ip, None)
