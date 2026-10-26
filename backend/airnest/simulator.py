"""Physics-based simulator of a Kenyan deep-litter broiler house.

Why a simulator: you need months of labelled farm data before the neural networks
are useful. The simulator lets you build and test the whole pipeline today, then
you pre-train on simulated data and fine-tune on real farm data (sim-to-real).

What it models (per sensor node, 1-minute physics, logged every 10 minutes):
  * Ammonia from litter: grows with bird biomass, litter moisture and temperature,
    removed by ventilation (curtain opening, wind, exhaust fan) and node mixing.
  * Litter moisture: droppings and drinker spills wet it, warm dry airflow dries it.
  * Air temperature: bird body heat + charcoal/gas brooder vs. heat loss by airflow.
  * RH and CO2.
  * Highland Kenyan weather: cold nights (10-15 C) and warm days.
  * Farmer behaviour: curtains closed at night to keep birds warm -> ammonia builds up.
    Some randomness in actions so models can learn cause and effect for control.
  * Sensor realism: noise, humidity cross-sensitivity of MQ-137 ammonia sensors.
  * Labelled anomalies: sensor faults (drift, stuck, spikes) and real events
    (drinker leak -> wet litter, brooder heater failure).
"""
from __future__ import annotations

import numpy as np

from .config import (CO2, F_NODE, G_FEATS, NH3, N_NODES, NODES, RH, STEP_MIN,
                     TEMP)

LABEL_OK, LABEL_FAULT, LABEL_EVENT = 0, 1, 2

# Node mixing weights: how strongly each node sees fresh air from ventilation.
_FRESH_W = np.array([0.6, 0.9, 0.9, 0.8, 1.5, 1.2])   # brooder corner is sheltered
_FAN_W = np.array([0.6, 0.8, 1.0, 0.9, 0.9, 1.8])     # exhaust fan at east end
_DROP_W = np.array([1.0, 1.4, 1.4, 1.0, 0.8, 0.8])    # birds crowd near drinkers


def _adjacency(radius: float = 13.0) -> np.ndarray:
    xy = np.array([[x, y] for _, x, y in NODES])
    d = np.linalg.norm(xy[:, None] - xy[None], axis=-1)
    a = ((d < radius) & (d > 0)).astype(float)
    return a / a.sum(1, keepdims=True)


ADJ = _adjacency()


def broiler_weight_kg(age_days):
    """Gompertz growth curve for a modern broiler (~2.5 kg at day 42)."""
    return 0.042 + 3.6 * np.exp(-np.exp(-0.052 * (age_days - 30.0)))


