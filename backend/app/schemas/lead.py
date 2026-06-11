from typing import Literal

from pydantic import BaseModel, Field

LeadStatus = Literal["new", "contacted", "meeting", "reserved", "deal", "lost"]


class LeadCreate(BaseModel):
    property_id: int
    client_name: str = Field(min_length=2, max_length=255)
    phone: str = Field(min_length=7, max_length=20, pattern=r"^[+0-9()\-\s]{7,20}$")
    note: str = Field(default="", max_length=1000)


class LeadStatusUpdate(BaseModel):
    status: LeadStatus
    manager_comment: str = Field(default="", max_length=1000)


class LeadOut(LeadCreate):
    id: int
    status: LeadStatus
    manager_comment: str

    model_config = {"from_attributes": True}
