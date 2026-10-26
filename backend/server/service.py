"""All server behaviour, independent of the web framework.

FastAPI (server/main.py) is a thin layer over this class, which keeps the logic easy
to test and lets you swap or add interfaces (USSD, WhatsApp, a dashboard) later.
"""
from __future__ import annotations

import hmac
import json
import re
import time

from . import notify
from .pipeline import SLOT, Brain
from .schemas import HouseIn, IngestIn
from .store import Store

MAX_CLOCK_SKEW = 7 * 86400


class ServiceError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _same(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(a, b)


class AirNestService:
    def __init__(self, db_path: str, model_dir: str, admin_key: str = ""):
        self.store = Store(db_path)
        self.brain = Brain(self.store, model_dir)
        self.admin_key = admin_key

    # ------------------------------------------------------------- houses
    def register_house(self, h: HouseIn, admin_key: str | None) -> dict:
        if not _same(admin_key, self.admin_key):
            raise ServiceError(401, "bad admin key")
        self.store.upsert_house(
            device_id=h.device_id, device_key=h.device_key, name=h.name, phone=h.phone,
            tech_phone=h.tech_phone, lang=h.lang, lat=h.lat, lon=h.lon, t_mean=h.t_mean,
            placement_ts=h.placement_ts or int(time.time()), has_fan=int(h.has_fan),
            n_birds=h.n_birds, last_curtain=None, last_curtain_ts=None)
        return {"ok": True}

    def status(self, device_id: str, device_key: str | None, admin_key: str | None) -> dict:
        house = self.store.house(device_id)
        if not house:
            raise ServiceError(404, "unknown house")
        if not (_same(device_key, house["device_key"]) or _same(admin_key, self.admin_key)):
            raise ServiceError(401, "bad key")
        adv = self.store.q("SELECT json FROM advice WHERE device_id=?", (device_id,), one=True)
        rows = self.store.readings_since(device_id, int(time.time() // SLOT) - 72)
        return {"advice": json.loads(adv["json"]) if adv else None,
                "readings": [dict(r) for r in rows]}

    # ------------------------------------------------------------- gateway
    def ingest(self, body: IngestIn, device_key: str | None) -> dict:
        house = self.store.house(body.device_id)
        if not house or not _same(device_key, house["device_key"]):
            raise ServiceError(401, "bad device key")
        now = time.time()
        ts = body.ts if body.ts is not None and abs(body.ts - now) <= MAX_CLOCK_SKEW else now
        reply, _ = self.brain.ingest(house, body.model_dump(), ts)
        return reply

    # ------------------------------------------------------------- farmer SMS
    def incoming_sms(self, phone: str, text: str) -> None:
        house = self.store.house_by_phone(phone)
        if not house:
            return
        text = text.strip()
        sw = house["lang"] == "sw"
        m = re.match(r"^(pazia|curtain)\s+(\d{1,3})\s*%?$", text, re.I)
        if m:
            pct = min(100, int(m.group(2)))
            self.store.q("UPDATE houses SET last_curtain=?, last_curtain_ts=? WHERE device_id=?",
                         (pct / 100, int(time.time()), house["device_id"]))
            notify.send_sms(phone, f"Asante. Pazia {pct}% imehifadhiwa." if sw
                            else f"Thanks. Curtain {pct}% saved.")
        elif text.lower() in ("hali", "status"):
            adv = self.store.q("SELECT json FROM advice WHERE device_id=?",
                               (house["device_id"],), one=True)
            a = json.loads(adv["json"]) if adv else {}
            ppm = a.get("now_max_nh3")
            if ppm is None:
                msg = "Hakuna data bado." if sw else "No data yet."
            elif sw:
                msg = (f"{house['name']}: Amonia sasa {ppm:.0f}ppm, "
                       f"saa 6 zijazo hadi {a.get('status_quo_peak_nh3', ppm):.0f}ppm.")
            else:
                msg = (f"{house['name']}: Ammonia now {ppm:.0f}ppm, "
                       f"next 6 h up to {a.get('status_quo_peak_nh3', ppm):.0f}ppm.")
            notify.send_sms(phone, msg)
        else:
            notify.send_sms(phone, "Tuma: PAZIA 50 au HALI" if sw
                            else "Send: CURTAIN 50 or STATUS")
