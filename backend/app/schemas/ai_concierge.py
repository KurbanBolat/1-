from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


AiConciergeMode = Literal["openai", "fallback"]
AiConciergeActionType = Literal[
    "add_item",
    "submit_room_order",
    "submit_draft_order",
    "select_restaurant",
    "book_table",
    "none",
]


class AiConciergeChatMessage(BaseModel):
    role: Literal["assistant", "user"]
    text: str = Field(min_length=1, max_length=2000)


class AiConciergeMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    lang: Literal["ru", "en"] = "ru"
    currency: Literal["KZT", "USD"] = "KZT"
    listing_id: int | None = Field(default=None, ge=1)
    reservation_id: int | None = Field(default=None, ge=1)
    guest_email: EmailStr | None = None
    access_token: str | None = Field(default=None, min_length=16, max_length=512)
    history: list[AiConciergeChatMessage] = Field(default_factory=list, max_length=12)
    draft_items: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class AiConciergeActionOut(BaseModel):
    type: AiConciergeActionType = "none"
    label: str = ""
    item_id: int | None = None
    restaurant_id: int | None = None
    quantity: int | None = None
    booking_date: str | None = None
    booking_time: str | None = None
    guests: int | None = None
    note: str | None = None


class AiConciergeContextOut(BaseModel):
    listing_id: int
    reservation_id: int | None = None
    menu_count: int
    restaurant_count: int
    active_order_count: int
    active_table_booking_count: int


class AiConciergeMessageOut(BaseModel):
    mode: AiConciergeMode
    answer: str
    action: AiConciergeActionOut | None = None
    follow_up_prompts: list[str] = Field(default_factory=list)
    context: AiConciergeContextOut
