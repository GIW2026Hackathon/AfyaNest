"""Forecaster back-ends with one shared interface used by the controller and server.

    predict(xh_raw [B,L,N,F], gh_raw [B,L,G], gf_raw [B,H,G])
        -> {"nh3": [B,H,N,Q], "temp": [B,H,N,Q]}   in real units (ppm, deg C)

* OnnxForecaster  - the AmmoniaNet graph transformer, exported to ONNX after
                    training on a GPU. Runs on the server with only onnxruntime.
* GBMForecaster   - gradient-boosted quantile baseline (scikit-learn). Used as a
                    benchmark the neural net must beat, and as a fallback.
"""
from __future__ import annotations

import pickle

import numpy as np

from .config import (CURTAIN, FAN, HEATER, H_FUT, N_NODES, NH3, QUANTILES, TARGETS,
                     TEMP)
from .dataset import Scaler
from .simulator import ADJ


def _unscale(scaler: Scaler, y):
    """y [B,H,N,T,Q] scaled -> dict of real-unit arrays [B,H,N,Q]."""
    return {"nh3": scaler.inv_target(y[..., 0, :], NH3),
            "temp": scaler.inv_target(y[..., 1, :], TEMP)}


class OnnxForecaster:
    def __init__(self, onnx_path, scaler_path):
        import onnxruntime as ort
        self.sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        self.scaler = Scaler.from_json(scaler_path)

    def predict(self, xh, gh, gf):
        s = self.scaler
        y = self.sess.run(None, {"xh": s.x(xh), "gh": s.g(gh), "gf": s.g(gf)})[0]
        return _unscale(s, y)


# ---------------------------------------------------------------------------
# Gradient-boosting baseline
# ---------------------------------------------------------------------------
HORIZONS = [3, 6, 12, 18, 24, 36]           # steps ahead (30 min .. 6 h)


def gbm_features(xh, gh, gf, h):
    """Hand-made features for every (window, node) at horizon h. Inputs scaled."""
    B, L, N, F = xh.shape
    last = xh[:, -1]                                      # B,N,F
    m1 = xh[:, -6:].mean(1)
    d1 = xh[:, -1] - xh[:, -7]
    d3 = xh[:, -1] - xh[:, -19]
    nb = np.einsum("ij,bjf->bif", ADJ, last)               # neighbour mean
    house = last.mean(1, keepdims=True).repeat(N, 1)
    g_now = gh[:, -1][:, None].repeat(N, 1)
    fut = gf[:, :h]
    ctrl = np.stack([fut[..., CURTAIN].mean(1), fut[..., FAN].mean(1),
                     fut[..., HEATER].mean(1), fut[:, -1, 0], fut[:, -1, 2],
                     fut[:, -1, 3], fut[..., CURTAIN].min(1)], -1)[:, None].repeat(N, 1)
    onehot = np.broadcast_to(np.eye(N), (B, N, N))
    hcol = np.full((B, N, 1), h, np.float32)
    return np.concatenate([last, m1, d1, d3, nb, house, g_now, ctrl, onehot, hcol],
                          -1).reshape(B * N, -1)


class GBMForecaster:
    def __init__(self, scaler: Scaler, models=None):
        self.scaler, self.models = scaler, models or {}

    def fit(self, xh, gh, gf, y, max_iter=300, verbose=True):
        from sklearn.ensemble import HistGradientBoostingRegressor
        X = np.concatenate([gbm_features(xh, gh, gf, h) for h in HORIZONS])
        for ti in range(len(TARGETS)):
            # predict change from the last value: much easier for trees
            Y = np.concatenate([(y[:, h - 1, :, ti] - xh[:, -1, :, TARGETS[ti]]).ravel()
                                for h in HORIZONS])
            for q in QUANTILES:
                m = HistGradientBoostingRegressor(loss="quantile", quantile=q,
                                                  max_iter=max_iter, learning_rate=0.08,
                                                  max_leaf_nodes=31, random_state=0)
                self.models[(ti, q)] = m.fit(X, Y)
                if verbose:
                    print(f"  fitted target {ti} q{q}")
        return self

    def predict_scaled(self, xs, gs_h, gs_f):
        B, N = xs.shape[0], N_NODES
        out = np.zeros((B, H_FUT, N, len(TARGETS), len(QUANTILES)), np.float32)
        Xs = {h: gbm_features(xs, gs_h, gs_f, h) for h in HORIZONS}
        # linear interpolation between the trained horizons as one matrix product
        hz = np.array([0] + HORIZONS, float)
        W = np.stack([np.interp(np.arange(1, H_FUT + 1), hz, np.eye(len(hz))[j])
                      for j in range(len(hz))], 1)                 # H_FUT x len(hz)
        for ti in range(len(TARGETS)):
            base = xs[:, -1, :, TARGETS[ti]]
            for qi, q in enumerate(QUANTILES):
                pts = np.stack([self.models[(ti, q)].predict(Xs[h]).reshape(B, N)
                                for h in HORIZONS], 1)          # B,len(H),N
                pts = np.concatenate([np.zeros((B, 1, N)), pts], 1)
                out[..., ti, qi] = base[:, None] + np.einsum("tk,bkn->btn", W, pts)
        out = np.sort(out, axis=-1)                       # no quantile crossing
        return out

    def predict(self, xh, gh, gf):
        s = self.scaler
        return _unscale(s, self.predict_scaled(s.x(xh), s.g(gh), s.g(gf)))

    def save(self, path):
        pickle.dump(self.models, open(path, "wb"))

    @classmethod
    def load(cls, path, scaler):
        return cls(scaler, pickle.load(open(path, "rb")))


def load_forecaster(model_dir):
    """Prefer the trained graph transformer; fall back to the GBM baseline."""
    import os
    scaler_path = os.path.join(model_dir, "scaler.json")
    onnx_path = os.path.join(model_dir, "ammonianet.onnx")
    if os.path.exists(onnx_path):
        return OnnxForecaster(onnx_path, scaler_path), "ammonianet"
    return GBMForecaster.load(os.path.join(model_dir, "gbm.pkl"),
                              Scaler.from_json(scaler_path)), "gbm_baseline"
