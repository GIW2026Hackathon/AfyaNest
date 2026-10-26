"""Request/response models (Pydantic v2). FastAPI uses them for validation and for
the automatic API docs at /docs."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

from airnest.config import N_NODES


class HouseIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    device_key: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=40)
    phone: str = Field(pattern=r"^\+\d{9,15}$", examples=["+254712345678"])
    tech_phone: Optional[str] = Field(default=None, pattern=r"^\+\d{9,15}$")
    lang: Literal["sw", "en"] = "sw"
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    t_mean: float = Field(default=17.0, description="typical daily mean outside temp, C")
    placement_ts: Optional[int] = Field(default=None, description="unix time chicks arrived")
    has_fan: bool = False
    n_birds: Optional[int] = Field(default=None, ge=1)


class NodeReading(BaseModel):
    node: int = Field(ge=0, lt=N_NODES)
    seq: Optional[int] = None
    nh3_ppm: Optional[float] = Field(default=None, ge=0, le=1000)
    temp_c: Optional[float] = Field(default=None, ge=-20, le=70)
    rh_pct: Optional[float] = Field(default=None, ge=0, le=100)
    co2_ppm: Optional[float] = Field(default=None, ge=0, le=20000)
    rs_kohm: Optional[float] = None
    vbat: Optional[float] = None
    flags: int = 0


class IngestIn(BaseModel):
    device_id: str
    ts: Optional[float] = Field(default=None, description="optional unix time of the batch")
    nodes: list[NodeReading] = Field(default_factory=list, max_length=64)
    curtain: Optional[float] = Field(default=None, ge=0, le=1)
    fan: float = Field(default=0, ge=0, le=1)
    local_override: bool = False


class IngestReply(BaseModel):
    fan: int
    buzzer: int
    level: Literal["ok", "watch", "warn", "danger"]


class StatusOut(BaseModel):
    advice: Optional[dict]
    readings: list[dict]
