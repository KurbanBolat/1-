import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas.payment import PaymentWebhookIn, PaymentWebhookOut
from app.services.payment_service import process_payment_webhook


router = APIRouter(prefix="/payments", tags=["payments"])


def _verify_payment_webhook_signature(request: Request, raw_body: bytes) -> None:
    secret = settings.payment_webhook_secret.strip()
    if not secret:
        return

    signature = request.headers.get("x-staypilot-signature", "").strip()
    if not signature:
        raise HTTPException(status_code=401, detail={"code": "WEBHOOK_SIGNATURE_MISSING", "message": "Webhook signature is missing"})

    if signature.startswith("sha256="):
        signature = signature.split("=", 1)[1].strip()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail={"code": "WEBHOOK_SIGNATURE_INVALID", "message": "Webhook signature is invalid"})


@router.post("/webhook", response_model=PaymentWebhookOut)
async def payment_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    _verify_payment_webhook_signature(request, raw_body)
    try:
        raw_payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"code": "WEBHOOK_JSON_INVALID", "message": "Webhook payload must be JSON"}) from None
    try:
        payload = PaymentWebhookIn.model_validate(raw_payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from None
    return process_payment_webhook(db, payload)
