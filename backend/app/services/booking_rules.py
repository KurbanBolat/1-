from datetime import date, timedelta

from fastapi import HTTPException

MIN_STAY_NIGHTS = 1
MAX_STAY_NIGHTS = 30
MAX_BOOKING_HORIZON_DAYS = 365


def validate_stay_nights(check_in: date, check_out: date) -> int:
    if check_out <= check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in")
    nights = (check_out - check_in).days
    if nights < MIN_STAY_NIGHTS or nights > MAX_STAY_NIGHTS:
        raise HTTPException(
            status_code=400,
            detail=f"Stay duration must be between {MIN_STAY_NIGHTS} and {MAX_STAY_NIGHTS} nights",
        )
    return nights


def validate_booking_window(check_in: date, check_out: date, today: date | None = None) -> int:
    current = today or date.today()
    if check_in < current:
        raise HTTPException(status_code=400, detail="check_in cannot be in the past")
    max_check_in = current + timedelta(days=MAX_BOOKING_HORIZON_DAYS)
    if check_in > max_check_in:
        raise HTTPException(
            status_code=400,
            detail=f"check_in is too far in the future (max {MAX_BOOKING_HORIZON_DAYS} days ahead)",
        )
    return validate_stay_nights(check_in, check_out)
