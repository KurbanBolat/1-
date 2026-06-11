from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class ChatSessionState(Base):
    __tablename__ = "chat_session_states"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    filters_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    booking_state_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now, index=True)


