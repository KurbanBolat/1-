from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.property import Property
from app.schemas.property import PropertyCreate, PropertyListOut, PropertyOut

router = APIRouter(prefix="/properties", tags=["properties"])


@router.get("", response_model=PropertyListOut)
def list_properties(
    city: str | None = Query(default=None),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    min_price: float | None = Query(default=None, gt=0),
    max_price: float | None = Query(default=None, gt=0),
    min_area: float | None = Query(default=None, gt=0),
    max_area: float | None = Query(default=None, gt=0),
    rooms: int | None = Query(default=None, ge=1),
    sort_by: str = Query(default="newest", pattern="^(newest|price|area)$"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    filters = [Property.is_active.is_(True)]

    if city:
        filters.append(Property.city == city)
    if min_price:
        filters.append(Property.price >= min_price)
    if max_price:
        filters.append(Property.price <= max_price)
    if min_area:
        filters.append(Property.area_m2 >= min_area)
    if max_area:
        filters.append(Property.area_m2 <= max_area)
    if rooms:
        filters.append(Property.rooms == rooms)
    if q:
        like_term = f"%{q.strip()}%"
        filters.append(
            or_(
                Property.title.ilike(like_term),
                Property.district.ilike(like_term),
                Property.description.ilike(like_term),
            )
        )

    if sort_by == "price":
        sort_column = Property.price
    elif sort_by == "area":
        sort_column = Property.area_m2
    else:
        sort_column = Property.id

    ordering = sort_column.asc() if sort_order == "asc" else sort_column.desc()

    where_clause = and_(*filters)
    total = db.scalar(select(func.count()).select_from(Property).where(where_clause)) or 0

    stmt = (
        select(Property)
        .where(where_clause)
        .order_by(ordering)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    items = list(db.scalars(stmt).all())
    return PropertyListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/{property_id}", response_model=PropertyOut)
def get_property(property_id: int, db: Session = Depends(get_db)):
    item = db.get(Property, property_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Property not found")
    return item


@router.post("", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(payload: PropertyCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = Property(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{property_id}", response_model=PropertyOut)
def update_property(property_id: int, payload: PropertyCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = db.get(Property, property_id)
    if not item:
        raise HTTPException(status_code=404, detail="Property not found")

    for key, value in payload.model_dump().items():
        setattr(item, key, value)

    db.commit()
    db.refresh(item)
    return item
