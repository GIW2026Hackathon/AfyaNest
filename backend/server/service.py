"""All server behaviour, independent of the web framework.

FastAPI (server/main.py) is a thin layer over this class, which keeps the logic easy
to test and lets you swap or add interfaces (SMS, voice, a dashboard) later.

Every dashboard method takes the caller's `tenant_id` and resolves houses with
`store.house_for_tenant()`: a house that belongs to another customer is reported as
"not found", exactly like a house that does not exist.
"""
from __future__ import annotations

import json
import os
import re
import time

from airnest.config import NODE_NAMES, NODES, comfort_temp

from . import delivery, kenya
from .auth import Auth
from .osint import OutbreakWatch
from .pipeline import SLOT, Brain
from .schemas import HouseIn, HouseUpdate, IngestIn
from .security import Vault, hash_password, same, sha256, token
from .store import Store

MAX_CLOCK_SKEW = 7 * 86400
OFFLINE_AFTER_S = 40 * 60            # 4 missed uploads


class ServiceError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _load_json(path):
    try:
        return json.load(open(path))
    except Exception:
        return None


def mask_phone(p: str | None) -> str | None:
    if not p:
        return None
    return p[:5] + "•" * max(0, len(p) - 8) + p[-3:]


class AirNestService:
    def __init__(self, db: str | None, model_dir: str, admin_key: str = "",
                 vault: Vault | None = None, connect=None):
        """db: postgresql:// URL (production) or a SQLite path; None = from environment."""
        from .db import open_database
        self.store = Store(vault=vault, db=open_database(db, connect=connect))
        self.model_dir = model_dir
        self.brain = Brain(self.store, model_dir)
        self.auth = Auth(self.store)
        self.outbreaks = OutbreakWatch(self.store)
        self.support_phone = os.getenv("AFYANEST_SUPPORT_PHONE", "0700 000 000")
        from .synthetic import SyntheticFeed
        self.synthetic = SyntheticFeed(self)
        self.scenario_hold: dict[str, float] = {}     # test house -> until (feed paused)
        self.admin_key = admin_key

    # ------------------------------------------------------------- helpers
    def _house(self, tenant_id: str, device_id: str) -> dict:
        h = self.store.house_for_tenant(device_id, tenant_id)
        if not h:
            raise ServiceError(404, "Farm house not found.")
        return h

    def _advice(self, device_id):
        adv = self.store.q("SELECT json FROM advice WHERE device_id=?", (device_id,), one=True)
        return json.loads(adv["json"]) if adv else None

    def _escalation_view(self, device_id):
        e = self.store.escalation(device_id)
        if not e:
            return None
        return {"open": e["closed_ts"] is None, "calls": e["calls"], "opened_ts": e["opened_ts"],
                "backup": e["backup_ts"] is not None, "closed_by": e["closed_by"],
                "closed_ts": e["closed_ts"]}

    @staticmethod
    def _age(h, ts=None):
        ts = ts or time.time()
        return max(0.0, (ts - (h["placement_ts"] or ts)) / 86400)

    def _summary(self, h, full_contact=False):
        a = self._advice(h["device_id"]) or {}
        hb = self.store.q("SELECT seen FROM heartbeat WHERE device_id=?", (h["device_id"],), one=True)
        last = self.store.q("SELECT AVG(temp) t, AVG(rh) rh, MAX(nh3) nh3 FROM readings "
                            "WHERE device_id=? AND slot=(SELECT MAX(slot) FROM readings WHERE "
                            "device_id=?)", (h["device_id"], h["device_id"]), one=True)
        age = self._age(h)
        spark = self.store.q("SELECT slot, MAX(nh3) nh3, AVG(temp) temp FROM readings "
                             "WHERE device_id=? AND slot>=? GROUP BY slot ORDER BY slot",
                             (h["device_id"], int(time.time() // SLOT) - 144))
        return {"device_id": h["device_id"], "name": h["name"], "lang": h["lang"],
                "has_fan": bool(h["has_fan"]), "placement_ts": h["placement_ts"],
                "age_days": round(age, 1), "comfort": comfort_temp(age), "n_birds": h["n_birds"],
                "phone": h["phone"] if full_contact else mask_phone(h["phone"]),
                "tech_phone": h["tech_phone"] if full_contact else mask_phone(h["tech_phone"]),
                "lat": h["lat"] if full_contact else None, "lon": h["lon"] if full_contact else None,
                "t_mean": h["t_mean"], "source": h.get("source") or "synthetic",
                "sms_test": bool(h.get("sms_test")), "county": h.get("county"),
                "farmer_id": h.get("farmer_id"), "sandbox": bool(h.get("sandbox")),
                "has_heater": bool(h.get("has_heater")), "has_curtain": bool(h.get("has_curtain")),
                "auto": a.get("auto"), "escalation": self._escalation_view(h["device_id"]),
                "level": a.get("level", "ok" if a else None), "status": a.get("status"),
                "now_max_nh3": a.get("now_max_nh3"), "last_ts": a.get("ts"),
                "has_nh3": a.get("has_nh3", a.get("now_max_nh3") is not None) if a else None,
                "now_temp": last["t"] if last else None, "now_rh": last["rh"] if last else None,
                "online": bool(hb and time.time() - hb["seen"] < OFFLINE_AFTER_S),
                "last_seen": hb["seen"] if hb else None,
                "spark": [{"ts": r["slot"] * SLOT, "nh3": r["nh3"], "temp": r["temp"]}
                          for r in spark]}

    # ------------------------------------------------------------- platform admin (scripts)
    def provision_tenant(self, admin_key, org_name, email, name, password):
        """Create a customer + owner from a provisioning script (header X-Admin-Key)."""
        if not same(admin_key, self.admin_key):
            raise ServiceError(401, "bad admin key")
        existing = self.store.user_by_email(email)
        if existing:
            return {"tenant_id": existing["tenant_id"], "user_id": existing["id"], "existing": True}
        self.auth._check_pw(password, name, email)
        tid = self.store.create_tenant(org_name)
        uid = self.store.create_user(tid, email.strip().lower(), name,
                                     hash_password(password),
                                     "owner")
        self.store.audit("tenant.provisioned", tid, None, tid)
        return {"tenant_id": tid, "user_id": uid, "existing": False}

    def platform_overview(self, user):
        """Platform admins see customers and counts — never readings or phone numbers."""
        if not user["is_platform_admin"]:
            raise ServiceError(403, "Platform administrators only.")
        out = []
        for t in self.store.tenants():
            c = self.store.q("SELECT (SELECT COUNT(*) FROM houses WHERE tenant_id=?) h, "
                             "(SELECT COUNT(*) FROM users WHERE tenant_id=?) u", (t["id"], t["id"]),
                             one=True)
            out.append({"id": t["id"], "name": t["name"], "status": t["status"],
                        "houses": c["h"], "users": c["u"], "created_ts": t["created_ts"]})
        return out

    # ------------------------------------------------------------- houses (tenant scoped)
    def register_house(self, tenant_id: str, h: HouseIn, actor_id=None, ip=None) -> dict:
        existing = self.store.house(h.device_id)
        if existing:
            # device ids are global: never reveal or overwrite another tenant's house
            raise ServiceError(409, "That device ID is already registered.")
        key = h.device_key or token(24)
        county = kenya.normalise(h.county) or kenya.county_of(h.lat, h.lon)
        if h.county and not kenya.normalise(h.county):
            raise ServiceError(422, "Unknown county.")
        self.store.upsert_house(
            tenant_id, device_key=key, device_id=h.device_id, name=h.name, phone=h.phone,
            tech_phone=h.tech_phone, lang=h.lang, lat=h.lat, lon=h.lon, t_mean=h.t_mean,
            placement_ts=h.placement_ts or int(time.time()), has_fan=int(h.has_fan),
            n_birds=h.n_birds, last_curtain=None, last_curtain_ts=None, offline_alerted=0,
            source=h.source, sms_test=int(h.sms_test), county=county)
        self.store.audit("house.created", tenant_id, actor_id, h.device_id, ip=ip)
        return {"ok": True, "device_id": h.device_id,
                "device_key": key if not h.device_key else None}

    def update_house(self, tenant_id, device_id, patch: HouseUpdate, actor_id=None, ip=None):
        h = self._house(tenant_id, device_id)
        changes = patch.model_dump(exclude_unset=True)
        if "has_fan" in changes:
            changes["has_fan"] = int(changes["has_fan"])
        for flag in ("sms_test", "has_heater", "has_curtain"):
            if flag in changes:
                changes[flag] = int(changes[flag])
        if "county" in changes:
            if changes["county"] and not kenya.normalise(changes["county"]):
                raise ServiceError(422, "Unknown county.")
            changes["county"] = kenya.normalise(changes["county"])
        merged = {k: h[k] for k in ("device_id", "name", "phone", "tech_phone", "lang", "lat",
                                    "lon", "t_mean", "placement_ts", "has_fan", "n_birds",
                                    "last_curtain", "last_curtain_ts", "offline_alerted",
                                    "source", "sms_test", "county", "has_heater", "has_curtain")}
        merged.update(changes)
        if not merged.get("county"):
            merged["county"] = kenya.county_of(merged["lat"], merged["lon"])
        self.store.upsert_house(tenant_id, **merged)
        self.store.audit("house.updated", tenant_id, actor_id, device_id, ip=ip,
                         detail={"fields": sorted(changes)})
        return self._summary(self.store.house(device_id), full_contact=True)

    def rotate_device_key(self, tenant_id, device_id, actor_id=None, ip=None):
        self._house(tenant_id, device_id)
        key = token(24)
        self.store.q("UPDATE houses SET device_key_hash=? WHERE device_id=?", (sha256(key), device_id))
        self.store.audit("house.key_rotated", tenant_id, actor_id, device_id, ip=ip)
        return {"device_key": key}

    def delete_house(self, tenant_id, device_id, actor_id=None, ip=None):
        self._house(tenant_id, device_id)
        self.store.delete_house(device_id)
        self.store.audit("house.deleted", tenant_id, actor_id, device_id, ip=ip)

    def list_houses(self, tenant_id: str) -> list[dict]:
        hs = [self._summary(h) for h in self.store.houses_for_tenant(tenant_id)]
        return sorted(hs, key=lambda x: (x["name"] or "").lower())

    def house_detail(self, tenant_id, device_id, full_contact=False) -> dict:
        h = self._house(tenant_id, device_id)
        out = self._summary(h, full_contact)
        out["advice"] = self._advice(device_id)
        out["nodes"] = [{"id": i, "name": n, "x": x, "y": y} for i, (n, x, y) in enumerate(NODES)]
        return out

    def history(self, tenant_id: str, device_id: str, hours: int) -> dict:
        """Readings for charts, curtain/fan log for overlays, and the alert log."""
        h = self._house(tenant_id, device_id)
        hours = max(1, min(int(hours), 24 * 14))
        slot0 = int(time.time() // SLOT) - hours * 3600 // SLOT
        rows = self.store.readings_since(device_id, slot0)
        logs = self.store.house_log_since(device_id, slot0)
        alerts = self.store.q("SELECT ts, kind, level, message, delivered FROM alerts WHERE device_id=? "
                              "AND ts>=? ORDER BY ts DESC LIMIT 300", (device_id, slot0 * SLOT))
        return {"hours": hours, "nodes": NODE_NAMES, "comfort": comfort_temp(self._age(h)),
                "readings": [{"ts": r["slot"] * SLOT, "node": r["node"], "nh3": r["nh3"],
                              "temp": r["temp"], "rh": r["rh"], "co2": r["co2"]} for r in rows],
                "controls": [{"ts": r["slot"] * SLOT, "curtain": r["curtain"], "fan": r["fan"],
                              "heater": r["heater"]} for r in logs],
                "alerts": [dict(a) for a in alerts]}

    # ------------------------------------------------------------- gateway
    def _device_house(self, device_id, device_key):
        house = self.store.house(device_id)
        # constant work whether the house exists or not
        given = sha256(device_key or "")
        if not house or not same(given, house["device_key_hash"]):
            raise ServiceError(401, "bad device key")
        return house

    def ingest(self, body: IngestIn, device_key: str | None) -> dict:
        house = self._device_house(body.device_id, device_key)
        now = time.time()
        ts = body.ts if body.ts is not None and abs(body.ts - now) <= MAX_CLOCK_SKEW else now
        if house["offline_alerted"]:
            self.store.q("UPDATE houses SET offline_alerted=0 WHERE device_id=?", (body.device_id,))
        if (house.get("source") or "synthetic") == "synthetic":
            self._switch_to_live(house)
            house = self.store.house(body.device_id)
        reply, _ = self.brain.ingest(house, body.model_dump(), ts)
        return reply

    def _switch_to_live(self, house):
        """A real gateway has spoken: stop the synthetic feed and clear simulated history
        so charts and the AI start from real readings only."""
        did = house["device_id"]
        with self.store.db.tx():
            self.store.q("DELETE FROM readings WHERE device_id=? AND (flags & 256) <> 0", (did,))
            self.store.q("DELETE FROM house_log WHERE device_id=?", (did,))
            self.store.q("DELETE FROM advice WHERE device_id=?", (did,))
            self.store.q("DELETE FROM alerts WHERE device_id=? AND kind NOT LIKE 'outbreak:%'", (did,))
            self.store.q("UPDATE houses SET source='live' WHERE device_id=?", (did,))
        self.store.audit("house.went_live", house["tenant_id"], None, did)

    def status(self, device_id: str, device_key: str | None) -> dict:
        """Gateway (device key) asks for the latest advice."""
        self._device_house(device_id, device_key)
        rows = self.store.readings_since(device_id, int(time.time() // SLOT) - 72)
        return {"advice": self._advice(device_id), "readings": [dict(r) for r in rows]}

    # ------------------------------------------------------------- incoming SMS
    def incoming_sms(self, phone: str, text: str, tenant_id: str | None = None) -> str:
        """A farmer texts us. Commands (Kiswahili or English):
        HALI/STATUS, PAZIA 50/CURTAIN 50, MSAADA/HELP, SIMAMISHA/STOP, ANZA/START."""
        farmer = self.store.farmer_by_phone(phone, tenant_id)
        houses = self.store.houses_for_farmer(farmer["id"]) if farmer else []
        house = houses[0] if houses else self.store.house_by_phone(phone)
        if not farmer and not house:
            return "unknown"
        lang = (farmer or house)["lang"]
        sw = lang == "sw"
        cmd = re.sub(r"\s+", " ", (text or "").strip())[:160]
        self.store.add_outbox((farmer or house)["tenant_id"], phone, cmd, "sms", "inbound", "received",
                              farmer_id=(farmer or {}).get("id") or (house or {}).get("farmer_id"),
                              device_id=(house or {}).get("device_id"))
        low = cmd.lower()
        m = re.match(r"^(pazia|curtain)\s+(\d{1,3})\s*%?$", cmd, re.I)
        if m and house:
            pct = min(100, int(m.group(2)))
            self.store.q("UPDATE houses SET last_curtain=?, last_curtain_ts=? WHERE device_id=?",
                         (pct / 100, int(time.time()), house["device_id"]))
            msg = f"Asante. Pazia {pct}% imehifadhiwa." if sw else f"Thanks. Curtain {pct}% saved."
        elif low in ("sawa", "ok", "okay", "nimeona", "nimeshughulikia", "done") and house:
            esc = self.store.escalation(house["device_id"])
            if esc and not esc["closed_ts"]:
                self.store.close_escalation(house["device_id"], "farmer")
                msg = ("Asante. Tumeacha kupiga simu. Tutaendelea kuangalia banda lako." if sw
                       else "Thank you. We have stopped calling. We keep watching your house.")
            else:
                msg = "Asante. Banda lako linaangaliwa." if sw else "Thank you. Your house is being watched."
        elif low in ("hali", "status"):
            msg = self.farmer_status_text(farmer, house)
        elif low in ("simamisha", "stop", "acha") and farmer:
            self.set_farmer_status(farmer, "stopped", via="sms")
            msg = ("Hutapokea SMS tena. Tuma ANZA kuanza tena." if sw
                   else "You will not receive SMS any more. Send START to restart.")
        elif low in ("anza", "start") and farmer:
            self.set_farmer_status(farmer, "active", via="sms")
            msg = "Karibu tena! Utapokea SMS za tahadhari." if sw else "Welcome back! Alerts are on."
        elif low in ("msaada", "help"):
            msg = (f"Msaada: piga {self.support_phone}. Tuma HALI, SAWA, PAZIA 50, au SIMAMISHA." if sw
                   else f"Help: call {self.support_phone}. Send STATUS, OK, CURTAIN 50 or STOP.")
        else:
            msg = "Tuma: HALI, SAWA, PAZIA 50, MSAADA au SIMAMISHA" if sw else \
                "Send: STATUS, OK, CURTAIN 50, HELP or STOP"
        delivery.deliver(self.store, phone, msg, house=house, farmer=farmer, kind="reply")
        return msg

    # ------------------------------------------------------------- farmers
    def default_tenant(self):
        tid = os.getenv("AIRNEST_DEFAULT_TENANT")
        if tid and self.store.tenant(tid):
            return tid
        r = self.store.q("SELECT id FROM tenants WHERE id<>'legacy' ORDER BY created_ts LIMIT 1", one=True)
        return r["id"] if r else None

    def register_farmer(self, tenant_id, name, phone, lang="sw", county=None, n_birds=None,
                        age_weeks=0, via="console", sandbox=False, village=None, actor_id=None,
                        device_id=None, welcome=True, backup_phone=None, has_fan=False,
                        has_heater=False, has_curtain=False):
        """Staff register a farmer when the sensor box is sold/installed. Creates the farmer,
        their house (synthetic until the box sends its first reading) and the box key."""
        if not re.fullmatch(r"\+\d{9,15}", phone or ""):
            raise ServiceError(422, "Phone must be in international format, e.g. +254712345678.")
        if county and not kenya.normalise(county):
            raise ServiceError(422, "Unknown county.")
        if self.store.farmer_by_phone(phone, tenant_id):
            raise ServiceError(409, "A farmer with this phone number is already registered.")
        if device_id:
            device_id = device_id.strip().upper()
            if not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{2,31}", device_id):
                raise ServiceError(422, "Sensor box ID: 3-32 letters, digits, dot, dash or underscore.")
            if self.store.house(device_id):
                raise ServiceError(409, "This sensor box is already assigned.")
        county = kenya.normalise(county) if county else None
        fid = self.store.create_farmer(tenant_id, name.strip()[:60], phone, lang, county, village,
                                       n_birds, via, sandbox)
        did = device_id or new_device_id()
        while not device_id and self.store.house(did):
            did = new_device_id()
        key = token(24)
        self.store.upsert_house(
            tenant_id, device_key=key, device_id=did,
            name=("Banda la " if lang == "sw" else "") + name.split()[0] + ("" if lang == "sw" else "'s house"),
            phone=phone, tech_phone=backup_phone, lang=lang, lat=None, lon=None, t_mean=17.0,
            placement_ts=int(time.time() - (age_weeks or 0) * 7 * 86400), has_fan=int(has_fan),
            has_heater=int(has_heater), has_curtain=int(has_curtain),
            n_birds=n_birds, last_curtain=None, last_curtain_ts=None, offline_alerted=0,
            source="synthetic", sms_test=0, county=county, farmer_id=fid, sandbox=int(sandbox))
        self.store.audit("farmer.registered", tenant_id, actor_id, fid,
                         detail={"via": via, "sandbox": bool(sandbox), "device": did})
        if welcome:
            first = name.split()[0]
            msg = (f"AfyaNest: Karibu {first}! Sensa yako ({did}) italinda banda lako. Tutakutumia SMS "
                   f"au kukupigia simu kukiwa na hatari. Tuma HALI kujua hali, SIMAMISHA kuacha."
                   if lang == "sw" else
                   f"AfyaNest: Welcome {first}! Your sensor ({did}) watches your poultry house. We will "
                   f"SMS or call you when something needs attention. Send STATUS anytime, STOP to opt out.")
            delivery.deliver(self.store, phone, msg, house=self.store.house(did),
                             farmer=self.store.farmer(fid, tenant_id), kind="welcome", mode="live")
        return {"farmer_id": fid, "device_id": did, "device_key": key}

    def set_farmer_status(self, farmer, status, via="console", actor_id=None):
        self.store.q("UPDATE farmers SET status=? WHERE id=?", (status, farmer["id"]))
        self.store.audit("farmer.sms_" + ("stopped" if status == "stopped" else "started"),
                         farmer["tenant_id"], actor_id, farmer["id"], detail={"via": via})

    def set_farmer_lang(self, farmer, lang):
        self.store.q("UPDATE farmers SET lang=? WHERE id=?", (lang, farmer["id"]))
        self.store.q("UPDATE houses SET lang=? WHERE farmer_id=?", (lang, farmer["id"]))

    def farmer_status_text(self, farmer=None, house=None):
        house = house or (self.store.houses_for_farmer(farmer["id"]) or [None])[0]
        lang = (farmer or house or {}).get("lang", "sw")
        sw = lang == "sw"
        if not house:
            return "Bado hatujaweka sensa." if sw else "No sensor installed yet."
        s = self._summary(house)
        a = self._advice(house["device_id"]) or {}
        if s["now_temp"] is None:
            return "Hakuna data bado." if sw else "No data yet."
        lvl = {"ok": ("SALAMA", "OK"), "watch": ("TAHADHARI", "WATCH"), "warn": ("ONYO", "WARNING"),
               "danger": ("HATARI", "DANGER")}.get(s["level"] or "ok", ("SALAMA", "OK"))
        parts = [f"{house['name']}: " + (f"Joto {s['now_temp']:.0f}C, unyevu {s['now_rh']:.0f}%"
                                         if sw else f"Temp {s['now_temp']:.0f}C, humidity {s['now_rh']:.0f}%")]
        if s["now_max_nh3"] is not None:
            parts.append((f"amonia {s['now_max_nh3']:.0f}ppm") if sw else f"ammonia {s['now_max_nh3']:.0f}ppm")
        txt = ", ".join(parts) + (f". Hali: {lvl[0]}." if sw else f". Status: {lvl[1]}.")
        check = a.get("next_check") or {}
        if check.get("local"):
            txt += f" Angalia banda saa {check['local']}." if sw else f" Check the house at {check['local']}."
        return txt

    def farmer_report(self, farmer, kind):
        houses = self.store.houses_for_farmer(farmer["id"])
        label = {"birds_dying": "Farmer reports birds dying", "device_fault": "Farmer reports device not working",
                 "sick_birds": "Farmer reports sick birds", "other": "Farmer asked for a call"}[kind]
        level = "danger" if kind == "birds_dying" else "warn"
        for h in houses[:1]:
            self.store.add_alert(h["device_id"], int(time.time()), "report:" + kind, level, label,
                                 delivered=False)
        self.store.audit("farmer.report", farmer["tenant_id"], None, farmer["id"], detail={"kind": kind})

    def _farmer_view(self, f, with_houses=True):
        out = {"id": f["id"], "name": f["name"], "phone": f["phone"], "lang": f["lang"],
               "county": f["county"], "n_birds": f["n_birds"], "registered_via": f["registered_via"],
               "sandbox": bool(f["sandbox"]), "status": f["status"], "created_ts": f["created_ts"]}
        if with_houses:
            out["houses"] = [self._summary(h) for h in self.store.houses_for_farmer(f["id"])]
            lv = [h["level"] for h in out["houses"] if h["level"]]
            out["level"] = max(lv, key=lambda x: {"ok": 0, "watch": 1, "warn": 2, "danger": 3}[x], default=None)
        return out

    def list_farmers(self, tenant_id):
        return [self._farmer_view(f) for f in self.store.farmers_for_tenant(tenant_id)]

    def farmer_detail(self, tenant_id, fid):
        f = self.store.farmer(fid, tenant_id)
        if not f:
            raise ServiceError(404, "Farmer not found.")
        out = self._farmer_view(f)
        out["messages"] = [m for m in self.store.outbox(tenant_id, f["phone"], 50)]
        return out

    def update_farmer(self, tenant_id, fid, patch: dict, actor_id=None):
        f = self.store.farmer(fid, tenant_id)
        if not f:
            raise ServiceError(404, "Farmer not found.")
        if "lang" in patch and patch["lang"]:
            self.set_farmer_lang(f, patch["lang"])
        if "status" in patch and patch["status"]:
            self.set_farmer_status(f, patch["status"], actor_id=actor_id)
        if "county" in patch and patch["county"] is not None:
            c = kenya.normalise(patch["county"])
            if not c:
                raise ServiceError(422, "Unknown county.")
            self.store.q("UPDATE farmers SET county=? WHERE id=?", (c, fid))
            self.store.q("UPDATE houses SET county=? WHERE farmer_id=?", (c, fid))
        if patch.get("name"):
            self.store.q("UPDATE farmers SET name_enc=? WHERE id=?",
                         (self.store.vault.enc(patch["name"].strip()[:60], fid), fid))
        if patch.get("n_birds"):
            self.store.q("UPDATE farmers SET n_birds=? WHERE id=?", (int(patch["n_birds"]), fid))
        self.store.audit("farmer.updated", tenant_id, actor_id, fid, detail={"fields": sorted(patch)})
        return self.farmer_detail(tenant_id, fid)

    def delete_farmer(self, tenant_id, fid, actor_id=None):
        f = self.store.farmer(fid, tenant_id)
        if not f:
            raise ServiceError(404, "Farmer not found.")
        for h in self.store.houses_for_farmer(fid):
            self.store.delete_house(h["device_id"])
        self.store.q("DELETE FROM sms_outbox WHERE farmer_id=?", (fid,))
        self.store.q("DELETE FROM farmers WHERE id=?", (fid,))
        self.store.audit("farmer.deleted", tenant_id, actor_id, fid)

    # ------------------------------------------------------------- overview (operator console)
    def overview(self, tenant_id):
        now = int(time.time())
        farmers = self.store.farmers_for_tenant(tenant_id)
        names = {f["id"]: f["name"] for f in farmers}
        houses = [self._summary(h) | {"farmer_id": h.get("farmer_id")}
                  for h in self.store.houses_for_tenant(tenant_id)]
        levels = {k: sum(1 for h in houses if h["level"] == k) for k in ("ok", "watch", "warn", "danger")}
        msgs = self.store.q("SELECT status, channel, COUNT(*) n FROM sms_outbox WHERE tenant_id=? "
                            "AND ts>=? GROUP BY status, channel", (tenant_id, now - 86400))
        dev = [h["device_id"] for h in houses]
        recent = []
        if dev:
            marks = ",".join("?" * len(dev))
            recent = self.store.q(f"SELECT device_id, ts, kind, level, message, delivered FROM alerts "
                                  f"WHERE device_id IN ({marks}) AND ts>=? ORDER BY ts DESC LIMIT 15",
                                  (*dev, now - 2 * 86400))
        by_dev = {h["device_id"]: h for h in houses}
        attention = sorted([h for h in houses if h["level"] in ("warn", "danger")],
                           key=lambda h: (h["level"] != "danger", -(h["now_max_nh3"] or 0)))
        counties = {}
        for f in farmers:
            if f["county"]:
                counties[f["county"]] = counties.get(f["county"], 0) + 1
        return {
            "farmers": {"total": len(farmers), "active": sum(f["status"] == "active" for f in farmers),
                        "stopped": sum(f["status"] == "stopped" for f in farmers),
                        "sandbox": sum(bool(f["sandbox"]) for f in farmers),
                        "new_7d": sum(f["created_ts"] >= now - 7 * 86400 for f in farmers)},
            "houses": {"total": len(houses), "live": sum(h["source"] == "live" for h in houses),
                       "synthetic": sum(h["source"] == "synthetic" for h in houses),
                       "online": sum(h["online"] for h in houses), "levels": levels},
            "messages_24h": [dict(m) for m in msgs],
            "attention": [{"device_id": h["device_id"], "name": h["name"], "level": h["level"],
                           "farmer": names.get(h["farmer_id"]), "farmer_id": h["farmer_id"],
                           "now_temp": h["now_temp"], "now_rh": h["now_rh"], "now_max_nh3": h["now_max_nh3"],
                           "comfort": h["comfort"], "source": h["source"]} for h in attention[:12]],
            "recent_alerts": [dict(r) | {"house": by_dev.get(r["device_id"], {}).get("name"),
                                         "farmer_id": by_dev.get(r["device_id"], {}).get("farmer_id")}
                              for r in recent],
            "counties": counties,
        }

    # ------------------------------------------------------------- sandbox (operators only)
    def sandbox_scenario(self, tenant_id, device_id, kind):
        """Push a crafted reading through the real pipeline so the alert chain can be seen on
        the simulated phone. Only allowed for sandbox farmers' houses."""
        h = self._house(tenant_id, device_id)
        if not h.get("sandbox"):
            raise ServiceError(403, "Scenarios are only for Sandbox farmers.")
        lo, hi = comfort_temp(self._age(h))
        mid = (lo + hi) / 2
        temp, rh, nh3 = {"cold": (lo - 8, 72, 6), "heat": (hi + 8, 82, 8),
                         "ammonia": (mid, 78, 34), "normal": (mid, 62, 6)}[kind]
        nodes = [{"node": n, "temp_c": round(temp + (n - 2) * 0.3, 1), "rh_pct": rh, "nh3_ppm": nh3 + n * 0.4}
                 for n in range(6)]
        # make the scenario visible even if a similar alert went out a moment ago
        self.store.q("DELETE FROM alerts WHERE device_id=? AND ts>=?", (device_id, int(time.time()) - 6 * 3600))
        reply, result = self.brain.ingest(h, {"device_id": device_id, "nodes": nodes}, time.time(),
                                          mode="synthetic")
        # keep the test situation for a while (simulated feed paused) so the follow-up calls
        # and the backup contact can be seen; "normal" ends it
        if kind == "normal":
            self.scenario_hold.pop(device_id, None)
        else:
            self.scenario_hold[device_id] = time.time() + SCENARIO_HOLD_S
        return {"reply": reply, "level": result.get("level"), "hold_s": 0 if kind == "normal" else SCENARIO_HOLD_S}

    def sandbox_inbox(self, tenant_id, phone):
        return self.store.outbox(tenant_id, phone, 60)

    def voice_message(self, phone):
        """Text for an answered voice call (Africa's Talking voice callback)."""
        rows = [m for m in self.store.outbox(None, phone, 10)
                if m["channel"] == "voice" and m["ts"] >= time.time() - 900]
        return rows[0]["text"] if rows else None

    # ------------------------------------------------------------- outbreak watch (model 1)
    def outbreak_list(self, tenant_id):
        return {"status": self.outbreaks.status(), "signals": self.outbreaks.for_tenant(tenant_id)}

    def outbreak_decide(self, tenant_id, signal_id, approve: bool, actor_id, ip=None):
        row = self.store.q("SELECT status FROM outbreak_alerts WHERE tenant_id=? AND signal_id=?",
                           (tenant_id, signal_id), one=True)
        if not row:
            raise ServiceError(404, "Outbreak not found.")
        if approve:
            n = self.outbreaks.send(tenant_id, signal_id, actor=actor_id, status="sent")
            self.store.audit("outbreak.sms_sent", tenant_id, actor_id, signal_id, ip=ip,
                             detail={"farmers": n})
            return {"ok": True, "sent": n}
        self.store.q("UPDATE outbreak_alerts SET status='dismissed', decided_by=?, ts=? "
                     "WHERE tenant_id=? AND signal_id=?", (actor_id, int(time.time()), tenant_id, signal_id))
        self.store.audit("outbreak.dismissed", tenant_id, actor_id, signal_id, ip=ip)
        return {"ok": True, "sent": 0}

    # ------------------------------------------------------------- the three models
    def models_status(self, tenant_id):
        from .osint import AUTO_SEND_CONFIDENCE
        houses = self.store.houses_for_tenant(tenant_id)
        synth = sum(1 for h in houses if (h.get("source") or "synthetic") == "synthetic")
        return {
            "outbreak_watch": {**self.outbreaks.status(), "auto_send_confidence": AUTO_SEND_CONFIDENCE},
            "detection": {"model": self.brain.detector_name,
                          "checks": ["ammonia limits", "cold / heat for bird age",
                                     "sensor faults vs farm events"]},
            "prediction": {"model": self.brain.model_name, "horizon_h": 6,
                           "metrics": _load_json(os.path.join(self.model_dir, "gbm_test.json"))},
            "data": {"houses": len(houses), "synthetic": synth, "live": len(houses) - synth},
        }

    # ------------------------------------------------------------- watchdog
    CALL_EVERY_S = 10 * 60          # ring again while danger lasts and nobody answered
    MAX_CALLS = 3                   # calls to the farmer before we stop ringing
    BACKUP_AFTER_CALLS = 2          # then the backup contact is told
    GIVE_UP_S = 3 * 3600

    def escalate(self, now: float | None = None) -> int:
        """Follow up every open danger: call again, tell the backup contact, say all-clear."""
        now = now or time.time()
        acted = 0
        for e in self.store.open_escalations():
            h = self.store.house(e["device_id"])
            if not h:
                self.store.close_escalation(e["device_id"], "deleted", now)
                continue
            a = self._advice(h["device_id"]) or {}
            lvl = a.get("level") or "ok"
            sw = h["lang"] == "sw"
            if lvl in ("ok", "watch"):
                msg = (f"AfyaNest {h['name']}: Hali sasa ni salama. Asante." if sw
                       else f"AfyaNest {h['name']}: Conditions are safe again. Thank you.")
                delivery.deliver(self.store, h["phone"], msg, house=h, kind="clear")
                self.store.close_escalation(h["device_id"], "resolved", now)
                acted += 1
                continue
            if now - e["opened_ts"] > self.GIVE_UP_S:
                self.store.close_escalation(h["device_id"], "expired", now)
                continue
            if e["calls"] < self.MAX_CALLS and now - (e["last_call_ts"] or 0) >= self.CALL_EVERY_S:
                text = ("Hii ni AfyaNest tena. Hatari bado iko bandani. " if sw
                        else "This is AfyaNest again. The danger is still in your house. ") + \
                    (e["text"].split(": ", 1)[1] if ": " in e["text"] else e["text"]) + \
                    (" Tuma SAWA ukishashughulikia." if sw else " Send OK when you have dealt with it.")
                delivery.deliver(self.store, h["phone"], text, house=h, channel="voice",
                                 kind="escalation")
                self.store.q("UPDATE escalations SET calls=calls+1, last_call_ts=? WHERE device_id=?",
                             (int(now), h["device_id"]))
                acted += 1
                e["calls"] += 1
            if (e["calls"] >= self.BACKUP_AFTER_CALLS and e["backup_ts"] is None
                    and h.get("tech_phone") and h["tech_phone"] != h["phone"]):
                msg = (f"AfyaNest: Hatari katika {h['name']} ({h['county'] or ''}) na mkulima hajajibu. "
                       f"Tafadhali msaidie sasa. {e['text']}" if sw else
                       f"AfyaNest: Danger at {h['name']} ({h['county'] or ''}) and the farmer has not "
                       f"answered. Please help now. {e['text']}")
                delivery.deliver(self.store, h["tech_phone"], msg, house=h, kind="escalation")
                delivery.deliver(self.store, h["tech_phone"], msg, house=h, channel="voice",
                                 kind="escalation")
                self.store.q("UPDATE escalations SET backup_ts=? WHERE device_id=?",
                             (int(now), h["device_id"]))
                acted += 1
        return acted

    def check_offline(self) -> None:
        """Tell the farmer once when a gateway has gone quiet (power, airtime, SIM)."""
        now = time.time()
        for r in self.store.q("SELECT h.device_id, hb.seen FROM houses h JOIN heartbeat hb "
                              "ON hb.device_id=h.device_id WHERE COALESCE(h.offline_alerted,0)=0 "
                              "AND hb.seen<?", (now - OFFLINE_AFTER_S,)):
            h = self.store.house(r["device_id"])
            if (h.get("source") or "synthetic") == "synthetic":
                continue
            mins = int((now - r["seen"]) // 60)
            msg = (f"AfyaNest {h['name']}: Kifaa hakijatuma data kwa dakika {mins}. Angalia "
                   "umeme, salio la SIM na antena." if h["lang"] == "sw" else
                   f"AfyaNest {h['name']}: No data from the gateway for {mins} min. Check power, "
                   "SIM airtime and antenna.")
            to = h["tech_phone"] or h["phone"]
            st = delivery.deliver(self.store, to, msg, house=h, kind="offline")
            self.store.add_alert(h["device_id"], int(now), "offline", "warn", msg,
                                 delivered=st in delivery.DELIVERED)
            self.store.q("UPDATE houses SET offline_alerted=1 WHERE device_id=?", (h["device_id"],))


SCENARIO_HOLD_S = 25 * 60


def new_device_id() -> str:
    """Sensor box ID when staff do not type the serial printed on the box."""
    import secrets
    return "AN-" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
