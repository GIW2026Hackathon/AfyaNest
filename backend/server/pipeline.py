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
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

from airnest.anomaly import GDNDetector, StatDetector, diagnose
from airnest.config import (CURTAIN, F_NODE, FAN, G_FEATS, H_FUT, HEATER, L_HIST,
                            N_NODES, NH3, NH3_DANGER, NH3_WARN, STEP_MIN, TEMP,
                            comfort_temp)
from airnest.controller import advise
from airnest.dataset import Scaler
from airnest.forecasters import load_forecaster
from airnest.simulator import ADJ

from . import messages, notify, weather

EAT = timezone(timedelta(hours=3))
SLOT = STEP_MIN * 60
MIN_HISTORY = 18                     # 3 h of data before the AI starts advising
REPEAT_S = {"watch": 6 * 3600, "warn": 3 * 3600, "danger": 2 * 3600}  # avoid SMS fatigue
RANK = {"ok": 0, "watch": 1, "warn": 2, "danger": 3}


class Brain:
    def __init__(self, store, model_dir):
        self.store = store
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
        have = (~np.isnan(x[..., NH3])).any(1)
        n_have = int(have.sum())
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
        return x, n_have, logs

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

    def _alert(self, house, ts, kind, level, text, to=None, repeat_s=None):
        last = self.store.last_alert(house["device_id"], kind)
        if last:
            escalated = RANK.get(level, 0) > RANK.get(last["level"], 0)
            gap = repeat_s or REPEAT_S.get(level, 6 * 3600)
            if not escalated and ts - last["ts"] < gap:
                return False
        to = to or house["phone"]
        if to:
            notify.send_sms(to, text)
        self.store.add_alert(house["device_id"], ts, kind, level, text)
        return True

    # ------------------------------------------------------------------ main
    def ingest(self, house, payload, ts):
        did = house["device_id"]
        slot = int(ts // SLOT)
        self.store.add_readings(did, slot, payload.get("nodes", []))
        curtain = payload.get("curtain")
        if curtain is None and house["last_curtain_ts"] and ts - house["last_curtain_ts"] < 4 * 3600:
            curtain = house["last_curtain"]          # farmer told us by SMS recently
        x, n_have, logs = self._grid(house, slot)
        # heater inferred from brooder vs centre temperature
        heater = float(x[-1, 0, TEMP] - x[-1, 3, TEMP] > 3.0)
        self.store.log_house(did, slot, curtain, float(payload.get("fan", 0)), heater)
        logs[slot] = {"curtain": curtain, "fan": float(payload.get("fan", 0)), "heater": heater}

        now_ppm = float(np.nanmax(x[-1, :, NH3]))
        reply = {"fan": 0, "buzzer": int(now_ppm >= NH3_DANGER), "level": "ok"}
        result = {"ts": ts, "now_max_nh3": now_ppm, "model": self.model_name,
                  "detector": self.detector_name, "findings": []}

        if n_have < MIN_HISTORY:                       # warming up: thresholds only
            lvl = "danger" if now_ppm >= NH3_DANGER else "warn" if now_ppm >= NH3_WARN else "ok"
            reply["level"] = lvl
            # FIX: in danger, run the fan even while the AI is still warming up
            reply["fan"] = int(bool(house["has_fan"]) and lvl == "danger")
            # FIX: store the level so the dashboard doesn't show "ok" during warm-up
            result["level"] = lvl
            if lvl != "ok":
                self._alert(house, ts, "ammonia", lvl,
                            f"AirNest {house['name']}: Amonia {now_ppm:.0f}ppm. Fungua pazia."
                            if house["lang"] == "sw" else
                            f"AirNest {house['name']}: Ammonia {now_ppm:.0f}ppm. Open curtains.")
            result["status"] = "warming_up"
            self.store.q("INSERT OR REPLACE INTO advice VALUES (?,?,?)",
                         (did, ts, json.dumps(result)))
            return reply, result

        slots_h = list(range(slot - L_HIST + 1, slot + 1))
        slots_f = list(range(slot + 1, slot + 1 + H_FUT))
        gh = self._globals(house, slots_h, logs)
        gf = self._globals(house, slots_f, logs, future=True)

        # ---- anomalies ----
        scores, stuck = self.detector.scores(x, gh, gf[0])
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
        adv = advise(self.forecaster, x, gh, gf, age, bool(house["has_fan"]))
        reply["level"] = adv.level
        reply["fan"] = int(bool(house["has_fan"]) and adv.best.fan[0] > 0.5)
        reply["buzzer"] = int(adv.level == "danger")
        result.update(level=adv.level, status_quo_peak_nh3=adv.status_quo_peak_nh3,
                      status_quo_peak_p90=adv.status_quo_peak_p90,
                      hours_to_warn=adv.hours_to_warn, worst_node=adv.worst_node,
                      plan=adv.best.name, plan_peak_nh3=adv.best_peak_nh3,
                      plan_min_temp=adv.best_min_temp,
                      plan_curtain=adv.best.curtain.round(2).tolist()[::6])
        should_text = adv.level in ("warn", "danger") or (
            adv.level == "watch" and adv.hours_to_warn is not None)
        if should_text:
            text = messages.advice_sms(house["name"], adv, now_ppm, float(gh[-1, CURTAIN]),
                                       comfort_temp(age)[0], house["lang"])
            result["sms_sent"] = self._alert(house, ts, "ammonia", adv.level, text)

        # ---- climate: cold chicks / heat stress ----
        result["climate"] = adv.climate
        for risk in adv.climate:
            text = messages.climate_sms(house["name"], risk, adv.best,
                                        float(gh[-1, CURTAIN]), house["lang"])
            self._alert(house, ts, f"climate:{risk['kind']}", risk["level"], text,
                        repeat_s=3 * 3600)
            if RANK[risk["level"]] > RANK[reply["level"]]:
                reply["level"] = risk["level"]
            if risk["level"] == "danger":
                reply["buzzer"] = 1
        self.store.q("INSERT OR REPLACE INTO advice VALUES (?,?,?)",
                     (did, ts, json.dumps(result, default=float)))
        return reply, result
