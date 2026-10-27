"""Operator console: staff register farmers, SMS/voice outbox, test farmers - and attacks.

Run: python tests/test_console.py   (AIRNEST_TEST_DATABASE_URL=... for PostgreSQL)
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

from fastapi.testclient import TestClient  # noqa: E402

from _db import fresh_db  # noqa: E402
from server import notify  # noqa: E402
from server.main import create_app  # noqa: E402
from server.security import hash_password  # noqa: E402

MODELS = os.path.join(ROOT, "models")
PW = "Green-pasture-42"
PHONE = "+254711500001"


def setup(tmp, sms_token=None):
    target, connect = fresh_db(tmp)
    old = os.environ.get("AIRNEST_SMS_TOKEN")
    if sms_token:
        os.environ["AIRNEST_SMS_TOKEN"] = sms_token
    try:
        app = create_app(target, MODELS, "admin-key-123", connect=connect)
    finally:
        if sms_token:
            os.environ.pop("AIRNEST_SMS_TOKEN")
            if old:
                os.environ["AIRNEST_SMS_TOKEN"] = old
    st = app.state.svc.store
    tid = st.create_tenant("AfyaNest Operations")
    st.create_user(tid, "ops@afyanest.test", "Ops Lead", hash_password(PW), "owner")
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"email": "ops@afyanest.test", "password": PW})
    c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return c, app.state.svc, tid


def add_farmer(c, name="Mary Wanjiku", phone=PHONE, county="Kiambu", test=True, **kw):
    r = c.post("/api/v1/farmers", json=dict(name=name, phone=phone, county=county, test=test, **kw))
    assert r.status_code == 200, r.text
    return r.json()


def test_signup_is_closed(tmp_path):
    c, _, _ = setup(tmp_path)
    r = TestClient(c.app).post("/api/v1/auth/signup", json=dict(
        org_name="Evil Org", name="Eve Hacker", email="eve@example.com", password=PW))
    assert r.status_code == 403


def test_staff_registration(tmp_path):
    c, svc, tid = setup(tmp_path)
    r = add_farmer(c, n_birds=350, age_weeks=2, device_id="an-box-0007")
    assert r["device_id"] == "AN-BOX-0007" and len(r["device_key"]) >= 24       # key shown once
    f = svc.store.farmer_by_phone(PHONE, tid)
    assert f["name"] == "Mary Wanjiku" and f["county"] == "Kiambu" and f["sandbox"]
    assert f["registered_via"] == "console"
    h = svc.store.houses_for_farmer(f["id"])[0]
    assert h["source"] == "synthetic" and h["sandbox"] and h["n_birds"] == 350
    assert 13 <= svc._age(h) <= 15
    # the box key works for the real sensor and flips the house live
    # welcome SMS goes to the (test) phone right away
    inbox = c.get("/api/v1/sandbox/inbox", params={"phone": PHONE}).json()
    assert inbox and inbox[0]["kind"] == "welcome" and "Karibu Mary" in inbox[0]["text"]
    # the same box cannot be sold twice; bad box IDs are refused
    assert c.post("/api/v1/farmers", json={"name": "John Kip", "phone": "+254711500002", "county": "Nakuru",
                                           "device_id": "AN-BOX-0007"}).status_code == 409
    assert c.post("/api/v1/farmers", json={"name": "John Kip", "phone": "+254711500002", "county": "Nakuru",
                                           "device_id": "../etc"}).status_code == 422
    # no USSD any more
    assert c.post("/api/v1/sandbox/ussd", json={"phone": PHONE, "text": ""}).status_code in (404, 405)
    assert c.post("/api/v1/ussd", data={"phoneNumber": PHONE, "text": ""}).status_code in (404, 405)


def test_reply_stop_and_outbox(tmp_path):
    c, svc, tid = setup(tmp_path)
    did = add_farmer(c, n_birds=350)["device_id"]
    svc.synthetic.tick(time.time(), backfill_slots=24)                  # history, never texted
    inbox = c.get("/api/v1/sandbox/inbox", params={"phone": PHONE}).json()
    assert all(m["status"] in ("held", "sandbox") for m in inbox)
    r = c.post("/api/v1/sandbox/sms", json={"phone": PHONE, "text": "HALI"}).json()
    assert "Banda la Mary" in r["reply"]
    # danger scenario -> SMS + voice call on the test phone, nothing on the real network
    notify.SENT.clear(); notify.CALLS.clear()
    res = c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "cold"}).json()
    assert res["level"] == "danger"
    inbox = c.get("/api/v1/sandbox/inbox", params={"phone": PHONE}).json()
    chans = {(m["channel"], m["status"]) for m in inbox if m["ts"] >= time.time() - 60}
    assert ("sms", "sandbox") in chans and ("voice", "sandbox") in chans
    assert notify.SENT == [] and notify.CALLS == []
    # STOP: farmer opts out, alerts are held as opted_out; START restores
    c.post("/api/v1/sandbox/sms", json={"phone": PHONE, "text": "STOP"})
    c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "heat"})
    newest = c.get("/api/v1/sandbox/inbox", params={"phone": PHONE}).json()[:4]
    assert any(m["kind"] == "climate" and m["status"] == "opted_out" for m in newest)
    c.post("/api/v1/sandbox/sms", json={"phone": PHONE, "text": "ANZA"})
    assert svc.store.farmer_by_phone(PHONE, tid)["status"] == "active"


def test_automatic_response_and_escalation(tmp_path):
    c, svc, tid = setup(tmp_path)
    did = add_farmer(c, n_birds=300, backup_phone="+254711500099", has_fan=True, has_heater=True,
                     has_curtain=True)["device_id"]
    svc.synthetic.tick(time.time(), backfill_slots=24)
    # cold night: the box switches the heater on and closes the curtains by itself
    res = c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "cold"}).json()
    assert res["level"] == "danger"
    r = res["reply"]
    assert r["heater"] == 1 and r["fan"] == 0 and r["curtain"] <= 10 and r["buzzer"] == 1
    assert r["tlo"] and r["thi"] and r["tlo"] < r["thi"]
    inbox = c.get("/api/v1/sandbox/inbox", params={"phone": PHONE}).json()
    sms = [m for m in inbox if m["channel"] == "sms" and m["kind"] == "climate"][0]
    assert "AfyaNest imechukua hatua" in sms["text"] and "joto limewashwa" in sms["text"]
    h = c.get(f"/api/v1/houses/{did}").json()
    assert h["escalation"]["open"] and "heater_on" in h["advice"]["auto"]["done"]
    # nobody answers: AfyaNest rings again, then tells the backup contact
    t = time.time()
    svc.escalate(t + 11 * 60)
    svc.escalate(t + 22 * 60)
    esc = svc.store.escalation(did)
    assert esc["calls"] == 3 and esc["backup_ts"]
    backup = c.get("/api/v1/sandbox/inbox", params={"phone": "+254711500099"}).json()
    assert {m["channel"] for m in backup} >= {"sms", "voice"}
    assert "mkulima hajajibu" in backup[0]["text"] or "mkulima hajajibu" in backup[-1]["text"]
    # farmer replies SAWA: calls stop
    assert "Tumeacha kupiga simu" in c.post("/api/v1/sandbox/sms", json={"phone": PHONE, "text": "SAWA"}).json()["reply"]
    assert svc.store.escalation(did)["closed_by"] == "farmer"
    # heat: fan on, curtains fully open, heater off
    r = c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "heat"}).json()["reply"]
    assert r["fan"] == 1 and r["heater"] == 0 and r["curtain"] == 100
    # ammonia: fan on, curtains opened
    r = c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "ammonia"}).json()["reply"]
    assert r["fan"] == 1 and r["curtain"] >= 40
    # back to normal: the open danger is closed and the farmer gets an all-clear
    c.post("/api/v1/sandbox/scenario", json={"device_id": did, "kind": "normal"})
    svc.escalate(time.time() + 60)
    esc = svc.store.escalation(did)
    assert esc["closed_ts"] and esc["closed_by"] in ("resolved", "farmer")
    # a house without equipment is never told to switch anything
    did2 = add_farmer(c, name="Jane Doe", phone="+254711500003")["device_id"]
    svc.synthetic.tick(time.time(), backfill_slots=24)
    r = c.post("/api/v1/sandbox/scenario", json={"device_id": did2, "kind": "cold"}).json()["reply"]
    assert r["heater"] == 0 and r["fan"] == 0 and r["curtain"] is None and r["buzzer"] == 1


def test_real_farmer_welcome_is_sent(tmp_path):
    c, svc, tid = setup(tmp_path)
    notify.SENT.clear()
    add_farmer(c, name="Peter Otieno", phone="+254722000111", county="Kisumu", test=False, lang="en")
    assert any("Welcome Peter" in str(m) for m in notify.SENT)
    # real farmers cannot be driven from the console test phone
    assert c.post("/api/v1/sandbox/sms", json={"phone": "+254722000111", "text": "HALI"}).status_code == 404


def test_console_farmers_and_overview(tmp_path):
    c, svc, tid = setup(tmp_path)
    r = c.post("/api/v1/farmers", json={"name": "Peter Otieno", "phone": "+254722000111",
                                        "county": "Kisumu", "n_birds": 500, "age_weeks": 3})
    assert r.status_code == 200, r.text
    fid = r.json()["farmer_id"]
    assert c.post("/api/v1/farmers", json={"name": "Dup Licate", "phone": "+254722000111",
                                           "county": "Kisumu"}).status_code == 409
    assert c.post("/api/v1/farmers", json={"name": "Bad", "phone": "0722", "county": "Kisumu"}).status_code == 422
    assert c.post("/api/v1/farmers", json={"name": "<img src=x onerror=1>", "phone": "+254722000112",
                                           "county": "Kisumu"}).status_code == 422
    farmers = c.get("/api/v1/farmers").json()
    assert farmers[0]["name"] == "Peter Otieno" and not farmers[0]["sandbox"]
    svc.synthetic.tick(time.time(), backfill_slots=24)
    ov = c.get("/api/v1/overview").json()
    assert ov["farmers"]["total"] == 1 and ov["houses"]["synthetic"] == 1
    d = c.get(f"/api/v1/farmers/{fid}").json()
    assert d["houses"][0]["county"] == "Kisumu"
    # a real (non-sandbox) farmer's house cannot be driven by scenarios
    assert c.post("/api/v1/sandbox/scenario", json={"device_id": d["houses"][0]["device_id"],
                                                    "kind": "cold"}).status_code == 403
    assert c.patch(f"/api/v1/farmers/{fid}", json={"status": "stopped"}).json()["status"] == "stopped"
    assert c.delete(f"/api/v1/farmers/{fid}").status_code == 200
    assert c.get(f"/api/v1/farmers/{fid}").status_code == 404


def test_attacks_on_console(tmp_path):
    c, svc, tid = setup(tmp_path)
    fid = c.post("/api/v1/farmers", json={"name": "Peter Otieno", "phone": "+254722000111",
                                          "county": "Kisumu"}).json()["farmer_id"]
    anon = TestClient(c.app)
    for method, path, body in (("get", "/api/v1/overview", None), ("get", "/api/v1/farmers", None),
                               ("get", f"/api/v1/farmers/{fid}", None),
                               ("post", "/api/v1/sandbox/sms", {"phone": PHONE, "text": "HALI"}),
                               ("get", "/api/v1/sandbox/inbox?phone=%2B254722000111", None),
                               ("post", "/api/v1/farmers", {"name": "X Y", "phone": "+254700000000", "county": "Embu"})):
        r = getattr(anon, method)(path, json=body) if body else getattr(anon, method)(path)
        assert r.status_code == 401, (path, r.status_code)
    # CSRF: a logged-in browser tricked by another site cannot write
    tok = c.headers.pop("X-CSRF-Token")
    assert c.post("/api/v1/farmers", json={"name": "Csrf Test", "phone": "+254700000001",
                                           "county": "Embu"}).status_code == 403
    assert c.delete(f"/api/v1/farmers/{fid}").status_code == 403
    c.headers["X-CSRF-Token"] = tok
    # another organisation cannot see or touch our farmers (404, no leak)
    st = svc.store
    t2 = st.create_tenant("Other Org")
    st.create_user(t2, "other@x.test", "Other Owner", hash_password(PW), "owner")
    o = TestClient(c.app)
    o.headers["X-CSRF-Token"] = o.post("/api/v1/auth/login", json={"email": "other@x.test", "password": PW}).json()["csrf"]
    assert o.get(f"/api/v1/farmers/{fid}").status_code == 404
    assert o.patch(f"/api/v1/farmers/{fid}", json={"status": "stopped"}).status_code == 404
    assert o.get("/api/v1/farmers").json() == []
    # SQL-injection-shaped input is just data
    r = c.post("/api/v1/farmers", json={"name": "Robert Tables", "phone": PHONE, "county": "Kiambu",
                                        "device_id": "X'); DROP TABLE farmers;--"})
    assert r.status_code == 422 and st.q("SELECT COUNT(*) n FROM farmers", one=True)["n"] == 1
    # oversize / malformed input rejected before reaching the logic
    assert c.post("/api/v1/sandbox/sms", json={"phone": PHONE, "text": "1" * 500}).status_code == 422
    assert c.post("/api/v1/sandbox/sms", json={"phone": "not-a-phone", "text": "HALI"}).status_code == 422
    assert c.get("/api/v1/sandbox/inbox", params={"phone": "'; select 1"}).status_code in (422,)
    # phone numbers and message text are encrypted at rest
    add_farmer(c, n_birds=10)
    raw = "\n".join(str(r) for t in ("farmers", "sms_outbox") for r in st.q(f"SELECT * FROM {t}"))
    assert PHONE not in raw and "Mary Wanjiku" not in raw and "+254722000111" not in raw


def test_voice_callback(tmp_path):
    c, svc, tid = setup(tmp_path, sms_token="cb-secret")
    a = TestClient(c.app)
    # voice callback reads the latest call text, XML-escaped
    svc.store.add_outbox(tid, "+254733000001", "Hatari <b>& baridi</b>", "voice", "climate", "dry_run")
    r = a.post("/api/v1/voice?token=cb-secret", data={"destinationNumber": "+254733000001"})
    assert r.status_code == 200 and "&lt;b&gt;&amp; baridi" in r.text and "<b>" not in r.text
    assert a.post("/api/v1/voice", data={"destinationNumber": "+254733000001"}).status_code == 401
    assert a.post("/api/v1/voice?token=wrong", data={"destinationNumber": "+254733000001"}).status_code == 401


if __name__ == "__main__":
    import pathlib
    import tempfile
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            with tempfile.TemporaryDirectory() as d:
                fn(pathlib.Path(d))
            print(f"PASS {name} ({time.time() - t:.1f}s)")
