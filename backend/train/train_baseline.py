"""Train the gradient-boosting quantile baseline (CPU only, no PyTorch).

It is the benchmark AmmoniaNet must beat and the server's fallback model.
"""
import argparse
import json
import os
import time

from _common import ROOT, ensure_data

import numpy as np

from airnest.config import NH3, STEPS_PER_HOUR
from airnest.dataset import Scaler, make_batch, split_houses, window_starts
from airnest.forecasters import GBMForecaster

p = argparse.ArgumentParser()
p.add_argument("--data", default=os.path.join(ROOT, "data/sim.npz"))
p.add_argument("--out", default=os.path.join(ROOT, "models"))
p.add_argument("--windows", type=int, default=6000)
a = p.parse_args()
os.makedirs(a.out, exist_ok=True)
rng = np.random.default_rng(0)

x, g, lab = ensure_data(a.data)
tr, va, te = split_houses(len(x))
sp = os.path.join(a.out, "scaler.json")
scaler = Scaler.from_json(sp) if os.path.exists(sp) else Scaler().fit(x[tr], g[tr])
scaler.to_json(sp)
xs, gs = scaler.x(x), scaler.g(g)
st = window_starts(lab, tr, stride=2)
st = st[rng.choice(len(st), min(a.windows, len(st)), replace=False)]
t0 = time.time()
gbm = GBMForecaster(scaler).fit(*make_batch(xs, gs, st))
gbm.save(os.path.join(a.out, "gbm.pkl"))
print(f"trained in {time.time() - t0:.0f}s")

st_te = window_starts(lab, te, stride=12)
xh, gh, gf, y = make_batch(xs, gs, st_te)
P = gbm.predict_scaled(xh, gh, gf)
nh3_p = scaler.inv_target(P[..., 0, :], NH3)
nh3_y = scaler.inv_target(y[..., 0], NH3)
last = scaler.inv_target(xh[:, -1, :, NH3], NH3)
res = {}
for hrs in (1, 3, 6):
    k = hrs * STEPS_PER_HOUR - 1
    res[f"mae_{hrs}h_ppm"] = float(np.abs(nh3_p[:, k, :, 1] - nh3_y[:, k]).mean())
    res[f"persist_mae_{hrs}h_ppm"] = float(np.abs(last - nh3_y[:, k]).mean())
res["coverage_80"] = float(((nh3_y >= nh3_p[..., 0]) & (nh3_y <= nh3_p[..., 2])).mean())
# can it warn early? episodes where ammonia crosses 20 ppm within 6 h
cross = (nh3_y.max((1, 2)) >= 20) & (last.max(1) < 20)
warned = nh3_p[..., 1].max((1, 2)) >= 20
res["early_warning_recall"] = float(warned[cross].mean()) if cross.any() else None
res["false_alarm_rate"] = float(warned[~cross & (nh3_y.max((1, 2)) < 15)].mean())
print("TEST:", json.dumps(res, indent=1))
json.dump(res, open(os.path.join(a.out, "gbm_test.json"), "w"), indent=1)
