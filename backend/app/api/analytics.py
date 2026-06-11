import json
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_partner
from app.core.time import utc_now
from app.db.session import get_db
from app.models.analytics_event import AnalyticsEvent
from app.models.listing import Listing
from app.models.user import User
from app.schemas.analytics import (
    AnalyticsAbSummaryOut,
    AnalyticsAbVariantOut,
    AnalyticsEventIn,
    AnalyticsEventOut,
    AnalyticsFunnelOut,
    AnalyticsFunnelStepOut,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/events", response_model=AnalyticsEventOut, status_code=201)
def create_analytics_event(payload: AnalyticsEventIn, db: Session = Depends(get_db)):
    AnalyticsEvent.__table__.create(bind=db.get_bind(), checkfirst=True)
    event = AnalyticsEvent(
        event_name=payload.event_name,
        session_id=payload.session_id,
        listing_id=payload.listing_id,
        reservation_id=payload.reservation_id,
        lang=payload.lang,
        currency=payload.currency,
        metadata_json=json.dumps(payload.metadata or {}),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return AnalyticsEventOut(id=event.id, event_name=event.event_name)


@router.get("/funnel/mine", response_model=AnalyticsFunnelOut)
def get_partner_funnel(
    period_days: int = Query(default=30, ge=1, le=180),
    listing_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    now = utc_now()
    floor = now - timedelta(days=period_days)
    step_order = ["chat_open", "filters_collected", "checkout_clicked", "payment_started", "paid"]
    labels = {
        "chat_open": "Chat opened",
        "filters_collected": "Filters collected",
        "checkout_clicked": "Checkout clicked",
        "payment_started": "Payment started",
        "paid": "Paid",
    }

    filters = [AnalyticsEvent.created_at >= floor, AnalyticsEvent.event_name.in_(step_order)]

    if user.role != "admin":
        owned_listing_ids = list(db.scalars(select(Listing.id).where(Listing.owner_id == user.id)).all())
        if listing_id is not None:
            if listing_id not in owned_listing_ids:
                return AnalyticsFunnelOut(
                    period_days=period_days,
                    total_events=0,
                    steps=[AnalyticsFunnelStepOut(event_name=name, label=labels[name], count=0, conversion_from_open=0.0) for name in step_order],
                )
            filters.append(AnalyticsEvent.listing_id == listing_id)
        elif owned_listing_ids:
            filters.append(AnalyticsEvent.listing_id.in_(owned_listing_ids))
        else:
            return AnalyticsFunnelOut(
                period_days=period_days,
                total_events=0,
                steps=[AnalyticsFunnelStepOut(event_name=name, label=labels[name], count=0, conversion_from_open=0.0) for name in step_order],
            )
    elif listing_id is not None:
        filters.append(AnalyticsEvent.listing_id == listing_id)

    rows = list(
        db.execute(
            select(AnalyticsEvent.event_name, func.count())
            .where(*filters)
            .group_by(AnalyticsEvent.event_name)
        ).all()
    )
    counts = {str(name): int(count) for name, count in rows}
    base = max(1, counts.get("chat_open", 0))
    steps = [
        AnalyticsFunnelStepOut(
            event_name=name,
            label=labels[name],
            count=counts.get(name, 0),
            conversion_from_open=round((counts.get(name, 0) / base) * 100.0, 2) if counts.get("chat_open", 0) > 0 else 0.0,
        )
        for name in step_order
    ]
    return AnalyticsFunnelOut(
        period_days=period_days,
        total_events=sum(step.count for step in steps),
        steps=steps,
    )


@router.get("/ab/mine", response_model=AnalyticsAbSummaryOut)
def get_partner_ab_summary(
    period_days: int = Query(default=30, ge=1, le=180),
    listing_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_partner),
):
    now = utc_now()
    floor = now - timedelta(days=period_days)
    tracked_events = {
        "ab_variant_exposed",
        "listing_open_clicked",
        "checkout_clicked",
        "payment_started",
        "paid",
    }
    metric_order = ["ab_variant_exposed", "listing_open_clicked", "checkout_clicked", "payment_started", "paid"]
    variant_keys = ("a", "b")
    metrics: dict[str, dict[str, int]] = {
        key: {event_name: 0 for event_name in metric_order}
        for key in variant_keys
    }

    filters = [AnalyticsEvent.created_at >= floor, AnalyticsEvent.event_name.in_(tuple(tracked_events))]

    if user.role != "admin":
        owned_listing_ids = list(db.scalars(select(Listing.id).where(Listing.owner_id == user.id)).all())
        if listing_id is not None:
            if listing_id not in owned_listing_ids:
                return AnalyticsAbSummaryOut(
                    period_days=period_days,
                    variants=[
                        AnalyticsAbVariantOut(
                            variant=key.upper(),
                            exposed=0,
                            listing_open_clicked=0,
                            checkout_clicked=0,
                            payment_started=0,
                            paid=0,
                            ctr_from_exposed=0.0,
                            checkout_from_exposed=0.0,
                            paid_from_exposed=0.0,
                            paid_from_checkout=0.0,
                        )
                        for key in variant_keys
                    ],
                )
            filters.append(AnalyticsEvent.listing_id == listing_id)
        elif owned_listing_ids:
            filters.append(AnalyticsEvent.listing_id.in_(owned_listing_ids))
        else:
            return AnalyticsAbSummaryOut(
                period_days=period_days,
                variants=[
                    AnalyticsAbVariantOut(
                        variant=key.upper(),
                        exposed=0,
                        listing_open_clicked=0,
                        checkout_clicked=0,
                        payment_started=0,
                        paid=0,
                        ctr_from_exposed=0.0,
                        checkout_from_exposed=0.0,
                        paid_from_exposed=0.0,
                        paid_from_checkout=0.0,
                    )
                    for key in variant_keys
                ],
            )
    elif listing_id is not None:
        filters.append(AnalyticsEvent.listing_id == listing_id)

    rows = list(
        db.execute(
            select(AnalyticsEvent.event_name, AnalyticsEvent.metadata_json)
            .where(*filters)
        ).all()
    )

    for event_name, metadata_json in rows:
        try:
            payload = json.loads(metadata_json or "{}")
        except Exception:
            payload = {}
        variant_raw = str(payload.get("variant", "a")).strip().lower()
        variant_key = variant_raw if variant_raw in variant_keys else "a"
        if str(event_name) in tracked_events:
            metrics[variant_key][str(event_name)] += 1

    out_variants: list[AnalyticsAbVariantOut] = []
    for variant_key in variant_keys:
        bucket = metrics[variant_key]
        exposed = bucket["ab_variant_exposed"]
        checkout_clicked = bucket["checkout_clicked"]
        out_variants.append(
            AnalyticsAbVariantOut(
                variant=variant_key.upper(),
                exposed=exposed,
                listing_open_clicked=bucket["listing_open_clicked"],
                checkout_clicked=checkout_clicked,
                payment_started=bucket["payment_started"],
                paid=bucket["paid"],
                ctr_from_exposed=round((bucket["listing_open_clicked"] / exposed) * 100.0, 2) if exposed else 0.0,
                checkout_from_exposed=round((checkout_clicked / exposed) * 100.0, 2) if exposed else 0.0,
                paid_from_exposed=round((bucket["paid"] / exposed) * 100.0, 2) if exposed else 0.0,
                paid_from_checkout=round((bucket["paid"] / checkout_clicked) * 100.0, 2) if checkout_clicked else 0.0,
            )
        )

    return AnalyticsAbSummaryOut(period_days=period_days, variants=out_variants)
