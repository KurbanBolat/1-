from datetime import date, datetime

from pydantic import BaseModel, Field


class ListingBlockCreate(BaseModel):
    check_in: date
    check_out: date
    room_type_id: int | None = Field(default=None, ge=1)
    blocked_inventory: int | None = Field(default=None, ge=1, le=500)
    reason: str = Field(default="", max_length=255)


class ListingBlockOut(BaseModel):
    id: int
    listing_id: int
    room_type_id: int | None
    check_in: date
    check_out: date
    blocked_inventory: int | None
    reason: str
    created_by: int | None
    created_at: datetime

    model_config = {"from_attributes": True}
