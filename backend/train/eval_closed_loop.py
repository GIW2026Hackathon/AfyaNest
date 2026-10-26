"""Closed-loop A/B test: does following the AI advice actually help the birds?

Runs the simulator twice with identical weather, flocks and events:
  A) the farmer's usual behaviour
  B) the farmer follows AirNest's advice every hour (from day --start onwards)
and compares ammonia exposure and cold stress in the bird zones.
"""
import argparse
import json
import os
import time

from _common import ROOT

import numpy as np

from airnest.config import (CURTAIN, FAN, H_FUT, L_HIST, NH3, NH3_DANGER, STEPS_PER_HOUR,
                            TEMP, comfort_temp)
from airnest.controller import advise
from airnest.forecasters import load_forecaster
from airnest.simulator import simulate

p = argparse.ArgumentParser()
p.add_argument("--houses", type=int, default=4)
p.add_argument("--seed", type=int, default=123)
p.add_argument("--start", type=float, default=14)
p.add_argument("--models", default=os.path.join(ROOT, "models"))
a = p.parse_args()

fc, name = load_forecaster(a.models)
print("forecaster:", name)
t0 = time.time()
base = simulate(a.houses, 42, a.seed, anomalies=False)
g_base, has_fan = base["g"], base["meta"]["has_fan"]
T = g_base.shape[1]
rng = np.random.default_rng(0)
plan = {}


def policy(t, xh_all, gh_all):
    Hh = xh_all.shape[0]
    oc, of = np.full(Hh, np.nan), np.full(Hh, np.nan)
    if t < L_HIST or t + H_FUT > T:
        return oc, of
    for h in range(Hh):
        if t % STEPS_PER_HOUR == 0 or h not in plan:
            xh = xh_all[h, -L_HIST:] + rng.normal(0, [0.5, 0.2, 1.5, 30], (L_HIST, 6, 4))
            gf = g_base[h, t:t + H_FUT].copy()
            adv = advise(fc, xh, gh_all[h, -L_HIST:], gf, gh_all[h, -1, 4], bool(has_fan[h]))
            plan[h] = (t, adv.best.curtain, adv.best.fan)
        t_dec, c, f = plan[h]
        oc[h], of[h] = c[t - t_dec], f[t - t_dec]
    return oc, of


ctrl = simulate(a.houses, 42, a.seed, anomalies=False, policy=policy, start_day=a.start)
print(f"simulated A/B in {time.time() - t0:.0f}s")


def metrics(run):
    x, g = run["x_true"], run["g"]
    s = int(a.start * 144)
    nh3 = x[:, s:, :4, NH3]                       # bird zones
    temp = x[:, s:, :4, TEMP]
    age = g[:, s:, 4]
    lo = np.vectorize(lambda d: comfort_temp(d)[0])(age)[..., None]
    hrs = 1 / STEPS_PER_HOUR
    return {
        "mean_nh3_ppm": float(nh3.mean()),
        "hours_above_25ppm_per_house": float((nh3.mean(-1) > NH3_DANGER).sum() * hrs / len(x)),
        "peak_nh3_ppm": float(nh3.max()),
        "cold_degree_hours_per_house": float(np.clip(lo - temp, 0, None).mean(-1).sum()
                                             * hrs / len(x)),
        "mean_curtain": float(g[:, s:, CURTAIN].mean()),
        "fan_hours_per_house": float(g[:, s:, FAN].sum() * hrs / len(x)),
    }


res = {"farmer_usual": metrics(base), "with_airnest": metrics(ctrl), "forecaster": name}
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(a.models, f"closed_loop_{name}.json"), "w"), indent=1)
