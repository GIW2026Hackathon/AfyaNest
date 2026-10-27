"""What happens every time a gateway uploads (every 10 minutes per house):

 1. store readings
 2. rebuild the last 12 h on a clean 10-minute grid (gaps filled)
 3. anomaly detection -> sensor faults (to technician) / farm events (to farmer)
 4. 6-hour forecast + best ventilation plan (model-predictive control)
 5. SMS alert if needed (rate-limited, escalates immediately)
 6. reply to the gateway: fan on/off, buzzer
"""
from __future__ import annotations

import json
import math
import os
import threading
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

from airnest.anomaly import GDNDetector, StatDetector, diagnose
from airnest.config import (CURTAIN, F_NODE, FAN, G_FEATS, H_FUT, HEATER, L_HIST,
                            N_NODES, NH3, NH3_DANGER, NH3_WARN, STEP_MIN, TEMP,
                            comfort_temp)
from airnest.controller import advise, climate_risks
from airnest.dataset import Scaler
from airnest.forecasters import load_forecaster
from airnest.simulator import ADJ

from . import autopilot, delivery, messages, weather

EAT = timezone(timedelta(hours=3))
SLOT = STEP_MIN * 60
MIN_HISTORY = 18                     # 3 h of data before the AI starts advising
NO_NH3_FILL = 3.0                    # houses without an ammonia sensor: neutral clean-air value
REPEAT_S = {"watch": 6 * 3600, "warn": 3 * 3600, "danger": 2 * 3600}  # avoid SMS fatigue
RANK = {"ok": 0, "watch": 1, "warn": 2, "danger": 3}
SYNTHETIC_FLAG = 256


class _NoopPlan:                       # "no ventilation change" for warm-up messages
    name, meta = "usual", {}


_NOOP_PLAN = _NoopPlan()


