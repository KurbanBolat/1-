from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.lead import Lead
from app.models.property import Property
from app.schemas.lead import LeadCreate, LeadOut, LeadStatusUpdate

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(payload: LeadCreate, db: Session = Depends(get_db)):
    property_obj = db.get(Property, payload.property_id)
    if not property_obj or not property_obj.is_active:
        raise HTTPException(status_code=404, detail="Property not found")

    data = payload.model_dump()
    data["client_name"] = data["client_name"].strip()
    data["phone"] = data["phone"].strip()
    data["note"] = data["note"].strip()
    lead = Lead(**data)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


@router.get("", response_model=list[LeadOut])
def list_leads(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    stmt = select(Lead)
    if status_filter:
        stmt = stmt.where(Lead.status == status_filter)
    stmt = stmt.order_by(Lead.id.desc())
    return list(db.scalars(stmt).all())


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead_status(
    lead_id: int,
    payload: LeadStatusUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead.status = payload.status
    lead.manager_comment = payload.manager_comment.strip()
    db.commit()
    db.refresh(lead)
    return lead
