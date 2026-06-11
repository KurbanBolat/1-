from pydantic import BaseModel, Field


class PropertyBase(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    city: str = Field(min_length=2, max_length=120)
    district: str = Field(min_length=2, max_length=120)
    price: float = Field(gt=0)
    area_m2: float = Field(gt=0)
    rooms: int = Field(ge=1, le=10)
    description: str = Field(default="", max_length=5000)
    is_active: bool = True


class PropertyCreate(PropertyBase):
    pass


class PropertyOut(PropertyBase):
    id: int

    model_config = {"from_attributes": True}


class PropertyListOut(BaseModel):
    items: list[PropertyOut]
    total: int
    page: int
    page_size: int
