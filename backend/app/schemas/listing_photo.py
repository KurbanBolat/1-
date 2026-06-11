from datetime import datetime

from pydantic import BaseModel


class ListingPhotoOut(BaseModel):
    id: int
    listing_id: int
    file_url: str
    is_cover: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ListingPhotoReorderIn(BaseModel):
    photo_ids: list[int]