def simulate(n_houses: int = 32, days: int = 42, seed: int = 0,
             anomalies: bool = True, policy=None, start_day: float = 0.0) -> dict:
    """Simulate `n_houses` independent broiler cycles. Vectorised across houses.

    Returns a dict with
      x_true  [H, T, N, F]   true node air state
      x_meas  [H, T, N, F]   what the sensors report
      g       [H, T, G]      house covariates (weather, clock, age, controls)
      labels  [H, T, N, F]   0 ok, 1 sensor fault, 2 real event
      meta    dict of per-house parameters

    policy: optional callable(t, x_hist [Hh,t,N,F], g_hist [Hh,t,G]) ->
            (curtain [Hh], fan [Hh]) overriding the farmer (NaN = farmer decides).
            Random draws do not depend on the state, so a run with a policy sees
            exactly the same weather/events as the run without -> fair A/B test.
    """
    rng = np.random.default_rng(seed)
    Hh, N = n_houses, N_NODES
    T = days * 24 * 60 // STEP_MIN
    sub = STEP_MIN                        # 1-minute physics sub-steps

    # ---------------- per-house parameters ----------------
    n_birds = rng.integers(300, 5001, Hh).astype(float)
    density = rng.uniform(8.0, 13.0, Hh)                 # birds / m2
    t_mean = rng.uniform(14.0, 22.0, Hh)                 # Limuru..Machakos range
    t_amp = rng.uniform(4.5, 8.0, Hh)
    has_fan = rng.random(Hh) < 0.4
    cold_thresh = rng.uniform(16.0, 21.0, Hh)            # farmer closes below this
    careful = rng.random(Hh)                             # 0 careless .. 1 careful
    leak_tight = rng.uniform(0.010, 0.025, Hh)           # air exchange closed (/min)
    curtain_ach = rng.uniform(0.12, 0.25, Hh)            # extra /min when fully open
    fan_ach = rng.uniform(0.06, 0.12, Hh)
    heater_power = rng.uniform(0.35, 0.6, Hh)           # deg C / min at brooder
    sensor_gain = rng.normal(1.0, 0.06, (Hh, N))         # unit-to-unit calibration

    # ---------------- state ----------------
    M = rng.uniform(0.22, 0.30, (Hh, N))                 # litter moisture fraction
    C = np.full((Hh, N), 2.0)                            # NH3 ppm
    Ti = (t_mean + 4)[:, None] * np.ones((Hh, N))
    RHi = np.full((Hh, N), 65.0)
    CO = np.full((Hh, N), 600.0)
    t_noise = np.zeros(Hh)
    wind = np.ones(Hh)

    x_true = np.zeros((Hh, T, N, F_NODE), np.float32)
    g = np.zeros((Hh, T, G_FEATS), np.float32)
    leak_until = np.full((Hh, N), -1)
    heater_fail_until = np.full(Hh, -1)
    ev_labels = np.zeros((Hh, T, N, F_NODE), np.int8)

    curtain = np.full(Hh, 0.5)
    fan = np.zeros(Hh)
    explore_curtain = np.full(Hh, np.nan)
    fan_until = np.full(Hh, -1)
    next_litter = rng.integers(5, 10, Hh) * 144

    for t in range(T):
        minute = t * STEP_MIN
        hour = (minute / 60.0) % 24
        age = minute / 1440.0
        wt = broiler_weight_kg(age)
        dens = (density / 10.0) * (wt / 1.5)             # ~1 at day 30

        # weather (cold nights, warm afternoons, AR noise, daily wind)
        if t % 144 == 0:
            wind = rng.uniform(0.5, 1.5, Hh)
            rainy = rng.random(Hh) < 0.25
        t_noise = 0.97 * t_noise + rng.normal(0, 0.25, Hh)
        t_out = t_mean + t_amp * np.cos(2 * np.pi * (hour - 15) / 24) + t_noise
        rh_out = np.clip(75 - 3.0 * (t_out - t_mean) + 12 * rainy, 30, 100)

        # ---- farmer behaviour (+ exploration so control effects are learnable) ----
        night = (hour >= 19) | (hour < 7)
        if t % 36 == 0:                                   # re-decide every 6 h
            explore = rng.random(Hh) < 0.15
            explore_curtain = np.where(
                explore, rng.choice([0.0, 0.1, 0.25, 0.5, 1.0], Hh), np.nan)
        young = age < 14
        cold = t_out < cold_thresh
        night_c = np.where(cold | young, 0.03 + 0.15 * (careful > 0.7), 0.3)
        day_c = np.clip((t_out - 14) / 10, 0.2, 1.0) * np.where(young, 0.5, 1.0)
        target_c = np.where(night, night_c, day_c)
        target_c = np.where(np.isnan(explore_curtain), target_c, explore_curtain)
        curtain = curtain + 0.5 * (target_c - curtain)    # people adjust gradually

        if t % 12 == 0:                                   # fan decisions every 2 h
            start = has_fan & (fan_until < t) & (rng.random(Hh) < 0.12)
            fan_until = np.where(start, t + rng.integers(6, 19, Hh), fan_until)
        fan = (has_fan & (fan_until >= t)).astype(float)
        if policy is not None and age >= start_day:
            oc, of = policy(t, x_true[:, :t], g[:, :t])
            curtain = np.where(np.isnan(oc), curtain, oc)
            fan = np.where(np.isnan(of), fan, of)

        heater_on = ((age < 14) & (night | (t_out < 18))) | ((age < 21) & night & cold)
        heater_on = heater_on.astype(float)

        # litter management (hidden from the sensors)
        litter = t >= next_litter
        M = np.where(litter[:, None], np.maximum(M - 0.12, 0.2), M)
        next_litter = np.where(litter, t + rng.integers(5, 11, Hh) * 144, next_litter)

        # ---- real events ----
        if anomalies:
            new_leak = rng.random((Hh, N)) < 0.00008      # ~3 leaks per house per cycle
            leak_until = np.where(new_leak & (leak_until < t),
                                  t + rng.integers(24, 73, (Hh, N)), leak_until)
            new_hf = (rng.random(Hh) < 0.0006) & (heater_on > 0)
            heater_fail_until = np.where(new_hf & (heater_fail_until < t),
                                         t + rng.integers(12, 37, Hh), heater_fail_until)
        leaking = leak_until >= t
        heater_failed = heater_fail_until >= t
        heat_actual = heater_on * (~heater_failed)

        # ---- 1-minute physics ----
        r = (leak_tight * wind)[:, None] * np.ones(N)
        r = r + (curtain * curtain_ach * wind)[:, None] * _FRESH_W
        r = r + (fan * fan_ach)[:, None] * _FAN_W
        for _ in range(sub):
            emis = (0.45 * dens[:, None] * _DROP_W
                    * (0.2 + 4.0 * np.maximum(M - 0.2, 0)) / 0.8
                    * np.exp(0.08 * (Ti - 20.0)) * (0.4 + age / 50.0))
            mix_c = (ADJ @ C.T).T - C
            C = C + emis - r * (C - 0.5) + 0.05 * mix_c
            C = np.maximum(C, 0.0)

            dry = 0.006 * (r + 0.01) * np.clip(1.08 - RHi / 100, 0, 1) * (M - 0.12)
            M = np.clip(M + 6e-5 * dens[:, None] * _DROP_W - dry + 0.003 * leaking,
                        0.12, 0.8)

            bird_heat = 0.2 * dens[:, None] * np.ones(N)
            heat = np.zeros((Hh, N))
            heat[:, 0] = heater_power * heat_actual
            heat[:, 3] = 0.25 * heater_power * heat_actual   # some spill to centre
            mix_t = (ADJ @ Ti.T).T - Ti
            Ti = Ti + bird_heat + heat + (r + 0.004) * (t_out[:, None] - Ti) + 0.012 * mix_t

            rh_tgt = (rh_out[:, None] * np.exp(-0.06 * (Ti - t_out[:, None]))
                      + 20 * (M - 0.25) + 0.3 * dens[:, None] / (r + 0.02))
            RHi = RHi + 0.05 * (np.clip(rh_tgt, 20, 100) - RHi)

            CO = CO + 42 * dens[:, None] * np.ones(N) + 30 * heat_actual[:, None] \
                - r * (CO - 420)

        x_true[:, t, :, NH3] = C
        x_true[:, t, :, TEMP] = Ti
        x_true[:, t, :, RH] = RHi
        x_true[:, t, :, CO2] = CO
        g[:, t] = np.stack([t_out, rh_out,
                            np.full(Hh, np.sin(2 * np.pi * hour / 24)),
                            np.full(Hh, np.cos(2 * np.pi * hour / 24)),
                            np.full(Hh, age), curtain, fan, heater_on], -1)
        ev_labels[:, t, :, NH3] = np.where(leaking, LABEL_EVENT, 0)
        ev_labels[:, t, :, RH] = np.where(leaking, LABEL_EVENT, 0)
        ev_labels[:, t, 0, TEMP] = np.where(heater_failed, LABEL_EVENT, 0)

    x_meas, labels = _sensor_model(x_true, sensor_gain, rng, anomalies)
    labels = np.maximum(labels, ev_labels)
    meta = dict(n_birds=n_birds, density=density, t_mean=t_mean, has_fan=has_fan,
                careful=careful)
    return dict(x_true=x_true, x_meas=x_meas, g=g, labels=labels, meta=meta)


