"""Model-predictive ventilation advisor.

The farmer's real dilemma at night: close the curtains and the birds stay warm but
ammonia builds; open them and ammonia clears but chicks get cold. This module asks
the forecaster "what happens over the next 6 hours if we do X?" for a set of
candidate plans, scores each plan on ammonia (pessimistic 90th percentile), bird
temperature comfort and effort, and returns the best one plus the status-quo risk.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .config import (CURTAIN, FAN, H_FUT, NH3_DANGER, NH3_TARGET, NH3_WARN,
                     NODE_NAMES, STEPS_PER_HOUR, comfort_temp)

CURTAIN_LEVELS = [0.05, 0.15, 0.3, 0.5, 0.8]


@dataclass
class Plan:
    name: str
    curtain: np.ndarray                     # [H] 0..1
    fan: np.ndarray                         # [H] 0/1
    meta: dict = field(default_factory=dict)


@dataclass
class Advice:
    status_quo_peak_nh3: float              # ppm, median forecast, worst node
    status_quo_peak_p90: float
    hours_to_warn: float | None             # when status quo first crosses NH3_WARN
    worst_node: str
    best: Plan
    best_peak_nh3: float
    best_min_temp: float
    level: str                              # ok | watch | warn | danger
    costs: dict
    climate: list = field(default_factory=list)   # cold / heat risks (see climate_risks)
    forecast: dict = field(default_factory=dict)  # 6 h curves for the dashboard


BIRD_ZONES = slice(0, 4)                    # brooder, drinkers, centre (not curtain/fan end)


def climate_risks(temp_now, temp_fc, rh_now, age_days, measured=None):
    """Cold and heat stress for the birds over the next hours if nothing changes.

    temp_now [N], temp_fc [H,N] (median forecast), rh_now [N].
    Margins are from the comfort band for the birds' age: 3 C outside = warn,
    6 C outside = danger. High humidity makes heat worse (birds cool by panting),
    so above 70 %RH the heat margins shrink by 1.5 C.
    """
    lo, hi = comfort_temp(age_days)
    # young chicks are kept inside the brooder ring: only that zone matters for them
    zones = slice(0, 1) if age_days < 10 else BIRD_ZONES
    t = np.vstack([temp_now[None], temp_fc])[:, zones].astype(float)
    names = NODE_NAMES[zones]
    if measured is not None:
        # judge only zones that really have a sensor (gap-filled zones are guesses)
        m = np.asarray(measured, bool)[zones]
        if not m.any():                       # e.g. chicks in the brooder but the box hangs elsewhere
            m = np.asarray(measured, bool)[BIRD_ZONES]
            t = np.vstack([temp_now[None], temp_fc])[:, BIRD_ZONES].astype(float)
            names = NODE_NAMES[BIRD_ZONES]
        if not m.any():
            return []
        t[:, ~m] = np.nan
    out = []
    tmin, tmax = float(np.nanmin(t)), float(np.nanmax(t))
    if tmin < lo - 3:
        first = int(np.argmax(np.nanmin(t, 1) < lo - 3))
        out.append(dict(kind="cold", level="danger" if tmin < lo - 6 else "warn",
                        temp=tmin, comfort=(lo, hi),
                        node=names[int(np.nanargmin(np.nanmin(t, 0)))],
                        hours_to=first / STEPS_PER_HOUR))
    rh = rh_now[BIRD_ZONES] if measured is None else \
        np.where(np.asarray(measured, bool)[BIRD_ZONES], rh_now[BIRD_ZONES], np.nan)
    humid = bool(np.nanmean(rh) > 70) if not np.isnan(rh).all() else False
    margin = 1.5 if humid else 0.0
    if tmax > hi + 3 - margin:
        first = int(np.argmax(np.nanmax(t, 1) > hi + 3 - margin))
        out.append(dict(kind="heat", level="danger" if tmax > hi + 6 - margin else "warn",
                        temp=tmax, comfort=(lo, hi), humid=humid,
                        node=names[int(np.nanargmax(np.nanmax(t, 0)))],
                        hours_to=first / STEPS_PER_HOUR))
    return out


def candidate_plans(cur_curtain: float, has_fan: bool, usual_curtain=None,
                    usual_fan=None) -> list[Plan]:
    """Plan 0 is always the status quo: what the farmer usually does over the
    next hours (learned from previous nights), or "keep as now" if unknown."""
    H = H_FUT
    if usual_curtain is None:
        plans = [Plan("usual", np.full(H, cur_curtain), np.zeros(H))]
    else:
        plans = [Plan("usual", np.asarray(usual_curtain, float),
                      np.asarray(usual_fan if usual_fan is not None else np.zeros(H), float))]
    plans.append(Plan("keep_as_now", np.full(H, cur_curtain), np.zeros(H)))
    for c in CURTAIN_LEVELS:
        plans.append(Plan(f"curtain_{c:.2f}", np.full(H, c), np.zeros(H), {"c": c}))
    # short airing bursts: open for k hours then return to the current setting
    for c in (0.3, 0.5, 0.8):
        for k in (0.5, 1, 2):
            n = int(k * STEPS_PER_HOUR)
            cur = np.full(H, cur_curtain)
            cur[:n] = c
            plans.append(Plan(f"air_{c:.1f}_for_{k}h", cur, np.zeros(H), {"c": c, "hours": k}))
    if has_fan:
        for p in list(plans):
            for k in (1, 2, 6):
                f = np.zeros(H)
                f[:int(k * STEPS_PER_HOUR)] = 1
                plans.append(Plan(p.name + f"+fan_{k}h", p.curtain, f,
                                  dict(p.meta, fan_hours=k)))
    return plans


def advise(forecaster, xh, gh, gf, age_days: float, has_fan: bool, measured_temp=None,
           w_nh3=1.0, w_cold=3.0, w_hot=0.5, w_effort=0.05, w_fan=0.02) -> Advice:
    """xh [L,N,F], gh [L,G], gf [H,G] in real units for ONE house.

    gf carries the weather/clock forecast and, in its curtain/fan columns, the
    farmer's usual plan (status quo)."""
    cur_c = float(gh[-1, CURTAIN])
    plans = candidate_plans(cur_c, has_fan, gf[:, CURTAIN], gf[:, FAN])
    P = len(plans)
    gfs = np.repeat(gf[None], P, 0).copy()
    for i, p in enumerate(plans):
        gfs[i, :, CURTAIN] = p.curtain
        gfs[i, :, FAN] = p.fan
    fc = forecaster.predict(np.repeat(xh[None], P, 0), np.repeat(gh[None], P, 0), gfs)
    nh3, temp = fc["nh3"], fc["temp"]                     # [P,H,N,Q]
    t_lo, t_hi = comfort_temp(age_days)

    # birds live mostly away from the curtain/exhaust sensors; weight comfort by
    # the brooder/centre/drinker zones (indices 0..3)
    zone = np.array([1.0, 1.0, 1.0, 1.0, 0.4, 0.4])
    nh3_pain = np.clip(nh3[..., 2] - NH3_TARGET, 0, None) ** 2      # pessimistic q90
    cold = np.clip(t_lo - temp[..., 1], 0, None) ** 2 * zone
    hot = np.clip(temp[..., 1] - t_hi, 0, None) ** 2 * zone
    danger = np.clip(nh3[..., 1] - NH3_DANGER, 0, None) ** 2      # hard-ish limit
    effort = np.array([np.abs(p.curtain - plans[0].curtain).mean() * 10 + (i > 0)
                       for i, p in enumerate(plans)])
    fanc = np.array([p.fan.sum() / STEPS_PER_HOUR for p in plans])
    cost = (w_nh3 * nh3_pain.mean((1, 2)) + 10 * w_nh3 * danger.mean((1, 2)) + w_cold * cold.mean((1, 2))
            + w_hot * hot.mean((1, 2)) + w_effort * effort + w_fan * fanc)
    bi = int(np.argmin(cost))

    sq_med = nh3[0, ..., 1]                               # status quo [H,N]
    peak = float(sq_med.max())
    worst = NODE_NAMES[int(sq_med.max(0).argmax())]
    over = np.where(sq_med.max(1) >= NH3_WARN)[0]
    hours = float(over[0] + 1) / STEPS_PER_HOUR if len(over) else None
    now = float(xh[-1, :, 0].max())
    level = ("danger" if max(now, peak) >= NH3_DANGER else
             "warn" if max(now, peak) >= NH3_WARN else
             "watch" if peak >= NH3_TARGET else "ok")
    return Advice(status_quo_peak_nh3=peak,
                  status_quo_peak_p90=float(nh3[0, ..., 2].max()),
                  hours_to_warn=hours, worst_node=worst, best=plans[bi],
                  best_peak_nh3=float(nh3[bi, ..., 1].max()),
                  best_min_temp=float((temp[bi, ..., :4, 1]).min()),
                  level=level,
                  costs={p.name: float(c) for p, c in zip(plans, cost)},
                  climate=climate_risks(xh[-1, :, 1], temp[0, ..., 1], xh[-1, :, 2], age_days,
                                        measured_temp),
                  forecast=forecast_curves(nh3, temp, 0, bi))


def forecast_curves(nh3, temp, sq: int, best: int, every: int = 2) -> dict:
    """Compact 6-hour curves (every 20 min) for 'if nothing changes' vs 'follow advice'.

    nh3/temp [P,H,N,Q]. Ammonia: worst node per quantile. Temperature: coldest and
    warmest bird zone (median)."""
    idx = list(range(every - 1, nh3.shape[1], every))

    def curves(p):
        n = nh3[p][idx]                                        # [h,N,Q]
        t = temp[p][idx][:, BIRD_ZONES, 1]                     # [h,4]
        r = lambda a: [round(float(v), 2) for v in a]          # noqa: E731
        return {"nh3_p10": r(n[..., 0].max(1)), "nh3_p50": r(n[..., 1].max(1)),
                "nh3_p90": r(n[..., 2].max(1)), "temp_min": r(t.min(1)),
                "temp_max": r(t.max(1))}
    return {"hours": [round((i + 1) / STEPS_PER_HOUR, 3) for i in idx],
            "status_quo": curves(sq), "plan": curves(best)}
