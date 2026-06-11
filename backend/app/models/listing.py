from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    district: Mapped[str] = mapped_column(String(120), nullable=False)
    property_type: Mapped[str] = mapped_column(String(50), nullable=False, default="apartment")
    nightly_price: Mapped[float] = mapped_column(Float, nullable=False)
    cleaning_fee: Mapped[float] = mapped_column(Float, nullable=False, default=7000)
    service_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=10)
    cancellation_policy: Mapped[str] = mapped_column(String(20), nullable=False, default="flexible")
    rating: Mapped[float] = mapped_column(Float, nullable=False, default=4.6)
    max_guests: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    bedrooms: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    bathrooms: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    amenities: Mapped[str] = mapped_column(Text, nullable=False, default="WiFi,Kitchen")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    owner_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now, nullable=False)


