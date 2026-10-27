"""Export REAL readings from the AfyaNest database into the training format, so the
forecaster learns how your own houses behave (sim-to-real).

    cd backend
    python tools/export_training_data.py --days 60 --out data/farm.npz
    # train on your farms only:
    python train/train_baseline.py --data data/farm.npz --out models_farm
    # or mix with the simulator (recommended until you have a few months of data):
    python tools/export_training_data.py --days 60 --out data/mix.npz --with-sim data/sim.npz
    python train/train_baseline.py --data data/mix.npz --out models_farm
    # check models_farm/gbm_test.json, then copy gbm.pkl + scaler.json into models/

Only houses with an ammonia sensor and at least --min-days of data are exported (the
forecaster predicts ammonia AND temperature; a temperature-only box would teach it a
fake flat ammonia line). Gaps are filled for the model's input but marked as faults so
they are never used as training targets.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from airnest.config import F_NODE, G_FEATS, N_NODES, NH3  # noqa: E402
from airnest.simulator import LABEL_FAULT  # noqa: E402
from server.pipeline import SLOT, Brain  # noqa: E402
from server.store import Store  # noqa: E402


def house_arrays(store, brain, h, slot0, slot1):
    T = slot1 - slot0 + 1
    x = np.full((T, N_NODES, F_NODE), np.nan, np.float32)
    for r in store.readings_since(h["device_id"], slot0):
        i = r["slot"] - slot0
        if 0 <= i < T and 0 <= r["node"] < N_NODES:
            x[i, r["node"]] = [r["nh3"], r["temp"], r["rh"], r["co2"]]
    lab = np.where(np.isnan(x), LABEL_FAULT, 0).astype(np.int8)
    # CO2 is optional: never a training target
    lab[..., 3] = 0
    # missing nodes copy the house mean, then fill along time
    with np.errstate(all="ignore"):
        house_mean = np.nanmean(x, axis=1, keepdims=True)
    x = np.where(np.isnan(x), house_mean, x)
    for f in range(F_NODE):
        for n in range(N_NODES):
            v = x[:, n, f]
            ok = ~np.isnan(v)
            if not ok.any():
                x[:, n, f] = [5.0, 22.0, 65.0, 1500.0][f]
                continue
            idx = np.where(ok, np.arange(T), 0)
            np.maximum.accumulate(idx, out=idx)
            v = v[idx]
            v[:np.argmax(ok)] = v[np.argmax(ok)]
            x[:, n, f] = v
    # a missing node is only a fault where the house had NO reading at all
    node_seen = (lab == 0).any(0)                                   # [N,F]
    lab = np.where(node_seen[None], lab, 0)
    logs = {r["slot"]: r for r in store.house_log_since(h["device_id"], slot0)}
    g = brain._globals(h, list(range(slot0, slot1 + 1)), logs).astype(np.float32)
    return x, g, lab


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=60)
    p.add_argument("--min-days", type=float, default=3)
    p.add_argument("--out", default="data/farm.npz")
    p.add_argument("--with-sim", help="also include the simulated houses from this .npz")
    a = p.parse_args()

    store = Store()
    brain = Brain(store, os.getenv("AIRNEST_MODELS", "models"))
    slot1 = int(time.time() // SLOT)
    slot0 = slot1 - a.days * 144
    X, G, L, names = [], [], [], []
    for h in store.all_houses():
        rows = store.q("SELECT MIN(slot) a, MAX(slot) b, COUNT(nh3) n FROM readings "
                       "WHERE device_id=? AND slot>=?", (h["device_id"], slot0), one=True)
        if not rows or rows["a"] is None:
            continue
        days = (rows["b"] - rows["a"]) / 144
        if not rows["n"]:
            print(f"skip {h['device_id']}: no ammonia sensor")
            continue
        if days < a.min_days:
            print(f"skip {h['device_id']}: only {days:.1f} days of data")
            continue
        x, g, lab = house_arrays(store, brain, h, rows["a"], rows["b"])
        X.append(x); G.append(g); L.append(lab); names.append(h["device_id"])
        print(f"export {h['device_id']}: {days:.1f} days, "
              f"{(lab[..., NH3] == 0).mean() * 100:.0f}% ammonia coverage")
    if a.with_sim:
        d = np.load(a.with_sim)
        for i in range(len(d["x_meas"])):
            X.append(d["x_meas"][i]); G.append(d["g"][i]); L.append(d["labels"][i])
        print(f"+ {len(d['x_meas'])} simulated houses")
    if not X:
        sys.exit("Nothing to export yet. Let the sensors run for a few days first.")
    T = max(len(x) for x in X)

    def pad(arr, fill_label=False):
        extra = T - len(arr)
        if extra <= 0:
            return arr
        tail = np.repeat(arr[-1:], extra, 0)
        if fill_label:
            tail = np.full_like(tail, LABEL_FAULT)                  # padding is never a target
        return np.concatenate([arr, tail])
    x = np.stack([pad(v) for v in X]).astype(np.float32)
    g = np.stack([pad(v) for v in G]).astype(np.float32)
    lab = np.stack([pad(v, True) for v in L])
    assert g.shape[-1] == G_FEATS
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    np.savez_compressed(a.out, x_meas=x, x_true=x, g=g, labels=lab, houses=np.array(names))
    print(f"wrote {a.out}: {x.shape[0]} houses x {T} slots ({T / 144:.1f} days)")


if __name__ == "__main__":
    main()
