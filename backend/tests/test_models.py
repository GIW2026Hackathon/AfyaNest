"""The three models + synthetic data feed.

Run: python tests/test_models.py   (AIRNEST_TEST_DATABASE_URL=... to run on PostgreSQL)
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["AIRNEST_DRY_RUN"] = "1"
os.environ["AIRNEST_ENV"] = "dev"
os.environ["AIRNEST_NO_APP"] = "1"
os.environ.setdefault("AIRNEST_DATA_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")

from _db import fresh_db  # noqa: E402
from server import kenya, notify, osint  # noqa: E402
from server.pipeline import SLOT, next_check_in  # noqa: E402
from server.schemas import HouseIn, IngestIn  # noqa: E402
from server.service import AirNestService  # noqa: E402

MODELS = os.path.join(ROOT, "models")
NOW = time.time()


def rss(items):
    body = "".join(
        f"<item><title>{t}</title><link>{link}</link>"
        f"<pubDate>{time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime(NOW - age * 86400))}</pubDate>"
        f"<description>{d}</description><source url=\"https://{dom}\">{dom}</source></item>"
        for t, link, d, dom, age in items)
    return f"<?xml version='1.0'?><rss><channel>{body}</channel></rss>".encode()


FEED = rss([
    ("Ministry confirms Newcastle disease outbreak in Kiambu, farmers urged to vaccinate chickens",
     "https://www.kilimo.go.ke/news/ncd-kiambu", "Veterinary officers in Kiambu county reported deaths of poultry.",
     "www.kilimo.go.ke", 2),
    ("Thika farmers count losses as Newcastle disease kills chickens", "https://www.the-star.co.ke/x1",
     "Hundreds of birds died in Thika", "www.the-star.co.ke", 1),
    ("Chickens dying in Nakuru, farmers suspect bird flu", "https://blog.example.com/nakuru",
     "Unconfirmed reports of poultry deaths in Nakuru county", "blog.example.com", 3),
    ("Newcastle United beat Arsenal in Premier League thriller", "https://sport.example.com/nufc",
     "Football", "sport.example.com", 1),
    ("Bird flu outbreak confirmed in Uganda's Wakiso district", "https://www.reuters.com/uganda",
     "Avian influenza H5N1 in poultry", "www.reuters.com", 2),
    ("Old Gumboro outbreak in Meru chickens", "https://www.nation.africa/old", "poultry", "www.nation.africa", 90),
])


def svc_for(tmp):
    target, connect = fresh_db(tmp)
    return AirNestService(target, MODELS, "admin-key-123", connect=connect)


def house(svc, tid, did, lat, lon, source="live", sms_test=False, phone="+254711000001"):
    svc.register_house(tid, HouseIn(device_id=did, name=did, phone=phone, lat=lat, lon=lon,
                                    source=source, sms_test=sms_test,
                                    placement_ts=int(NOW - 20 * 86400)))


def test_classify():
    c = osint.classify("Newcastle disease outbreak kills chickens in Nakuru")
    assert c["disease"] == "newcastle" and c["counties"] == ["Nakuru"] and c["scope"] == "county"
    assert osint.classify("Newcastle United win again in Premier League") is None
    assert osint.classify("Bird flu confirmed in Uganda poultry")["scope"] == "regional"
    assert osint.classify("Maize prices rise in Kenya") is None
    assert osint.classify("Kuku wanakufa kwa mdondo Kiambu")["disease"] == "newcastle"
    assert kenya.county_of(-1.10, 36.64) == "Kiambu" and "Nairobi" in kenya.nearby("Kiambu")


def test_outbreak_watch_rules(tmp_path):
    svc = svc_for(tmp_path)
    t1 = svc.store.create_tenant("Coop Kiambu")
    t2 = svc.store.create_tenant("Coop Mombasa")
    house(svc, t1, "kb-live", -1.10, 36.64, "live", phone="+254711000001")          # Kiambu
    house(svc, t1, "kb-synth", -1.05, 36.90, "synthetic", phone="+254711000002")    # Kiambu, no TEST
    house(svc, t1, "nk-live", -0.30, 36.10, "live", phone="+254711000003")          # Nakuru
    house(svc, t2, "mb-live", -4.04, 39.66, "live", phone="+254711000004")          # Mombasa
    w = osint.OutbreakWatch(svc.store, fetch=lambda url: FEED, sources=[{"name": "fixture", "url": "x"}])
    notify.SENT.clear()
    r = w.run(NOW)
    assert r["items"] == 6 and r["sources_ok"] == 1
    sigs = {(s["disease"], s["county"]): s for s in w.for_tenant(t1, NOW)}
    ncd = sigs[("newcastle", "Kiambu")]
    assert ncd["official"] and ncd["confidence"] >= 0.8 and ncd["status"] == "auto_sent"
    # official + confident: Kiambu farmer texted, synthetic house logged but NOT texted
    phones = [p for p, _ in notify.SENT]
    assert "+254711000001" in phones and "+254711000002" not in phones
    assert any("mdondo" in m for _, m in notify.SENT)                  # Kiswahili advice
    assert "+254711000004" not in phones                                 # Mombasa untouched
    # unofficial bird-flu rumour in Nakuru: waits for a human
    bf = sigs[("avian_influenza", "Nakuru")]
    assert bf["status"] == "pending" and not bf["official"]
    assert "+254711000003" not in phones
    # football and stale items ignored; Uganda never reaches Kenyan farmers automatically
    assert not any(s["disease"] == "gumboro" for s in sigs.values())
    assert w.for_tenant(t2, NOW) == []
    # manager approves the rumour -> Nakuru farmer texted once, never twice
    n = svc.outbreak_decide(t1, bf["id"], True, "u_test")["sent"]
    assert n >= 1 and "+254711000003" in [p for p, _ in notify.SENT]
    before = len(notify.SENT)
    svc.outbreak_decide(t1, bf["id"], True, "u_test")
    w.run(NOW)
    assert len(notify.SENT) == before
    # news text never ends up in an SMS
    assert not any("Hundreds" in m or "Thika farmers" in m for _, m in notify.SENT)


def test_feed_safety():
    for bad in (b"<?xml version='1.0'?><!DOCTYPE x [<!ENTITY a 'b'>]><rss/>", b"x" * (osint.MAX_BYTES + 1)):
        try:
            osint.check_xml(bad)
            raise AssertionError("unsafe feed accepted")
        except ValueError:
            pass
    try:
        osint._safe_fetch("http://example.com/feed")
        raise AssertionError("plain http accepted")
    except ValueError:
        pass
    items = osint.parse_feed(rss([("x <b>bold</b>", "javascript:alert(1)", "", "a.b", 1)]))
    assert items == []                                    # non-http links dropped


def test_synthetic_feed_and_go_live(tmp_path):
    svc = svc_for(tmp_path)
    tid = svc.store.create_tenant("Synth farm")
    key = svc.register_house(tid, HouseIn(device_id="sy-1", name="Synthetic house",
                                          phone="+254711000009", source="synthetic",
                                          placement_ts=int(NOW - 3 * 86400)))["device_key"]
    notify.SENT.clear()
    n = svc.synthetic.tick(NOW, backfill_slots=30)
    assert n == 30
    rows = svc.store.q("SELECT COUNT(*) c, MIN(flags) f FROM readings WHERE device_id='sy-1'", one=True)
    assert rows["c"] == 30 * 6 and rows["f"] & 256
    adv = svc.house_detail(tid, "sy-1")
    assert adv["source"] == "synthetic" and adv["advice"]["data_mode"] == "synthetic"
    assert notify.SENT == []                              # synthetic data never texts the farmer
    # second tick only refreshes the current slot
    assert svc.synthetic.tick(NOW + 5, backfill_slots=30) == 1
    # a real gateway speaks -> house goes live, simulated history removed
    svc.ingest(IngestIn(device_id="sy-1", nodes=[{"node": 0, "temp_c": 30, "rh_pct": 60}]), key)
    h = svc.house_detail(tid, "sy-1")
    assert h["source"] == "live"
    assert svc.store.q("SELECT COUNT(*) c FROM readings WHERE device_id='sy-1'", one=True)["c"] == 1
    assert svc.synthetic.tick(NOW + 70, backfill_slots=30) == 0


def test_synthetic_test_sms_opt_in(tmp_path):
    svc = svc_for(tmp_path)
    tid = svc.store.create_tenant("T")
    # day-1 chicks in a cool simulated house: cold alerts are likely; opt in to TEST SMS
    svc.register_house(tid, HouseIn(device_id="sy-2", name="Test SMS", phone="+254711000010",
                                    source="synthetic", sms_test=True, placement_ts=int(NOW - 86400)))
    notify.SENT.clear()
    svc.synthetic.tick(NOW, backfill_slots=24)
    hist = svc.history(tid, "sy-2", 24)
    sent = [a for a in hist["alerts"] if a["delivered"]]
    assert all(m.startswith("TEST: ") for _, m in notify.SENT)
    assert len(sent) == len(notify.SENT) <= 3             # only the live slot may text, never back-fill


def test_check_in_prediction():
    fc = {"hours": [i / 3 for i in range(1, 19)],
          "status_quo": {"nh3_p50": [10] * 6 + [22] * 12, "temp_min": [24] * 18, "temp_max": [26] * 18}}
    c = next_check_in(fc, NOW, (21, 25), True)
    assert c["reason"] == "ammonia" and abs(c["in_hours"] - 1.83) < 0.01 and c["local"]
    c = next_check_in(fc, NOW, (21, 25), False)          # no ammonia sensor: ignore NH3
    assert c["reason"] == "stable" and c["local"] is None
    cold = dict(fc, status_quo=dict(fc["status_quo"], temp_min=[24] * 3 + [17] * 15))
    assert next_check_in(cold, NOW, (21, 25), False)["reason"] == "cold"


if __name__ == "__main__":
    import pathlib
    import tempfile
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            if fn.__code__.co_argcount:
                with tempfile.TemporaryDirectory() as d:
                    fn(pathlib.Path(d))
            else:
                fn()
            print(f"PASS {name} ({time.time() - t:.1f}s)")
