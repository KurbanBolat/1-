from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.reservation import PaymentMethod, PaymentStatus, ReservationStatus


PaymentProvider = Literal["mock", "stripe", "kaspi", "manual"]
PaymentWebhookStatus = Literal["pending", "paid", "failed"]
WebhookProcessStatus = Literal["processed", "rejected"]


class PaymentWebhookIn(BaseModel):
    provider: PaymentProvider = "mock"
    event_id: str = Field(min_length=8, max_length=160)
    reservation_id: int = Field(ge=1)
    status: PaymentWebhookStatus
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default="KZT", min_length=3, max_length=10)
    method: PaymentMethod | None = None
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)


class PaymentWebhookOut(BaseModel):
    provider: str
    event_id: str
    duplicate: bool = False
    process_status: WebhookProcessStatus
    reservation_id: int | None = None
    reservation_status: ReservationStatus | None = None
    payment_status: PaymentStatus | None = None
    attempt_status: PaymentStatus | None = None
    reason: str | None = None
