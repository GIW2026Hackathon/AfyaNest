"""Windowing and scaling shared by every model (pure NumPy, no PyTorch needed)."""
from __future__ import annotations

import json

import numpy as np

from .config import (F_NODE, G_FEATS, H_FUT, L_HIST, NH3, TARGETS)
from .simulator import LABEL_FAULT


class Scaler:
    """Ammonia is log1p-transformed (it is skewed), then everything is z-scored."""

    def __init__(self, x_mu=None, x_sd=None, g_mu=None, g_sd=None):
        self.x_mu, self.x_sd, self.g_mu, self.g_sd = x_mu, x_sd, g_mu, g_sd

    @staticmethod
    def _pre(x):
        x = np.asarray(x, np.float32).copy()
        x[..., NH3] = np.log1p(np.clip(x[..., NH3], 0, None))
        return x

    def fit(self, x, g):
        xp = self._pre(x).reshape(-1, F_NODE)
        gp = np.asarray(g, np.float32).reshape(-1, G_FEATS)
        self.x_mu, self.x_sd = xp.mean(0), xp.std(0) + 1e-6
        self.g_mu, self.g_sd = gp.mean(0), gp.std(0) + 1e-6
        # leave the 0..1 control inputs and sin/cos unscaled: keeps them interpretable
        for i in (2, 3, 5, 6, 7):
            self.g_mu[i], self.g_sd[i] = 0.0, 1.0
        return self

    def x(self, x):
        return ((self._pre(x) - self.x_mu) / self.x_sd).astype(np.float32)

    def g(self, g):
        return ((np.asarray(g, np.float32) - self.g_mu) / self.g_sd).astype(np.float32)

    def inv_target(self, y, target_idx):
        """Undo scaling for one forecast target channel (NH3 or TEMP)."""
        v = y * self.x_sd[target_idx] + self.x_mu[target_idx]
        return np.expm1(v) if target_idx == NH3 else v

    def to_json(self, path):
        json.dump({k: getattr(self, k).tolist() for k in
                   ("x_mu", "x_sd", "g_mu", "g_sd")}, open(path, "w"), indent=1)

    @classmethod
    def from_json(cls, path):
        d = json.load(open(path))
        return cls(**{k: np.array(v, np.float32) for k, v in d.items()})


def load_sim(path):
    d = np.load(path)
    return d["x_meas"], d["g"], d["labels"]


def split_houses(n_houses, val_frac=0.15, test_frac=0.15, seed=0):
    idx = np.random.default_rng(seed).permutation(n_houses)
    n_te = max(1, int(n_houses * test_frac))
    n_va = max(1, int(n_houses * val_frac))
    return idx[n_te + n_va:], idx[n_te:n_te + n_va], idx[:n_te]


def window_starts(labels, houses, stride=3, drop_faulty_targets=True):
    """All (house, t) window starts. Windows whose forecast horizon contains a
    sensor fault are dropped: in real deployments the anomaly model flags these
    so they don't poison training targets."""
    T = labels.shape[1]
    out = []
    for h in houses:
        fault = (labels[h] == LABEL_FAULT).any(axis=(1, 2))
        cum = np.concatenate([[0], np.cumsum(fault)])
        for t in range(L_HIST, T - H_FUT + 1, stride):
            if drop_faulty_targets and cum[t + H_FUT] - cum[t] > 0:
                continue
            out.append((h, t))
    return np.array(out, dtype=np.int64)


def make_batch(xs, gs, starts):
    """xs/gs are already-scaled arrays [Hh,T,N,F] / [Hh,T,G].
    Returns xh [B,L,N,F], gh [B,L,G], gf [B,H,G], y [B,H,N,len(TARGETS)]."""
    xh = np.stack([xs[h, t - L_HIST:t] for h, t in starts])
    gh = np.stack([gs[h, t - L_HIST:t] for h, t in starts])
    gf = np.stack([gs[h, t:t + H_FUT] for h, t in starts])
    y = np.stack([xs[h, t:t + H_FUT][..., TARGETS] for h, t in starts])
    return xh, gh, gf, y
