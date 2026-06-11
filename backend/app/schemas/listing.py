from datetime import date, datetime

from pydantic import BaseModel, Field


class ListingCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    city: str = Field(min_length=2, max_length=120)
    district: str = Field(min_length=2, max_length=120)
    property_type: str = Field(default="apartment", min_length=3, max_length=50)
    nightly_price: float = Field(gt=0)
    cleaning_fee: float = Field(default=7000, ge=0)
    service_fee_percent: float = Field(default=10, ge=0, le=50)
    cancellation_policy: str = Field(default="flexible", min_length=3, max_length=20)
    rating: float = Field(default=4.6, ge=0, le=5)
    max_guests: int = Field(default=2, ge=1, le=20)
    bedrooms: int = Field(default=1, ge=0, le=20)
    bathrooms: int = Field(default=1, ge=0, le=20)
    amenities: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=5000)
    is_active: bool = True


class ListingBulkStatusIn(BaseModel):
    listing_ids: list[int] = Field(min_length=1)
    is_active: bool


class RoomTypeCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    description: str = Field(default="", max_length=5000)
    nightly_price: float = Field(gt=0)
    total_inventory: int = Field(default=1, ge=0, le=500)
    max_guests: int = Field(default=2, ge=1, le=20)
    bedrooms: int = Field(default=1, ge=0, le=20)
    bathrooms: int = Field(default=1, ge=0, le=20)
    amenities: str = Field(default="", max_length=2000)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=1000)


class RoomTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, max_length=5000)
    nightly_price: float | None = Field(default=None, gt=0)
    total_inventory: int | None = Field(default=None, ge=0, le=500)
    max_guests: int | None = Field(default=None, ge=1, le=20)
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    bathrooms: int | None = Field(default=None, ge=0, le=20)
    amenities: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)


class RoomTypeOut(BaseModel):
    id: int
    listing_id: int
    name: str
    description: str
    nightly_price: float
    total_inventory: int
    max_guests: int
    bedrooms: int
    bathrooms: int
    amenities: str
    is_active: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ListingOut(BaseModel):
    id: int
    title: str
    city: str
    district: str
    property_type: str
    nightly_price: float
    cleaning_fee: float
    service_fee_percent: float
    cancellation_policy: str
    rating: float
    max_guests: int
    bedrooms: int
    bathrooms: int
    amenities: str
    description: str
    is_active: bool
    owner_id: int | None
    cover_photo_url: str | None = None

    model_config = {"from_attributes": True}


class ListingListOut(BaseModel):
    items: list[ListingOut]
    total: int
    page: int
    page_size: int


class RoomAvailabilityWindowOut(BaseModel):
    check_in: date
    check_out: date
    nights: int
    available_count: int


class RoomTypeAvailabilityOut(BaseModel):
    id: int
    listing_id: int
    name: str
    description: str
    nightly_price: float
    total_inventory: int
    max_guests: int
    bedrooms: int
    bathrooms: int
    amenities: str
    is_active: bool
    sort_order: int
    available_count: int
    available_windows: list[RoomAvailabilityWindowOut]


class ListingRoomAvailabilityOut(BaseModel):
    listing_id: int
    from_date: date
    to_date: date
    guests: int | None = None
    room_types: list[RoomTypeAvailabilityOut]


class QuoteOut(BaseModel):
    listing_id: int
    room_type_id: int | None = None
    room_type_name: str | None = None
    available: bool
    check_in: date
    check_out: date
    guests: int
    nights: int
    nightly_price: float
    subtotal: float
    cleaning_fee: float
    service_fee: float
    total: float
    dynamic_multiplier: float
    tariff_plan: str
    cancellation_policy: str
    cancellation_text: str
    quote_token: str | None = None
    quote_expires_at: datetime | None = None
