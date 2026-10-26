import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402

from airnest.simulator import simulate  # noqa: E402


def ensure_data(path, houses=64, days=42, seed=0):
    """Load simulated (or real, same format) data; simulate it if missing."""
    if not os.path.exists(path):
        print(f"{path} not found -> simulating {houses} houses x {days} days ...")
        d = simulate(houses, days, seed)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        np.savez_compressed(path, x_true=d["x_true"], x_meas=d["x_meas"], g=d["g"],
                            labels=d["labels"])
    d = np.load(path)
    return d["x_meas"], d["g"], d["labels"]
