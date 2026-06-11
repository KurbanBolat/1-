from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

ReservationStatus = Literal["draft", "pending_payment", "confirmed", "checked_in", "checked_out", "cancelled", "expired"]
TariffPlan = Literal["basic", "smart", "flex"]
PaymentStatus = Literal["pending", "paid", "failed", "refunded"]
PaymentMethod = Literal["card", "kaspi", "apple_pay"]


class ReservationCreate(BaseModel):
    listing_id: int
    room_type_id: int | None = Field(default=None, ge=1)
    guest_name: str = Field(min_length=2, max_length=255)
    guest_email: EmailStr
    guest_phone: str = Field(min_length=7, max_length=20, pattern=r"^[+0-9()\-\s]{7,20}$")
    check_in: date
    check_out: date
    guests: int = Field(ge=1, le=12)
    tariff_plan: TariffPlan = "smart"
    quote_token: str | None = Field(default=None, min_length=8, max_length=64)


class ReservationCancel(BaseModel):
    guest_email: EmailStr
    access_token: str | None = Field(default=None, min_length=16, max_length=512)


class ReservationOut(BaseModel):
    id: int
    listing_id: int
    room_type_id: int | None = None
    room_type_name: str | None = None
    guest_name: str
    guest_email: EmailStr
    guest_phone: str
    check_in: date
    check_out: date
    guests: int
    tariff_plan: TariffPlan
    total_price: float
    status: ReservationStatus
    access_token: str | None = None

    model_config = {"from_attributes": True}


class CancellationTermsOut(BaseModel):
    days_before_check_in: int
    penalty_percent: int
    penalty_amount: float
    refund_amount: float
    refundable: bool
    reason: str


class ReservationCancelOut(ReservationOut):
    cancellation_terms: CancellationTermsOut


class PartnerReservationOut(ReservationOut):
    listing_title: str
    city: str
    district: str
    payment_status: PaymentStatus = "pending"
    payment_method: PaymentMethod | None = None


class ReservationPaymentAttempt(BaseModel):
    method: PaymentMethod
    idempotency_key: str = Field(min_length=8, max_length=120)
    force_fail: bool = False
    access_token: str | None = Field(default=None, min_length=16, max_length=512)


class ReservationPaymentOut(BaseModel):
    reservation_id: int
    payment_status: PaymentStatus
    payment_method: PaymentMethod | None = None
    amount: float
    currency: str
    attempted_at: datetime | None = None
    updated_at: datetime
    attempt_status: PaymentStatus | None = None
    reservation_status: ReservationStatus
    idempotency_reused: bool = False


class ListingPerformanceOut(BaseModel):
    listing_id: int
    listing_title: str
    city: str
    district: str
    reservations_period: int
    revenue_period: float
    adr_period: float
    occupancy_period: float


class DailyOpsOut(BaseModel):
    date: date
    reservations: int
    cancellations: int
    revenue: float


class PartnerOpsSummaryOut(BaseModel):
    period_days: int
    arrivals_today: int
    departures_today: int
    active_stays_today: int
    cancellations_period: int
    reservations_period: int
    revenue_period: float
    adr_period: float
    occupancy_period: float
    daily_stats: list[DailyOpsOut]
    listing_performance: list[ListingPerformanceOut]


class PartnerNotificationOut(BaseModel):
    event_id: str
    event: str
    created_at: datetime
    partner_email: EmailStr
    partner_id: int
    listing_id: int
    listing_title: str
    reservation_id: int
    check_in: date
    check_out: date
    guests: int
    total_price: float
    currency: str
    status: ReservationStatus
    read: bool = False


class PartnerNotificationReadIn(BaseModel):
    event_ids: list[str] = Field(min_length=1, max_length=200)


class PartnerNotificationReadOut(BaseModel):
    marked: int
    event_ids: list[str]


class PartnerCommunicationEventOut(BaseModel):
    event_id: str
    created_at: datetime
    channel: Literal["webhook", "email", "telegram"]
    event: str
    reservation_id: int | None = None
    listing_id: int | None = None
    listing_title: str | None = None
    status: Literal["sent", "failed", "skipped"]
    reason: str
    attempts: int = 1
    retry_applied: bool = False


class PartnerCommunicationRetryOut(BaseModel):
    previous_event: PartnerCommunicationEventOut
    retried_event: PartnerCommunicationEventOut


class PartnerCommunicationBatchRetryIn(BaseModel):
    event_ids: list[str] = Field(min_length=1, max_length=120)


class PartnerCommunicationBatchRetryItemOut(BaseModel):
    event_id: str
    success: bool
    error: str | None = None
    previous_event: PartnerCommunicationEventOut | None = None
    retried_event: PartnerCommunicationEventOut | None = None


class PartnerCommunicationBatchRetryOut(BaseModel):
    requested: int
    retried: int
    failed: int
    items: list[PartnerCommunicationBatchRetryItemOut]
