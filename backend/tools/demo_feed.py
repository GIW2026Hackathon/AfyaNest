"""Fill a running AirNest API with realistic demo data (no hardware needed).

    python tools/demo_feed.py                     # 2 days of history for 2 demo farms
    python tools/demo_feed.py --live              # ...then keep sending every 10 min

Uses the simulator to play the role of the gateways.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from airnest.config import CURTAIN, FAN, NODE_FEATS  # noqa: E402
from airnest.simulator import simulate  # noqa: E402

SLOT = 600
FARMS = [  # device_id, name, lang, has_fan, day of the flock the demo starts at
    ("demo-limuru", "Shamba la Wanjiku (Limuru)", "sw", False, 30),
    ("demo-nakuru", "Kiprono Poultry (Nakuru)", "en", True, 8),
]


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{url} -> HTTP {e.code}: {e.read().decode()[:300]}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--admin-key", default=os.getenv("AIRNEST_ADMIN_KEY", "secret"))
    p.add_argument("--hours", type=int, default=48)
    p.add_argument("--live", action="store_true")
    a = p.parse_args()

    sim = simulate(len(FARMS), 42, seed=2026)
    x, g = sim["x_meas"], sim["g"]
    now = int(time.time())
    t_end = now - now % SLOT
    steps = a.hours * 3600 // SLOT
    for i, (did, name, lang, fan, day) in enumerate(FARMS):
        post(f"{a.api}/api/v1/houses", dict(
            device_id=did, device_key=f"{did}-key", name=name, lang=lang,
            phone=f"+25470000000{i}", has_fan=fan,
            placement_ts=t_end - steps * SLOT - day * 86400), {"X-Admin-Key": a.admin_key})

    def send(i, k, ts):
        did = FARMS[i][0]
        nodes = [dict(node=n, **{f: round(float(x[i, k, n, j]), 2)
                                 for j, f in enumerate(NODE_FEATS)}) for n in range(6)]
        return post(f"{a.api}/api/v1/ingest",
                    dict(device_id=did, ts=ts, nodes=nodes,
                         curtain=round(float(g[i, k, CURTAIN]), 2),
                         fan=float(g[i, k, FAN])),
                    {"X-Device-Key": f"{did}-key"})

    k0 = {i: f[4] * 144 for i, f in enumerate(FARMS)}
    for s in range(steps):
        ts = t_end - (steps - 1 - s) * SLOT
        for i in range(len(FARMS)):
            r = send(i, k0[i] + s, ts)
        if s % 36 == 0:
            print(f"history {s}/{steps}  last reply {r}")
    print("history done")
    s = steps
    while a.live:
        time.sleep(SLOT)
        for i in range(len(FARMS)):
            print(FARMS[i][0], send(i, (k0[i] + s) % x.shape[1], time.time()))
        s += 1


if __name__ == "__main__":
    main()
