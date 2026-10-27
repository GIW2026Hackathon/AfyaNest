"""Request/response models (Pydantic v2). FastAPI uses them for validation and for
the automatic API docs at /docs."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

from airnest.config import N_NODES


class HouseIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    device_key: Optional[str] = Field(
        default=None, min_length=12, max_length=128,
        description="leave empty and the server generates a strong key (shown once)")
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
    source: Literal["synthetic", "live"] = Field(
        default="synthetic", description="synthetic = simulated readings until a sensor box is fitted")
    sms_test: bool = Field(default=False, description="text TEST alerts from synthetic data")
    county: Optional[str] = Field(default=None, max_length=40)


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
    heater: int = 0
    curtain: Optional[int] = None          # 0-100 % when the house has a curtain motor
    tlo: Optional[float] = None            # comfort band for the birds' age (box fallback)
    thi: Optional[float] = None


class StatusOut(BaseModel):
    advice: Optional[dict]
    readings: list[dict]


class HouseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    phone: Optional[str] = Field(default=None, pattern=r"^\+\d{9,15}$")
    tech_phone: Optional[str] = Field(default=None, pattern=r"^\+\d{9,15}$")
    lang: Optional[Literal["sw", "en"]] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    t_mean: Optional[float] = Field(default=None, ge=-10, le=45)
    placement_ts: Optional[int] = None
    has_fan: Optional[bool] = None
    has_heater: Optional[bool] = None
    has_curtain: Optional[bool] = None
    n_birds: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    source: Optional[Literal["synthetic", "live"]] = None
    sms_test: Optional[bool] = None
    county: Optional[str] = Field(default=None, max_length=40)


# ---------------------------------------------------------------- auth
class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class SignupIn(BaseModel):
    org_name: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class PasswordIn(BaseModel):
    password: str = Field(max_length=256)


class InviteIn(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(min_length=1, max_length=80)
    role: Literal["owner", "manager", "viewer"] = "viewer"


class MemberUpdate(BaseModel):
    role: Optional[Literal["owner", "manager", "viewer"]] = None
    disabled: Optional[bool] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    require_mfa: Optional[bool] = None


class ProvisionIn(BaseModel):
    org_name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=254)
    name: str = Field(min_length=2, max_length=80)
    password: str = Field(max_length=256)


# ---------------------------------------------------------------- farmers & sandbox
PHONE = r"^\+\d{9,15}$"


class FarmerIn(BaseModel):
    name: str = Field(min_length=2, max_length=60, pattern=r"^[A-Za-z][A-Za-z '\-.]{1,59}$")
    phone: str = Field(pattern=PHONE)
    county: str = Field(min_length=2, max_length=40)
    lang: Literal["sw", "en"] = "sw"
    n_birds: Optional[int] = Field(default=None, ge=1, le=200_000)
    age_weeks: int = Field(default=0, ge=0, le=80)
    device_id: Optional[str] = Field(default=None, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$")
    test: bool = False
    backup_phone: Optional[str] = Field(default=None, pattern=PHONE)
    has_fan: bool = False
    has_heater: bool = False
    has_curtain: bool = False


class FarmerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=60,
                                pattern=r"^[A-Za-z][A-Za-z '\-.]{1,59}$")
    county: Optional[str] = Field(default=None, max_length=40)
    lang: Optional[Literal["sw", "en"]] = None
    n_birds: Optional[int] = Field(default=None, ge=1, le=200_000)
    status: Optional[Literal["active", "stopped"]] = None


class SandboxSmsIn(BaseModel):
    phone: str = Field(pattern=PHONE)
    text: str = Field(min_length=1, max_length=160)


class SimReadingIn(BaseModel):
    """Sensor simulator: pretend a sensor box sent these readings (demo / training)."""
    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    temp: float = Field(ge=-5, le=50)
    rh: float = Field(ge=0, le=100)
    nh3: Optional[float] = Field(default=None, ge=0, le=100)
    hold_min: int = Field(default=15, ge=1, le=120)


class SimReleaseIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")


class ScenarioIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    kind: Literal["cold", "heat", "ammonia", "normal"]
