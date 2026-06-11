from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.ops import ObservabilityMetricsOut, OpsStatusOut
from app.services.ops_service import get_observability_metrics, get_ops_status

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/metrics", response_model=ObservabilityMetricsOut)
def read_observability_metrics(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ObservabilityMetricsOut:
    return get_observability_metrics(db)


@router.get("/status", response_model=OpsStatusOut)
def read_ops_status(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> OpsStatusOut:
    return get_ops_status(db)
