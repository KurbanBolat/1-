from pydantic import BaseModel, Field


class AnalyticsEventIn(BaseModel):
    event_name: str = Field(min_length=3, max_length=40, pattern="^[a-z0-9_]+$")
    session_id: str | None = Field(default=None, min_length=8, max_length=64)
    listing_id: int | None = None
    reservation_id: int | None = None
    lang: str | None = Field(default=None, min_length=2, max_length=8)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    metadata: dict = Field(default_factory=dict)


class AnalyticsEventOut(BaseModel):
    id: int
    event_name: str
    status: str = "ok"


class AnalyticsFunnelStepOut(BaseModel):
    event_name: str
    label: str
    count: int
    conversion_from_open: float


class AnalyticsFunnelOut(BaseModel):
    period_days: int
    total_events: int
    steps: list[AnalyticsFunnelStepOut]


class AnalyticsAbVariantOut(BaseModel):
    variant: str
    exposed: int
    listing_open_clicked: int
    checkout_clicked: int
    payment_started: int
    paid: int
    ctr_from_exposed: float
    checkout_from_exposed: float
    paid_from_exposed: float
    paid_from_checkout: float


class AnalyticsAbSummaryOut(BaseModel):
    period_days: int
    variants: list[AnalyticsAbVariantOut]
