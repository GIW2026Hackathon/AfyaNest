"""Anomaly detection: is something wrong with the air, or with the sensor?

Two back-ends, one output format:
* GDNDetector  - Graph Deviation Network (ONNX, trained on GPU). Learns how the 24
                 sensor channels relate to each other; flags channels whose value
                 deviates from what their graph neighbours predict.
* StatDetector - robust statistics fallback (works from day one, no training).

Both return per-channel deviation scores [N,F]; `diagnose` then decides whether
a deviation is a sensor FAULT (send a technician / recalibrate) or a real EVENT
on the farm (wet litter from a drinker leak, brooder heater failure) that the
farmer must act on now.
"""
from __future__ import annotations

import json

import numpy as np

from .config import CO2, F_NODE, HEATER, N_NODES, NH3, NODE_FEATS, NODE_NAMES, RH, TEMP
from .dataset import Scaler

GDN_WIN = 12


class StatDetector:
    """Robust z-score of the latest reading against the node's own last 6 h and
    against its neighbours, plus stuck-sensor detection."""

    def scores(self, xh, gh=None, gn=None):
        hist = xh[-36:-1]                                 # [35,N,F]
        med = np.median(hist, 0)
        mad = np.median(np.abs(hist - med), 0) * 1.4826
        floor = np.array([1.5, 0.6, 3.0, 80.0]) * np.ones((N_NODES, 1))  # noise floors
        floor[0] *= 2.0                                   # brooder swings with the heater
        z_self = np.abs(xh[-1] - med) / np.maximum(mad, floor)
        # spatial: how far this node is from the house median *relative to usual*
        gap_now = xh[-1] - np.median(xh[-1], 0)
        gap_hist = hist - np.median(hist, 1, keepdims=True)
        gmed = np.median(gap_hist, 0)
        gmad = np.median(np.abs(gap_hist - gmed), 0) * 1.4826
        z_sp = np.abs(gap_now - gmed) / np.maximum(gmad, floor)
        s = np.minimum(z_self, z_sp) / 4.0               # ~1 = threshold
        stuck = (np.ptp(xh[-18:], 0) < 1e-6)             # identical for 3 h
        s = np.where(stuck, np.maximum(s, 1.5), s)
        return s, stuck


class GDNDetector:
    def __init__(self, onnx_path, scaler: Scaler, stats_path):
        import onnxruntime as ort
        self.sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        self.scaler = scaler
        st = json.load(open(stats_path))
        self.med, self.iqr = np.array(st["median"]), np.array(st["iqr"])
        self.thr = float(st["threshold"])

    def scores(self, xh, gh, gn):
        s = self.scaler
        win = s.x(xh[-GDN_WIN - 1:-1]).reshape(1, GDN_WIN, -1).transpose(0, 2, 1)
        pred = self.sess.run(None, {"x": win.astype(np.float32),
                                    "g": s.g(gn[None]).astype(np.float32)})[0][0]
        err = np.abs(s.x(xh[-1]).ravel() - pred)
        z = (err - self.med) / np.maximum(self.iqr, 1e-3) / self.thr
        stuck = (np.ptp(xh[-18:], 0) < 1e-6)
        z = z.reshape(N_NODES, F_NODE)
        return np.where(stuck, np.maximum(z, 1.5), z), stuck


def diagnose(scores, stuck, xh, gh) -> list[dict]:
    """Turn channel scores into human-meaningful findings."""
    out = []
    flagged = scores >= 1.0
    for n in range(N_NODES):
        f = flagged[n]
        if not f.any():
            continue
        name = NODE_NAMES[n]
        now, before = xh[-1, n], np.median(xh[-36:-1, n], 0)
        heater_on = gh is not None and gh[-1, HEATER] > 0.5
        if f[NH3] and f[RH] and now[NH3] > before[NH3] and now[RH] > before[RH]:
            out.append(dict(node=name, kind="event", type="wet_litter",
                            detail="Ammonia and humidity rising together at one spot: "
                                   "check for a leaking drinker or wet litter."))
        elif n == 0 and f[TEMP] and heater_on and now[TEMP] < before[TEMP] - 2:
            out.append(dict(node=name, kind="event", type="heater_failure",
                            detail="Brooder area cooling while heater should be on: "
                                   "check the jiko/gas brooder."))
        else:
            for c in np.where(f)[0]:
                typ = "stuck" if stuck[n, c] else "drift_or_spike"
                out.append(dict(node=name, kind="fault", type=f"sensor_{typ}",
                                channel=NODE_FEATS[c],
                                detail=f"{NODE_FEATS[c]} sensor at {name} disagrees with "
                                       "its history and neighbours: clean or recalibrate."))
    return out