class Brain:
    def __init__(self, store, model_dir):
        self.store = store
        self._ctx = threading.local()            # per-call data mode (live/synthetic/backfill)
        self.forecaster, self.model_name = load_forecaster(model_dir)
        scaler = Scaler.from_json(os.path.join(model_dir, "scaler.json"))
        gdn = os.path.join(model_dir, "gdn.onnx")
        if os.path.exists(gdn):
            self.detector = GDNDetector(gdn, scaler, os.path.join(model_dir, "gdn_stats.json"))
            self.detector_name = "gdn"
        else:
            self.detector, self.detector_name = StatDetector(), "robust_stats"

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def usual_curtain(hour, age):
        """Default farmer behaviour until we have learned this farm's own habit."""
        night = hour >= 19 or hour < 7
        if night:
            return 0.05 if age < 21 else 0.1
        return 0.5 if age < 14 else 0.7

    def _clock(self, ts):
        dt = datetime.fromtimestamp(ts, EAT)
        h = dt.hour + dt.minute / 60
        return h, math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24)

    def _grid(self, house, slot_now):
        """Last L_HIST slots as [L,N,F] (gap-filled) + house log."""
        slot0 = slot_now - L_HIST + 1
        x = np.full((L_HIST, N_NODES, F_NODE), np.nan)
        for r in self.store.readings_since(house["device_id"], slot0):
            i = r["slot"] - slot0
            if 0 <= i < L_HIST and 0 <= r["node"] < N_NODES:
                x[i, r["node"]] = [r["nh3"], r["temp"], r["rh"], r["co2"]]
        measured = (~np.isnan(x)).any(0)                       # [N,F] channels really present
        have = (~np.isnan(x[..., NH3])).any(1) | (~np.isnan(x[..., TEMP])).any(1)
        n_have = int(have.sum())
        has_nh3 = bool(measured[:, NH3].any())
        if not has_nh3:
            # temperature/humidity-only box (e.g. DHT11): run climate advice, no ammonia
            x[..., NH3] = NO_NH3_FILL
        # CO2 is optional hardware: copy the house mean, else a typical value
        co2 = x[..., 3]
        if np.isnan(co2).all():
            x[..., 3] = 1500.0
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                house_co2 = np.nanmean(co2, axis=1, keepdims=True)
            x[..., 3] = np.where(np.isnan(co2), house_co2, co2)
        # forward fill then backward fill along time; leftover -> house mean
        for f in range(F_NODE):
            for n in range(N_NODES):
                v = x[:, n, f]
                idx = np.where(~np.isnan(v), np.arange(L_HIST), 0)
                np.maximum.accumulate(idx, out=idx)
                v = v[idx]
                if np.isnan(v).any():
                    first = np.argmax(~np.isnan(v)) if (~np.isnan(v)).any() else None
                    v[:first] = v[first] if first is not None else np.nan
                x[:, n, f] = v
            col = x[..., f]
            if np.isnan(col).any():
                fill = np.nanmean(col) if not np.isnan(col).all() else [0, 25, 70, 1500][f]
                x[..., f] = np.where(np.isnan(col), fill, col)
        logs = {r["slot"]: r for r in self.store.house_log_since(house["device_id"], slot0 - 144 * 7)}
        return x, n_have, logs, has_nh3, measured

    def _globals(self, house, slots, logs, x=None, future=False):
        ts_list = [s * SLOT for s in slots]
        wx = weather.outside(house["lat"], house["lon"], ts_list, house["t_mean"] or 17)
        g = np.zeros((len(slots), G_FEATS), np.float32)
        for i, (s, ts) in enumerate(zip(slots, ts_list)):
            h, hs, hc = self._clock(ts)
            age = max(0.0, (ts - (house["placement_ts"] or ts)) / 86400)
            row = logs.get(s)
            # learned habit: median curtain at this time of day over the last week
            past = [logs[s - 144 * k]["curtain"] for k in range(1, 8)
                    if s - 144 * k in logs and logs[s - 144 * k]["curtain"] is not None]
            usual = float(np.median(past)) if len(past) >= 3 else self.usual_curtain(h, age)
            curtain = row["curtain"] if (row and row["curtain"] is not None and not future) \
                else usual
            fan = row["fan"] if (row and not future and row["fan"] is not None) else 0.0
            if future:
                prev = logs.get(s - 144)
                heater = prev["heater"] if prev and prev["heater"] is not None else float(age < 14)
            else:
                heater = row["heater"] if row and row["heater"] is not None else float(age < 14)
            g[i] = [wx[i][0], wx[i][1], hs, hc, age, curtain, fan, heater]
        return g

    def _autopilot(self, house, level, now_ppm, x, age, climate, plan_curtain, current_curtain, ts):
        """Decide what the box switches by itself and remember the curtain it was told."""
        zones = [0] if age < 10 else [0, 1, 2, 3]
        t = x[-1, zones, TEMP]
        temp_now = float(np.nanmean(t)) if not np.isnan(t).all() else None
        auto = autopilot.decide(house, level, now_ppm, temp_now, comfort_temp(age), climate,
                                plan_curtain, current_curtain)
        self._ctx.auto = auto
        c = auto["cmd"]["curtain"]
        if c is not None and getattr(self._ctx, "mode", "live") == "live":
            self.store.q("UPDATE houses SET last_curtain=?, last_curtain_ts=? WHERE device_id=?",
                         (c / 100, int(ts), house["device_id"]))
        return auto

    def _alert(self, house, ts, kind, level, text, to=None, repeat_s=None):
        last = self.store.last_alert(house["device_id"], kind)
        if last:
            escalated = RANK.get(level, 0) > RANK.get(last["level"], 0)
            gap = repeat_s or REPEAT_S.get(level, 6 * 3600)
            if not escalated and ts - last["ts"] < gap:
                return False
        to = to or house["phone"]
        mode = getattr(self._ctx, "mode", "live")
        if kind.split(":")[0] in ("ammonia", "climate"):
            text += autopilot.done_text(getattr(self._ctx, "auto", None), house["lang"])
        status = delivery.deliver(self.store, to, text, house=house, kind=kind.split(":")[0],
                                  mode=mode)
        # danger also rings the farmer's phone (voice), so a missed SMS is not a missed warning
        if level == "danger" and delivery.voice_enabled() and status in delivery.DELIVERED \
                and not kind.startswith("fault"):
            delivery.deliver(self.store, to, messages.voice_text(text, house["lang"]), house=house,
                             channel="voice", kind=kind.split(":")[0], mode=mode)
        self.store.add_alert(house["device_id"], ts, kind, level, text,
                             delivered=status in delivery.DELIVERED)
        # danger is followed up until someone answers or the house is safe again (escalate)
        if level == "danger" and status in delivery.DELIVERED and kind.split(":")[0] in (
                "ammonia", "climate"):
            self.store.open_escalation(house["device_id"], kind, level, text, ts)
        return True

    # ------------------------------------------------------------------ main
    def ingest(self, house, payload, ts, mode="live"):
        self._ctx.mode = mode
        try:
            return self._ingest(house, payload, ts)
        finally:
            self._ctx.mode = "live"
            self._ctx.auto = None

    def _ingest(self, house, payload, ts):
        did = house["device_id"]
        slot = int(ts // SLOT)
        mode = getattr(self._ctx, "mode", "live")
        nodes = payload.get("nodes", [])
        if mode != "live":                              # mark simulated readings (flags bit 8)
            nodes = [dict(n, flags=(n.get("flags") or 0) | SYNTHETIC_FLAG) for n in nodes]
        self.store.add_readings(did, slot, nodes)
        curtain = payload.get("curtain")
        if curtain is None and house["last_curtain_ts"] and ts - house["last_curtain_ts"] < 4 * 3600:
            curtain = house["last_curtain"]          # farmer told us by SMS recently
        x, n_have, logs, has_nh3, measured = self._grid(house, slot)
        # heater inferred from brooder vs centre temperature
        heater = float(x[-1, 0, TEMP] - x[-1, 3, TEMP] > 3.0)
        self.store.log_house(did, slot, curtain, float(payload.get("fan", 0)), heater)
        logs[slot] = {"curtain": curtain, "fan": float(payload.get("fan", 0)), "heater": heater}

        now_ppm = float(np.nanmax(x[-1, :, NH3])) if has_nh3 else 0.0
        reply = {"fan": 0, "buzzer": int(has_nh3 and now_ppm >= NH3_DANGER), "level": "ok"}
        result = {"ts": ts, "now_max_nh3": now_ppm if has_nh3 else None, "has_nh3": has_nh3,
                  "model": self.model_name, "detector": self.detector_name, "findings": [],
                  "sensors": int(measured[:, TEMP].sum())}

        if n_have < MIN_HISTORY:                       # warming up: thresholds only
            lvl = ("danger" if now_ppm >= NH3_DANGER else "warn" if now_ppm >= NH3_WARN
                   else "ok") if has_nh3 else "ok"
            # safety rules for cold/heat work from the very first reading
            age = max(0.0, (ts - (house["placement_ts"] or ts)) / 86400)
            risks = climate_risks(x[-1, :, TEMP], np.tile(x[-1, :, TEMP], (2, 1)),
                                  x[-1, :, 2], age, measured[:, TEMP])
            for risk in risks:
                if RANK[risk["level"]] > RANK[lvl]:
                    lvl = risk["level"]
            auto = self._autopilot(house, lvl, now_ppm if has_nh3 else None, x, age, risks,
                                   None, curtain, ts)
            for risk in risks:
                self._alert(house, ts, f"climate:{risk['kind']}", risk["level"],
                            messages.climate_sms(house["name"], risk, _NOOP_PLAN,
                                                 curtain or 0.0, house["lang"]),
                            repeat_s=3 * 3600)
            result["climate"] = risks
            reply["level"] = lvl
            reply.update(auto["cmd"])
            result["auto"] = auto
            # FIX: store the level so the dashboard doesn't show "ok" during warm-up
            result["level"] = lvl
            if has_nh3 and now_ppm >= NH3_WARN:
                self._alert(house, ts, "ammonia", lvl,
                            f"AfyaNest {house['name']}: Amonia {now_ppm:.0f}ppm. Fungua pazia."
                            if house["lang"] == "sw" else
                            f"AfyaNest {house['name']}: Ammonia {now_ppm:.0f}ppm. Open curtains.")
            result["status"] = "warming_up"
            result["detection"] = _detection(lvl, now_ppm if has_nh3 else None, risks, [])
            result["data_mode"] = getattr(self._ctx, "mode", "live")
            self._ctx.auto = None
            self.store.set_advice(did, ts, json.dumps(result, default=float))
            return reply, result

        slots_h = list(range(slot - L_HIST + 1, slot + 1))
        slots_f = list(range(slot + 1, slot + 1 + H_FUT))
        gh = self._globals(house, slots_h, logs)
        gf = self._globals(house, slots_f, logs, future=True)

        # ---- anomalies ----
        scores, stuck = self.detector.scores(x, gh, gf[0])
        # only judge sensors that are really fitted (no CO2 / NH3 board = no "fault")
        scores = np.where(measured, scores, 0.0)
        stuck = stuck & measured
        findings = diagnose(scores, stuck, x, gh)
        result["findings"] = findings
        for f in findings:
            if f["kind"] == "fault":
                n = [z for z in messages.ZONES["en"]].index(f["node"])
                c = ["nh3_ppm", "temp_c", "rh_pct", "co2_ppm"].index(f["channel"])
                # don't let a broken sensor drive the forecast: use its neighbours
                x[-18:, n, c] = ADJ[n] @ x[-18:, :, c].T
                self._alert(house, ts, f"fault:{f['node']}:{f['channel']}", "warn",
                            messages.finding_sms(house["name"], f, house["lang"]),
                            to=house["tech_phone"] or house["phone"])
            else:
                self._alert(house, ts, f"event:{f['type']}", "warn",
                            messages.finding_sms(house["name"], f, house["lang"]))

        # ---- forecast + control ----
        age = float(gh[-1, 4])
        adv = advise(self.forecaster, x, gh, gf, age, bool(house["has_fan"]),
                     measured_temp=measured[:, TEMP])
        nh3_level = adv.level if has_nh3 else "ok"
        check = next_check_in(adv.forecast, ts, comfort_temp(age), has_nh3)
        result["next_check"] = check
        reply["level"] = nh3_level
        reply["fan"] = int(bool(house["has_fan"]) and adv.best.fan[0] > 0.5)
        reply["buzzer"] = int(nh3_level == "danger")
        result.update(level=nh3_level, status_quo_peak_nh3=adv.status_quo_peak_nh3,
                      status_quo_peak_p90=adv.status_quo_peak_p90,
                      hours_to_warn=adv.hours_to_warn, worst_node=adv.worst_node,
                      plan=adv.best.name, plan_peak_nh3=adv.best_peak_nh3,
                      plan_min_temp=adv.best_min_temp,
                      plan_curtain=adv.best.curtain.round(2).tolist()[::6],
                      plan_fan=adv.best.fan.tolist()[::6], forecast=adv.forecast,
                      action_en=messages.action_text(adv.best, float(gh[-1, CURTAIN]), "en"),
                      action_sw=messages.action_text(adv.best, float(gh[-1, CURTAIN]), "sw"),
                      current_curtain=float(gh[-1, CURTAIN]))
        lvl_all = nh3_level
        for risk in adv.climate:
            if RANK[risk["level"]] > RANK[lvl_all]:
                lvl_all = risk["level"]
        auto = self._autopilot(house, lvl_all, now_ppm if has_nh3 else None, x, age, adv.climate,
                               float(adv.best.curtain[0]), float(gh[-1, CURTAIN]), ts)
        reply.update({k: v for k, v in auto["cmd"].items() if k not in ("buzzer",)})
        reply["fan"] = int(auto["cmd"]["fan"] or (bool(house["has_fan"]) and adv.best.fan[0] > 0.5
                                                  and "cold" not in auto["reasons"]))
        result["auto"] = auto
        should_text = has_nh3 and (adv.level in ("warn", "danger") or (
            adv.level == "watch" and adv.hours_to_warn is not None))
        if should_text:
            text = messages.advice_sms(house["name"], adv, now_ppm, float(gh[-1, CURTAIN]),
                                       comfort_temp(age)[0], house["lang"])
            text += messages.check_in_text(check, house["lang"])
            result["sms_sent"] = self._alert(house, ts, "ammonia", adv.level, text)

        # ---- climate: cold chicks / heat stress ----
        result["climate"] = adv.climate
        for risk in adv.climate:
            text = messages.climate_sms(house["name"], risk, adv.best,
                                        float(gh[-1, CURTAIN]), house["lang"])
            if risk["hours_to"] >= 0.25:
                text += messages.check_in_text(check, house["lang"])
            self._alert(house, ts, f"climate:{risk['kind']}", risk["level"], text,
                        repeat_s=3 * 3600)
            if RANK[risk["level"]] > RANK[reply["level"]]:
                reply["level"] = risk["level"]
            if risk["level"] == "danger":
                reply["buzzer"] = 1
        result["level"] = reply["level"]
        reply["buzzer"] = int(reply["buzzer"] or auto["cmd"]["buzzer"])
        self._ctx.auto = None
        result["detection"] = _detection(reply["level"], now_ppm if has_nh3 else None,
                                         [r for r in adv.climate if r["hours_to"] < 0.25],
                                         findings)
        result["data_mode"] = getattr(self._ctx, "mode", "live")
        self.store.set_advice(did, ts, json.dumps(result, default=float))
        return reply, result


# ---------------------------------------------------------------- detection + check-in
def _detection(level, nh3_now, climate_now, findings) -> dict:
    """Model 2 - danger detection: what is wrong RIGHT NOW (not in the forecast)."""
    reasons = []
    if nh3_now is not None and nh3_now >= NH3_WARN:
        reasons.append({"kind": "ammonia", "value": round(nh3_now, 1),
                        "level": "danger" if nh3_now >= NH3_DANGER else "warn"})
    for r in climate_now:
        reasons.append({"kind": r["kind"], "value": round(r["temp"], 1), "level": r["level"],
                        "node": r["node"]})
    for f in findings:
        reasons.append({"kind": f["type"] if f["kind"] == "event" else "sensor_fault",
                        "node": f["node"], "level": "warn"})
    now_level = max([r["level"] for r in reasons], key=lambda lv: RANK[lv], default="ok")
    return {"level_now": now_level, "reasons": reasons,
            "sensor_faults": sum(1 for f in findings if f["kind"] == "fault"),
            "farm_events": sum(1 for f in findings if f["kind"] == "event")}


def next_check_in(forecast, ts, comfort, has_nh3=True) -> dict | None:
    """Model 3 - prediction: when should the farmer go and look?

    First moment in the 6-hour forecast (if nothing changes) where ammonia passes the
    warning line or bird-zone temperature leaves the comfort band by 3 C. The farmer is
    asked to check 30 minutes before that (never sooner than 15 minutes from now)."""
    if not forecast:
        return None
    sq, hours = forecast["status_quo"], forecast["hours"]
    lo, hi = comfort
    for i, h in enumerate(hours):
        why = None
        if has_nh3 and sq["nh3_p50"][i] >= NH3_WARN:
            why = ("ammonia", sq["nh3_p50"][i])
        elif sq["temp_min"][i] < lo - 3:
            why = ("cold", sq["temp_min"][i])
        elif sq["temp_max"][i] > hi + 3:
            why = ("heat", sq["temp_max"][i])
        if why:
            at = ts + max(0.25, h - 0.5) * 3600
            return {"ts": int(at), "in_hours": round(max(0.25, h - 0.5), 2), "reason": why[0],
                    "value": round(float(why[1]), 1),
                    "local": datetime.fromtimestamp(at, EAT).strftime("%H:%M")}
    return {"ts": None, "in_hours": None, "reason": "stable", "value": None, "local": None}
