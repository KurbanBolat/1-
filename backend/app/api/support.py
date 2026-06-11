from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.api.deps import require_partner
from app.db.session import get_db
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support_ticket import SupportTicketOut, SupportTicketStatusUpdate

router = APIRouter(prefix="/support", tags=["support"])


@router.get("/tickets", response_model=list[SupportTicketOut])
def list_support_tickets(
    status: str | None = Query(default=None, pattern="^(open|in_progress|resolved)$"),
    priority: str | None = Query(default=None, pattern="^(low|medium|high)$"),
    db: Session = Depends(get_db),
    _: User = Depends(require_partner),
):
    priority_order = case(
        (SupportTicket.priority == "high", 0),
        (SupportTicket.priority == "medium", 1),
        else_=2,
    )
    stmt = select(SupportTicket).order_by(priority_order.asc(), SupportTicket.id.desc())
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    if priority:
        stmt = stmt.where(SupportTicket.priority == priority)
    return list(db.scalars(stmt).all())


@router.patch("/tickets/{ticket_id}", response_model=SupportTicketOut)
def update_support_ticket_status(
    ticket_id: int,
    payload: SupportTicketStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_partner),
):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Support ticket not found")
    ticket.status = payload.status
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket
