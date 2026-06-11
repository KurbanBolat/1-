from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


RoomServiceStatus = Literal["submitted", "accepted", "preparing", "delivered", "closed", "cancelled"]
RestaurantBookingStatus = Literal["submitted", "confirmed", "seated", "completed", "cancelled"]


class MenuItemOut(BaseModel):
    id: int
    listing_id: int
    name: str
    description: str
    price: float
    category: str
    is_active: bool
    sort_order: int

    model_config = {"from_attributes": True}


class MenuItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    description: str = Field(default="", max_length=2000)
    price: float = Field(gt=0)
    category: str = Field(default="main", min_length=2, max_length=80)
    is_active: bool = True
    sort_order: int = 0


class RoomServiceOrderItemIn(BaseModel):
    menu_item_id: int
    quantity: int = Field(ge=1, le=20)
    note: str = Field(default="", max_length=500)


class RoomServiceOrderCreate(BaseModel):
    reservation_id: int
    guest_email: EmailStr
    access_token: str | None = Field(default=None, min_length=16, max_length=512)
    items: list[RoomServiceOrderItemIn] = Field(min_length=1, max_length=20)
    delivery_note: str = Field(default="", max_length=1000)


class RoomServiceOrderItemOut(BaseModel):
    menu_item_id: int
    item_name: str
    unit_price: float
    quantity: int
    line_total: float
    note: str


class RoomServiceOrderOut(BaseModel):
    id: int
    listing_id: int
    reservation_id: int
    guest_email: EmailStr
    guest_name: str
    status: RoomServiceStatus
    total_price: float
    currency: str
    delivery_note: str
    created_at: datetime
    updated_at: datetime
    items: list[RoomServiceOrderItemOut]


class RoomServiceOrderStatusUpdate(BaseModel):
    status: RoomServiceStatus


class RestaurantOut(BaseModel):
    id: int
    listing_id: int
    name: str
    cuisine: str
    description: str
    open_from: str
    open_to: str
    avg_check_kzt: int
    is_active: bool

    model_config = {"from_attributes": True}


class RestaurantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    cuisine: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    open_from: str = Field(default="08:00", pattern=r"^\d{2}:\d{2}$")
    open_to: str = Field(default="23:00", pattern=r"^\d{2}:\d{2}$")
    avg_check_kzt: int = Field(default=8000, ge=0, le=500000)
    is_active: bool = True


class RestaurantTableBookingCreate(BaseModel):
    reservation_id: int
    restaurant_id: int
    guest_email: EmailStr
    access_token: str | None = Field(default=None, min_length=16, max_length=512)
    booking_date: date
    booking_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    guests: int = Field(default=2, ge=1, le=20)
    note: str = Field(default="", max_length=1000)


class RestaurantTableBookingOut(BaseModel):
    id: int
    listing_id: int
    restaurant_id: int
    restaurant_name: str
    reservation_id: int
    guest_email: EmailStr
    guest_name: str
    booking_date: date
    booking_time: str
    guests: int
    note: str
    status: RestaurantBookingStatus
    created_at: datetime
    updated_at: datetime


class RestaurantTableBookingStatusUpdate(BaseModel):
    status: RestaurantBookingStatus


class RestaurantBookingEventOut(BaseModel):
    id: int
    booking_id: int
    listing_id: int
    reservation_id: int
    restaurant_id: int
    guest_email: EmailStr
    event_type: str
    status: RestaurantBookingStatus
    message: str
    actor_role: str
    created_at: datetime
