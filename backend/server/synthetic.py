"""Synthetic sensor feed: realistic readings for houses that have no sensor box yet.

Each house with `source = 'synthetic'` gets its own simulated flock (the same physics
simulator the AI was trained on, seeded by the device id, so a house always behaves the
same way). Every minute the feed pushes the current 10-minute slot through the normal
pipeline - forecasting, detection, advice - exactly as a real gateway would. Readings are
marked with a flag and the dashboard labels them "Synthetic data".

The IoT path stays open: the first upload from a real gateway with the house's key
switches the house to `source = 'live'` and the feed stops for it.

SMS: synthetic data never texts a farmer, unless the house has "send TEST SMS" turned on
(messages then start with "TEST:"). History back-filled on start never sends SMS.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
from datetime import datetime

import numpy as np

from airnest.config import CURTAIN, FAN, NODE_FEATS, TEMP, comfort_temp
from airnest.simulator import simulate

from .pipeline import EAT, SLOT, SYNTHETIC_FLAG

log = logging.getLogger("afyanest.synthetic")
DAYS = 42                              # one broiler cycle, then the flock repeats
BACKFILL_SLOTS = 48 * 6                # 48 h of history when a house starts
_cache: dict[str, dict] = {}
_lock = threading.Lock()


def _series(device_id: str) -> dict:
    with _lock:
        if device_id not in _cache:
            seed = int(hashlib.sha256(device_id.encode()).hexdigest()[:8], 16)
            d = simulate(1, DAYS, seed=seed)
            x = d["x_meas"][0].copy()
            # Brooder heat: the simulator models house air; small farmers heat the chick area
            # (jiko / lamp). Lift each day's bird-zone temperature so the daily average sits just
            # under the comfort band for the flock's age - nights can still dip and alert.
            n = x.shape[0]
            k = np.ones(144) / 144
            smooth = lambda v: np.convolve(np.pad(v, 72, mode="edge"), k, mode="same")[72:72 + n]
            mean_t = smooth(np.nan_to_num(np.nanmean(x[:, :4, TEMP], axis=1), nan=20.0))
            band = np.array([comfort_temp(i / 144) for i in range(n)])
            lo, hi = smooth(band[:, 0]), smooth(band[:, 1])
            lift = np.clip((lo + hi) / 2 - mean_t, 0, None)
            squeeze = 1 - 0.4 * np.clip(lift / 2, 0, 1)        # heated: smaller day/night swing
            x[:, :, TEMP] = mean_t[:, None] + (x[:, :, TEMP] - mean_t[:, None]) * squeeze[:, None]
            # the brooder end is heated: warmest at the jiko, cooler towards the fan end
            x[:, :, TEMP] += lift[:, None] * np.array([1.15, 0.95, 0.85, 0.7, 0.5, 0.45])[None, : x.shape[1]]
            x[:, 0, TEMP] += 2.5 * np.clip((lift - 1) / 2, 0, 1)
            x[:, :, TEMP] -= (np.clip(mean_t - hi, 0, None) * 0.8)[:, None]   # opened up on hot days
            # Typical small farm: ammonia trouble on a few evenings, not every day.
            p95 = float(np.nanpercentile(np.nanmax(x[:, :, 0], axis=1), 95))
            if p95 > 22:
                x[:, :, 0] *= 22.0 / p95
            _cache[device_id] = {"x": x, "g": d["g"][0]}
            if len(_cache) > 200:                      # memory guard
                _cache.pop(next(iter(_cache)))
        return _cache[device_id]


def sim_index(placement_ts: float, ts: float) -> int:
    """Simulator step for real time ts: same flock day and same time of day (Nairobi)."""
    t = datetime.fromtimestamp(ts, EAT)
    p = datetime.fromtimestamp(placement_ts or ts, EAT)
    day = max(0, (t.date() - p.date()).days) % DAYS
    return day * 144 + (t.hour * 60 + t.minute) // 10


def payload(house: dict, ts: float) -> dict:
    s = _series(house["device_id"])
    k = sim_index(house["placement_ts"], ts)
    x, g = s["x"][k], s["g"][k]
    nodes = [dict(node=n, **{f: round(float(x[n, j]), 2) for j, f in enumerate(NODE_FEATS)})
             for n in range(x.shape[0])]
    return {"device_id": house["device_id"], "nodes": nodes,
            "curtain": round(float(g[CURTAIN]), 2), "fan": float(g[FAN])}


class SyntheticFeed:
    def __init__(self, service):
        self.svc = service

    def houses(self):
        hold = getattr(self.svc, "scenario_hold", {})
        now = time.time()
        return [h for h in self.svc.store.all_houses()
                if (h.get("source") or "synthetic") == "synthetic" and hold.get(h["device_id"], 0) < now]

    def tick(self, now: float | None = None, backfill_slots: int = BACKFILL_SLOTS) -> int:
        """Bring every synthetic house up to date. Returns the number of uploads made."""
        now = now or time.time()
        cur = int(now // SLOT)
        done = 0
        for h in self.houses():
            last = self.svc.store.last_slot(h["device_id"])
            start = cur - backfill_slots + 1 if last is None else min(last + 1, cur)
            start = max(start, cur - backfill_slots + 1)
            quick_until = cur - 3                      # old history: just store it (fast)
            for slot in range(start, min(quick_until, cur + 1)):
                p = payload(h, slot * SLOT + SLOT - 1)
                self.svc.store.add_readings(h["device_id"], slot, [
                    dict(n, flags=SYNTHETIC_FLAG) for n in p["nodes"]])
                self.svc.store.log_house(h["device_id"], slot, p["curtain"], p["fan"], 0.0)
                done += 1
            start = max(start, quick_until)
            for slot in range(start, cur + 1):
                ts = slot * SLOT + (SLOT - 1 if slot < cur else (now - slot * SLOT))
                mode = "synthetic" if slot == cur else "backfill"
                try:
                    self.svc.brain.ingest(self.svc.store.house(h["device_id"]),
                                          payload(h, ts), ts, mode=mode)
                    done += 1
                except Exception:
                    log.exception("synthetic upload failed for %s", h["device_id"])
                    break
        return done
