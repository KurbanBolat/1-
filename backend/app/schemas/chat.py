from typing import Literal

from pydantic import BaseModel, Field


class ChatBookingState(BaseModel):
    listing_id: int | None = None
    room_type_id: int | None = None
    room_type_name: str | None = None
    title: str | None = None
    check_in: str | None = None
    check_out: str | None = None
    guests: int | None = None
    guest_name: str | None = None
    guest_email: str | None = None
    guest_phone: str | None = None
    check_in_time: str | None = None
    step: str | None = None


class ChatRecommendIn(BaseModel):
    message: str = Field(min_length=2, max_length=1000)
    lang: str = Field(default="ru", pattern="^(ru|en)$")
    currency: str = Field(default="KZT", pattern="^(KZT|USD)$")
    context_messages: list[str] = Field(default_factory=list, max_length=6)
    session_id: str | None = Field(default=None, min_length=8, max_length=64)
    booking_state: ChatBookingState | None = None


class ChatSuggestedFilters(BaseModel):
    city: str | None = None
    check_in: str | None = None
    check_out: str | None = None
    guests: int | None = None
    min_price: int | None = None
    max_price: int | None = None
    trip_purpose: str | None = None
    property_type: str | None = None
    amenities: list[str] = Field(default_factory=list)
    q: str | None = None


class ChatSuggestion(BaseModel):
    listing_id: int
    room_type_id: int | None = None
    room_type_name: str | None = None
    title: str
    city: str
    district: str
    nightly_price: float
    rating: float
    max_guests: int
    reason: str
    amenities: str | None = None
    cover_photo_url: str | None = None
    room_nightly_price: float | None = None
    room_available_count: int | None = None
    room_max_guests: int | None = None


class ChatAlternative(BaseModel):
    listing_id: int
    title: str
    city: str
    district: str
    nightly_price: float
    unavailable_reason: str
    suggested_check_in: str
    suggested_check_out: str
    cover_photo_url: str | None = None


class ChatNextAction(BaseModel):
    type: Literal["apply_filters", "start_booking", "apply_alternative_dates", "go_checkout", "handoff_contact", "none"]
    label: str
    listing_id: int | None = None
    room_type_id: int | None = None
    room_type_name: str | None = None
    title: str | None = None
    city: str | None = None
    check_in: str | None = None
    check_out: str | None = None
    guests: int | None = None


class ChatRecommendOut(BaseModel):
    stage: Literal["collect", "search", "availability", "pricing", "booking", "payment_link", "handoff"]
    answer: str
    selection_summary: str
    reasoning: str
    filters: ChatSuggestedFilters
    suggestions: list[ChatSuggestion]
    alternatives: list[ChatAlternative] = Field(default_factory=list)
    total_found: int
    follow_up_prompts: list[str] = Field(default_factory=list)
    workflow_steps: list[str] = Field(default_factory=list)
    next_action: ChatNextAction | None = None
    session_id: str | None = None
    booking_state: ChatBookingState | None = None
