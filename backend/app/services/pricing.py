from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

TariffPlan = Literal["basic", "smart", "flex"]


@dataclass(frozen=True)
class TariffConfig:
    multiplier: float
    service_percent: float
    cancellation_policy: str
    cancellation_text: str


TARIFFS: dict[TariffPlan, TariffConfig] = {
    "basic": TariffConfig(
        multiplier=0.95,
        service_percent=9,
        cancellation_policy="strict",
        cancellation_text="No refund for cancellations within 7 days before check-in",
    ),
    "smart": TariffConfig(
        multiplier=1.0,
        service_percent=11,
        cancellation_policy="moderate",
        cancellation_text="Full refund up to 3 days before check-in",
    ),
    "flex": TariffConfig(
        multiplier=1.12,
        service_percent=13,
        cancellation_policy="flexible",
        cancellation_text="Full refund up to 1 day before check-in",
    ),
}

WEEKEND_MULTIPLIER = 1.08
HIGH_SEASON_MULTIPLIER = 1.15
SHOULDER_SEASON_MULTIPLIER = 1.06

HIGH_SEASON_MONTHS = {6, 7, 8}
SHOULDER_SEASON_MONTHS = {4, 5, 9, 10}


def resolve_tariff(value: str | None) -> TariffPlan:
    if value in TARIFFS:
        return value  # type: ignore[return-value]
    return "smart"


def _is_high_season(day: date) -> bool:
    if day.month in HIGH_SEASON_MONTHS:
        return True
    # Holiday surge around New Year.
    if (day.month == 12 and day.day >= 20) or (day.month == 1 and day.day <= 10):
        return True
    return False


def _is_shoulder_season(day: date) -> bool:
    return day.month in SHOULDER_SEASON_MONTHS


def daily_dynamic_multiplier(day: date) -> float:
    multiplier = 1.0
    # Friday/Saturday nights are typically higher-demand.
    if day.weekday() in {4, 5}:
        multiplier *= WEEKEND_MULTIPLIER
    if _is_high_season(day):
        multiplier *= HIGH_SEASON_MULTIPLIER
    elif _is_shoulder_season(day):
        multiplier *= SHOULDER_SEASON_MULTIPLIER
    return round(multiplier, 4)


def dynamic_multiplier_for_range(check_in: date, check_out: date) -> float:
    if check_out <= check_in:
        return 1.0
    current = check_in
    days = 0
    total = 0.0
    while current < check_out:
        total += daily_dynamic_multiplier(current)
        days += 1
        current += timedelta(days=1)
    if days == 0:
        return 1.0
    return round(total / days, 4)


def quote_price(
    nightly_price: float,
    cleaning_fee: float,
    nights: int,
    tariff_plan: TariffPlan,
    check_in: date | None = None,
    check_out: date | None = None,
) -> dict[str, float | str]:
    cfg = TARIFFS[tariff_plan]
    dynamic_multiplier = 1.0
    if check_in and check_out:
        dynamic_multiplier = dynamic_multiplier_for_range(check_in, check_out)

    adjusted_nightly = round(nightly_price * cfg.multiplier * dynamic_multiplier, 2)
    subtotal = round(adjusted_nightly * nights, 2)
    service_fee = round(subtotal * (cfg.service_percent / 100), 2)
    total = round(subtotal + cleaning_fee + service_fee, 2)

    return {
        "nightly_price": adjusted_nightly,
        "subtotal": subtotal,
        "service_fee": service_fee,
        "total": total,
        "dynamic_multiplier": dynamic_multiplier,
        "cancellation_policy": cfg.cancellation_policy,
        "cancellation_text": cfg.cancellation_text,
    }


def overlap(range_start: date, range_end: date, booked_start: date, booked_end: date) -> bool:
    return booked_start < range_end and booked_end > range_start