def _sensor_model(x, gain, rng, anomalies):
    """Turn true air state into realistic, sometimes faulty, sensor readings."""
    Hh, T, N, F = x.shape
    m = x.copy()
    labels = np.zeros(x.shape, np.int8)
    # MQ-137 style ammonia: gain error, humidity cross-sensitivity, noise
    m[..., NH3] = (x[..., NH3] * gain[:, None, :] * (1 + 0.008 * (x[..., RH] - 60))
                   + rng.normal(0, 1, (Hh, T, N)) * (0.5 + 0.05 * x[..., NH3]))
    m[..., TEMP] += rng.normal(0, 0.2, (Hh, T, N))
    m[..., RH] += rng.normal(0, 1.5, (Hh, T, N))
    m[..., CO2] += rng.normal(0, 30, (Hh, T, N))

    if anomalies and T > 800:                           # faults need room in the series
        for h in range(Hh):
            for _ in range(rng.poisson(4)):              # sensor faults per cycle
                n, f = rng.integers(N), rng.choice([NH3, NH3, TEMP, RH])
                t0 = rng.integers(200, T - 400)
                kind = rng.choice(["drift", "stuck", "spikes"])
                if kind == "drift" and f == NH3:
                    dur = rng.integers(144, 432)
                    m[h, t0:t0 + dur, n, f] += np.linspace(0, rng.uniform(8, 20), dur)
                elif kind == "spikes":
                    dur = rng.integers(6, 36)
                    idx = t0 + rng.choice(dur, max(2, dur // 3), replace=False)
                    m[h, idx, n, f] += rng.uniform(15, 60, len(idx)) * (1 if f == NH3 else 0.5)
                    labels[h, idx, n, f] = LABEL_FAULT
                    continue
                else:
                    dur = rng.integers(36, 144)
                    m[h, t0:t0 + dur, n, f] = m[h, t0, n, f]
                labels[h, t0:t0 + dur, n, f] = LABEL_FAULT
    m[..., NH3] = np.clip(m[..., NH3], 0, 300)
    m[..., RH] = np.clip(m[..., RH], 0, 100)
    return m.astype(np.float32), labels


if __name__ == "__main__":
    import argparse
    import time
    p = argparse.ArgumentParser()
    p.add_argument("--houses", type=int, default=32)
    p.add_argument("--days", type=int, default=42)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", default="data/sim.npz")
    a = p.parse_args()
    t0 = time.time()
    d = simulate(a.houses, a.days, a.seed)
    import os
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    np.savez_compressed(a.out, x_true=d["x_true"], x_meas=d["x_meas"], g=d["g"],
                        labels=d["labels"], **{f"meta_{k}": v for k, v in d["meta"].items()})
    print(f"simulated {a.houses} houses x {a.days} days in {time.time() - t0:.1f}s -> {a.out}")
