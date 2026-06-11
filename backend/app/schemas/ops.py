from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ChannelMetricOut(BaseModel):
    channel: str
    total: int
    failed: int
    fail_rate: float


class AlertMetricOut(BaseModel):
    key: str
    triggered: bool
    threshold: float
    actual: float


class ObservabilityMetricsOut(BaseModel):
    window_minutes: int
    communication: list[ChannelMetricOut]
    payment_total: int
    payment_failed: int
    payment_fail_rate: float
    alerts: list[AlertMetricOut]


class OpsComponentOut(BaseModel):
    key: str
    status: Literal["ok", "warn", "fail", "disabled"]
    detail: str
    required: bool = False


class OpsStatusOut(BaseModel):
    status: Literal["ready", "degraded", "failed"]
    environment: str
    generated_at: datetime
    components: list[OpsComponentOut]
    alerts: list[AlertMetricOut]
