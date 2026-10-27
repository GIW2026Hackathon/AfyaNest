"""End-to-end tests: simulator -> service -> AI -> SMS.

Run: python -m pytest tests -q   (or: python tests/test_system.py)"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["AIRNEST_DRY_RUN"] = "1"
os.environ["AIRNEST_ENV"] = "dev"
os.environ["AIRNEST_NO_APP"] = "1"
os.environ.setdefault("AIRNEST_DATA_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")

import time  # noqa: E402

import numpy as np  # noqa: E402

from airnest.config import CURTAIN, FAN, H_FUT, L_HIST, NODE_FEATS  # noqa: E402
from airnest.controller import advise  # noqa: E402
from airnest.forecasters import load_forecaster  # noqa: E402
from airnest.simulator import simulate  # noqa: E402
from server import notify  # noqa: E402
from server.schemas import HouseIn, IngestIn, IngestReply  # noqa: E402
from server.service import AirNestService, ServiceError  # noqa: E402
from server.pipeline import SLOT  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _db import fresh_db  # noqa: E402

MODELS = os.path.join(ROOT, "models")
SIM = simulate(2, 42, seed=777)


def test_simulator_shapes_and_physics():
    x, g = SIM["x_true"], SIM["g"]
    assert x.shape == (2, 42 * 144, 6, 4) and np.isfinite(x).all()
    # ammonia is higher on closed (night) than open (day) late in the cycle
    late = g[..., 4] > 30
    closed, open_ = late & (g[..., CURTAIN] < 0.15), late & (g[..., CURTAIN] > 0.6)
    assert x[..., 0].mean(-1)[closed].mean() > 2 * x[..., 0].mean(-1)[open_].mean()


def test_forecaster_and_controller():
    fc, _ = load_forecaster(MODELS)
    x, g = SIM["x_meas"], SIM["g"]
    t = 35 * 144 + 21 * 6                      # day 35, 21:00
    out = fc.predict(x[:1, t - L_HIST:t], g[:1, t - L_HIST:t], g[:1, t:t + H_FUT])
    assert out["nh3"].shape == (1, H_FUT, 6, 3)
    assert (np.diff(out["nh3"], axis=-1) >= -1e-6).all()          # q10<=q50<=q90
    adv = advise(fc, x[0, t - L_HIST:t], g[0, t - L_HIST:t], g[0, t:t + H_FUT], 35, True)
    assert adv.best_peak_nh3 <= adv.status_quo_peak_nh3 + 1e-6 or adv.level == "ok"
    assert adv.level in ("ok", "watch", "warn", "danger")


def _svc(tmp_path):
    target, connect = fresh_db(tmp_path)
    return AirNestService(target, MODELS, admin_key="admin-key-123", connect=connect)


def _upload(svc, device_id, key, **kw):
    return svc.ingest(IngestIn(device_id=device_id, **kw), key)


def test_service_end_to_end(tmp_path):
    svc = _svc(tmp_path)
    t_start_day = 33
    now = int(time.time()) - 2 * 86400
    t0_real = now - now % SLOT
    tid = svc.store.create_tenant("Wanjiku Farms")
    svc.register_house(tid, HouseIn(
        device_id="h1", device_key="device-key-1", name="Shamba la Wanjiku",
        phone="+254700000001", tech_phone="+254700000002", lang="sw",
        placement_ts=t0_real - t_start_day * 86400, has_fan=True))
    for bad in (None, "wrong-key-000"):
        try:
            _upload(svc, "h1", bad)
            raise AssertionError("unauthenticated upload accepted")
        except ServiceError as e:
            assert e.status == 401

    x, g = SIM["x_meas"][0], SIM["g"][0]
    notify.SENT.clear()
    levels = []
    start = t_start_day * 144
    for k in range(start, start + 2 * 144):        # two days of uploads
        nodes = [dict(node=n, **{f: float(x[k, n, i]) for i, f in enumerate(NODE_FEATS)})
                 for n in range(6)]
        r = _upload(svc, "h1", "device-key-1", ts=t0_real + (k - start) * SLOT, nodes=nodes,
                    curtain=float(g[k, CURTAIN]), fan=float(g[k, FAN]))
        IngestReply(**r)                            # reply matches the API schema
        levels.append(r["level"])
    peak = x[start:start + 288, :, 0].max()
    if peak > 25:                                   # dangerous nights must produce SMS
        assert any("AfyaNest" in m for _, m in notify.SENT)
        assert any(lv in ("warn", "danger") for lv in levels)
    assert len(notify.SENT) < 60                    # rate limited: no SMS flood

    st = svc.status("h1", "device-key-1")
    assert st["advice"]["model"] in ("gbm_baseline", "ammonianet")
    assert "plan" in st["advice"] and st["readings"]
    fc = st["advice"]["forecast"]
    assert len(fc["hours"]) == len(fc["plan"]["nh3_p50"]) == len(fc["status_quo"]["temp_min"])

    # dashboard endpoints for the React frontend (tenant scoped)
    hs = svc.list_houses(tid)
    assert hs[0]["device_id"] == "h1" and "device_key" not in hs[0]
    assert "•" in hs[0]["phone"]                     # phone masked in the list
    hist = svc.history(tid, "h1", 72)
    assert len(hist["readings"]) == 288 * 6 and hist["alerts"] and hist["controls"]
    other = svc.store.create_tenant("Someone else")
    for fn in (lambda: svc.history(other, "h1", 24), lambda: svc.house_detail(other, "h1")):
        try:
            fn()
            raise AssertionError("cross-tenant read allowed")
        except ServiceError as e:
            assert e.status == 404
    assert svc.list_houses(other) == []

    # farmer reports curtain by SMS and asks for status
    n = len(notify.SENT)
    svc.incoming_sms("+254700000001", "PAZIA 40")
    svc.incoming_sms("+254700000001", "hali")
    assert "40%" in notify.SENT[n][1] and "amonia" in notify.SENT[n + 1][1].lower(), notify.SENT[n:]


def test_warmup_and_validation(tmp_path):
    svc = _svc(tmp_path)
    svc.register_house(svc.store.create_tenant("T"), HouseIn(
        device_id="h2", device_key="device-key-2", name="Test", phone="+254700000009"))
    notify.SENT.clear()
    # a brand-new house with a dangerous reading gets a threshold alert immediately
    r = _upload(svc, "h2", "device-key-2",
                nodes=[dict(node=0, nh3_ppm=40.0, temp_c=20, rh_pct=80)])
    assert r["level"] == "danger" and r["buzzer"] == 1
    assert notify.SENT and "40ppm" in notify.SENT[-1][1]
    # schema validation rejects bad input before it reaches the AI
    from pydantic import ValidationError
    for bad in (dict(device_id="h2", nodes=[dict(node=9)]),
                dict(device_id="h2", nodes=[dict(node=0, rh_pct=150)]),
                dict(device_id="h2", curtain=2)):
        try:
            IngestIn(**bad)
            raise AssertionError(f"accepted {bad}")
        except ValidationError:
            pass
    try:
        HouseIn(device_id="x", device_key="short", name="n", phone="0712")
        raise AssertionError("accepted bad house")
    except ValidationError:
        pass


def test_climate_alerts():
    from airnest.controller import Plan, climate_risks
    from server import messages
    H = H_FUT
    # day-5 chicks need 30-34 C; brooder forecast to fall to 22 C in 3 h -> cold danger
    now = np.full(6, 29.0)
    fc = np.tile(np.linspace(29, 22, H)[:, None], (1, 6))
    r = climate_risks(now, fc, np.full(6, 60.0), age_days=5)
    assert r and r[0]["kind"] == "cold" and r[0]["level"] == "danger"
    sms = messages.climate_sms("Shamba", r[0], Plan("usual", np.zeros(H), np.zeros(H)), 0.1, "sw")
    assert "Baridi" in sms and "brooder" in sms and len(sms) <= 320
    # day-35 birds (18-24 C) at 31 C in humid air -> heat danger
    r = climate_risks(np.full(6, 31.0), np.full((H, 6), 31.0), np.full(6, 80.0), age_days=35)
    assert r[0]["kind"] == "heat" and r[0]["level"] == "danger"
    assert "Heat stress" in messages.climate_sms("Farm", r[0], Plan("usual", np.zeros(H),
                                                  np.zeros(H)), 0.5, "en")
    # comfortable -> no alert
    assert climate_risks(np.full(6, 21.0), np.full((H, 6), 21.0), np.full(6, 60.0), 35) == []


if __name__ == "__main__":                       # works without pytest too
    import pathlib
    import tempfile
    import time
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            if "tmp_path" in fn.__code__.co_varnames[:fn.__code__.co_argcount]:
                with tempfile.TemporaryDirectory() as d:
                    fn(pathlib.Path(d))
            else:
                fn()
            print(f"PASS {name} ({time.time() - t:.1f}s)")
