from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

SupportTicketStatus = Literal["open", "in_progress", "resolved"]
SupportTicketPriority = Literal["low", "medium", "high"]
SupportTicketTopic = Literal["payment", "refund", "complaint", "other"]


class SupportTicketOut(BaseModel):
    id: int
    source: str
    status: SupportTicketStatus
    priority: SupportTicketPriority
    topic: SupportTicketTopic
    lang: str
    message: str
    reservation_id: int | None
    listing_id: int | None
    city: str | None
    check_in: date | None
    check_out: date | None
    guests: int | None
    contact_phone: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SupportTicketStatusUpdate(BaseModel):
    status: SupportTicketStatus = Field(...)
