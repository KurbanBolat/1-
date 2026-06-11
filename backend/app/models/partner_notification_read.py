from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class PartnerNotificationRead(Base):
    __tablename__ = "partner_notification_reads"
    __table_args__ = (UniqueConstraint("user_id", "event_id", name="uq_partner_notification_read"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    event_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
