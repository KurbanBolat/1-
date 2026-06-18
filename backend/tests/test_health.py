import json
import hashlib
import hmac
import os
import sys

import anyio
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app, http_exception_handler, _run_startup_migrations
from app.api.payments import _verify_payment_webhook_signature
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.db.session import SessionLocal
from app.models.user import User


client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_liveness_and_readiness():
    live_response = client.get("/health/live")
    ready_response = client.get("/health/ready")

    assert live_response.status_code == 200
    assert live_response.json()["status"] == "ok"
    assert ready_response.status_code == 200
    assert ready_response.json()["status"] == "ready"
    assert ready_response.json()["checks"] == {"database": "ok"}
    assert ready_response.json()["modes"]["ai_concierge"] in {"stub", "live"}
    assert ready_response.json()["modes"]["payment_provider"] in {"mock", "manual", "stripe", "kaspi"}


def test_session_status_without_auth_is_quiet():
    response = client.get("/auth/session/status")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "user": None}


def test_session_status_with_auth_returns_user():
    _run_startup_migrations()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "session-admin@staypilot.dev").first()
        if not admin:
            admin = User(
                email="session-admin@staypilot.dev",
                full_name="Session Admin",
                hashed_password=get_password_hash("Admin12345!"),
                role="admin",
                email_verified=True,
                token_version=0,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
        else:
            admin.role = "admin"
            admin.email_verified = True
            db.commit()
            db.refresh(admin)
        token = create_access_token(str(admin.id), admin.role, token_version=admin.token_version)
    finally:
        db.close()

    response = client.get("/auth/session/status", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["user"]["email"] == "session-admin@staypilot.dev"
    assert payload["user"]["role"] == "admin"


def test_request_id_header_is_echoed():
    response = client.get("/health/live", headers={"x-request-id": "test-request-id"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "test-request-id"


def test_ops_status_for_admin():
    _run_startup_migrations()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "ops-admin@example.test").first()
        if not admin:
            admin = User(
                email="ops-admin@example.test",
                full_name="Ops Admin",
                hashed_password=get_password_hash("Admin12345!"),
                role="admin",
                email_verified=True,
                token_version=0,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
        else:
            admin.role = "admin"
            admin.email_verified = True
            db.commit()
            db.refresh(admin)
        token = create_access_token(str(admin.id), admin.role, token_version=admin.token_version)
    finally:
        db.close()

    response = client.get("/ops/status", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"ready", "degraded"}
    assert payload["environment"]
    components = {item["key"]: item for item in payload["components"]}
    assert components["database"]["status"] == "ok"
    assert components["payment_provider"]["detail"].startswith("provider=")
    assert components["openai"]["status"] in {"ok", "warn", "disabled"}
    assert "alerts" in payload


def test_error_shape_for_http_exception():
    request = Request({"type": "http", "method": "GET", "path": "/test", "headers": []})
    response = anyio.run(http_exception_handler, request, HTTPException(status_code=404, detail="Listing not found"))
    assert response.status_code == 404
    payload = json.loads(response.body.decode("utf-8"))
    assert "error" in payload
    assert payload["error"]["code"] == "HTTP_404"
    assert isinstance(payload["error"]["message"], str)


def test_error_shape_for_validation_exception():
    response = client.get("/listings?guests=0")
    assert response.status_code == 422
    payload = response.json()
    assert "error" in payload
    assert payload["error"]["code"] == "VALIDATION_ERROR"
    assert payload["error"]["message"] == "Validation failed"
    assert isinstance(payload["error"]["details"], list)


def test_analytics_event_endpoint_accepts_event():
    response = client.post(
        "/analytics/events",
        json={
            "event_name": "chat_open",
            "session_id": "analytics_sess_123",
            "lang": "ru",
            "currency": "USD",
            "metadata": {"source": "ai_concierge"},
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["event_name"] == "chat_open"


def test_payment_webhook_signature_validation(monkeypatch):
    body = b'{"event_id":"evt_12345678"}'
    secret = "test_webhook_secret"
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    monkeypatch.setattr(settings, "payment_webhook_secret", secret)

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/payments/webhook",
            "headers": [(b"x-staypilot-signature", f"sha256={signature}".encode("ascii"))],
        }
    )
    _verify_payment_webhook_signature(request, body)

    bad_request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/payments/webhook",
            "headers": [(b"x-staypilot-signature", b"sha256=bad")],
        }
    )
    try:
        _verify_payment_webhook_signature(bad_request, body)
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("Expected invalid webhook signature to fail")
