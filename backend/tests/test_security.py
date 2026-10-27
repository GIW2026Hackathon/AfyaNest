"""Security and multi-tenancy tests for the HTTP API.

Run: python tests/test_security.py   (or python -m pytest tests -q)
"""
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["AIRNEST_DRY_RUN"] = "1"
os.environ["AIRNEST_ENV"] = "dev"
os.environ["AIRNEST_NO_APP"] = "1"
os.environ.setdefault("AIRNEST_DATA_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
os.environ["AIRNEST_ALLOW_SIGNUP"] = "1"   # these tests exercise the (normally closed) sign-up

from fastapi.testclient import TestClient  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _db import fresh_db, is_pg  # noqa: E402
from server import security  # noqa: E402
from server.main import create_app  # noqa: E402

MODELS = os.path.join(ROOT, "models")
PW = "Green-pasture-42"
HOUSE = dict(device_id="hs-1", name="Shamba A", phone="+254711222333",
             tech_phone="+254711999888", lat=-1.1, lon=36.6, has_fan=True)


def client(tmp, **env):
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        target, connect = fresh_db(tmp)
        app = create_app(target, MODELS, "admin-key-123", connect=connect)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return TestClient(app)


def signup(c, email, org="Org", name="Amina Otieno", pw=PW):
    r = c.post("/api/v1/auth/signup", json=dict(org_name=org, name=name, email=email, password=pw))
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r.json()


def login(c, email, pw=PW):
    r = c.post("/api/v1/auth/login", json=dict(email=email, password=pw))
    if r.status_code == 200:
        c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r


def test_signup_login_cookies_and_headers(tmp_path):
    c = client(tmp_path)
    signup(c, "amina@example.com")
    assert c.get("/api/v1/auth/me").json()["role"] == "owner"
    r = login(c, "amina@example.com")
    sc = r.headers.get_list("set-cookie")
    sess = next(x for x in sc if x.startswith("afya_session="))
    assert "HttpOnly" in sess and "SameSite=strict" in sess.replace("Strict", "strict")
    r = c.get("/api/v1/houses")
    for h in ("Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options"):
        assert h in r.headers
    assert r.headers["Cache-Control"] == "no-store"
    # weak passwords are refused
    r = TestClient(c.app).post("/api/v1/auth/signup", json=dict(
        org_name="X", name="Bob", email="bob@example.com", password="password123"))
    assert r.status_code == 422


def test_secure_cookie_prefix_in_production(tmp_path):
    c = client(tmp_path, AIRNEST_COOKIE_SECURE="1")
    r = c.post("/api/v1/auth/signup", json=dict(org_name="Org Z", name="Zed Kamau",
                                                email="z@example.com", password=PW))
    sc = r.headers.get_list("set-cookie")
    assert any(x.startswith("__Host-afya_session=") and "Secure" in x for x in sc)
    assert "Strict-Transport-Security" in r.headers


def test_csrf_required_for_writes(tmp_path):
    c = client(tmp_path)
    signup(c, "a@example.com")
    tok = c.headers.pop("X-CSRF-Token")
    assert c.post("/api/v1/houses", json=HOUSE).status_code == 403
    c.headers["X-CSRF-Token"] = "forged"
    assert c.post("/api/v1/houses", json=HOUSE).status_code == 403
    c.headers["X-CSRF-Token"] = tok
    r = c.post("/api/v1/houses", json=HOUSE)
    assert r.status_code == 200 and len(r.json()["device_key"]) >= 30


def test_tenant_isolation(tmp_path):
    a, b = client(tmp_path), None
    signup(a, "owner-a@example.com", org="Farm A")
    key = a.post("/api/v1/houses", json=HOUSE).json()["device_key"]
    b = TestClient(a.app)
    signup(b, "owner-b@example.com", org="Farm B")
    assert b.get("/api/v1/houses").json() == []
    for path in ("/api/v1/houses/hs-1", "/api/v1/houses/hs-1/history"):
        assert b.get(path).status_code == 404                       # not 403: no leak
    assert b.patch("/api/v1/houses/hs-1", json={"name": "pwn"}).status_code == 404
    assert b.delete("/api/v1/houses/hs-1").status_code in (403, 404)
    assert b.post("/api/v1/houses/hs-1/rotate-key").status_code == 404
    # registering the same device id cannot hijack A's house
    assert b.post("/api/v1/houses", json=HOUSE).status_code == 409
    # A's gateway still works with its key; B's team list never shows A's users
    r = a.post("/api/v1/ingest", headers={"X-Device-Key": key}, json={
        "device_id": "hs-1", "nodes": [{"node": 0, "nh3_ppm": 5, "temp_c": 25, "rh_pct": 60}]})
    assert r.status_code == 200
    assert {m["email"] for m in b.get("/api/v1/team").json()} == {"owner-b@example.com"}
    assert a.get("/api/v1/houses/hs-1").json()["phone"] == "+254711222333"


def test_roles(tmp_path):
    c = client(tmp_path)
    signup(c, "boss@example.com")
    tmp = c.post("/api/v1/team", json=dict(email="v@example.com", name="Viewer Wanjiru",
                                           role="viewer")).json()["temporary_password"]
    v = TestClient(c.app)
    assert login(v, "v@example.com", tmp).status_code == 200
    # must change the temporary password before doing anything else
    assert v.get("/api/v1/houses").json()["code"] == "password_change_required"
    assert v.post("/api/v1/auth/password", json=dict(current_password=tmp,
                                                     new_password="Fresh-meadow-77")).status_code == 200
    assert v.get("/api/v1/houses").status_code == 200
    assert v.post("/api/v1/houses", json=HOUSE).status_code == 403
    assert v.post("/api/v1/team", json=dict(email="x@example.com", name="X", role="owner")).status_code == 403
    assert v.get("/api/v1/audit").status_code == 403
    # owner cannot remove the last owner
    me = c.get("/api/v1/auth/me").json()["id"]
    assert c.patch(f"/api/v1/team/{me}", json={"role": "viewer"}).status_code == 409


def test_lockout_and_enumeration(tmp_path):
    c = client(tmp_path)
    signup(c, "farmer@example.com")
    anon = TestClient(c.app)
    r1 = login(anon, "farmer@example.com", "wrong-password-1")
    r2 = login(anon, "nobody@example.com", "wrong-password-1")
    assert r1.status_code == r2.status_code == 401 and r1.json()["detail"] == r2.json()["detail"]
    for _ in range(5):
        login(anon, "farmer@example.com", "wrong-password-1")
    r = login(anon, "farmer@example.com")                           # right password, locked
    assert r.status_code == 429
    log = c.get("/api/v1/audit").json()
    assert any(e["action"] == "auth.login_failed" for e in log["entries"]) and log["chain_ok"]


def test_mfa_flow_and_recovery(tmp_path):
    c = client(tmp_path)
    signup(c, "mfa@example.com")
    setup = c.post("/api/v1/auth/mfa/setup").json()
    assert setup["qr_svg"].startswith("<svg") and setup["otpauth_uri"].startswith("otpauth://")
    secret = setup["secret"]
    code = security._hotp(secret, int(time.time() // 30))
    codes = c.post("/api/v1/auth/mfa/enable", json={"code": code}).json()["recovery_codes"]
    assert len(codes) == 8
    d = TestClient(c.app)
    r = login(d, "mfa@example.com")
    assert r.json()["mfa_required"] is True
    assert d.get("/api/v1/houses").status_code == 401              # half-logged-in = nothing
    assert d.post("/api/v1/auth/mfa", json={"code": "000000"}).status_code == 401
    # the code used to enable cannot be replayed
    assert d.post("/api/v1/auth/mfa", json={"code": code}).status_code == 401
    r = d.post("/api/v1/auth/mfa", json={"code": codes[0]})
    assert r.status_code == 200, r.text
    d.headers["X-CSRF-Token"] = r.json()["csrf"]
    assert d.get("/api/v1/houses").status_code == 200
    # a recovery code works only once
    e = TestClient(c.app)
    login(e, "mfa@example.com")
    assert e.post("/api/v1/auth/mfa", json={"code": codes[0]}).status_code == 401


def test_org_requires_mfa(tmp_path):
    c = client(tmp_path)
    signup(c, "own@example.com")
    assert c.patch("/api/v1/org", json={"require_mfa": True}).status_code == 409
    s = c.post("/api/v1/auth/mfa/setup").json()["secret"]
    c.post("/api/v1/auth/mfa/enable", json={"code": security._hotp(s, int(time.time() // 30))})
    assert c.patch("/api/v1/org", json={"require_mfa": True}).status_code == 200
    tmp = c.post("/api/v1/team", json=dict(email="m@example.com", name="Mgr Kip",
                                           role="manager")).json()["temporary_password"]
    m = TestClient(c.app)
    login(m, "m@example.com", tmp)
    m.post("/api/v1/auth/password", json=dict(current_password=tmp, new_password="Rain-on-tin-88"))
    assert m.get("/api/v1/houses").json()["code"] == "mfa_setup_required"


def test_sessions_logout_everywhere_and_password_change(tmp_path):
    c = client(tmp_path)
    signup(c, "s@example.com")
    other = TestClient(c.app)
    login(other, "s@example.com")
    assert len(c.get("/api/v1/auth/sessions").json()) == 2
    assert c.post("/api/v1/auth/password", json=dict(current_password=PW,
                                                     new_password="Another-good-one-9")).status_code == 200
    assert other.get("/api/v1/houses").status_code == 401           # other device signed out
    assert c.get("/api/v1/houses").status_code == 200
    c.post("/api/v1/auth/logout")
    assert c.get("/api/v1/houses").status_code == 401


def test_data_at_rest_is_protected(tmp_path):
    c = client(tmp_path)
    signup(c, "rest@example.com", name="Grace Wambui")
    key = c.post("/api/v1/houses", json=HOUSE).json()["device_key"]
    store = c.app.state.svc.store
    dump = "\n".join(str(r) for t in ("houses", "users", "tenants", "sessions", "audit_log")
                     for r in store.q(f"SELECT * FROM {t}"))
    for secret in ("+254711222333", "+254711999888", "rest@example.com", "Grace Wambui",
                   key, PW, "36.6"):
        assert secret not in dump, secret
    # tampering with the audit log is detected
    store.q("UPDATE audit_log SET action='nothing' WHERE seq=1")
    assert c.get("/api/v1/audit").json()["chain_ok"] is False


def test_gateway_and_sms_webhook(tmp_path):
    c = client(tmp_path, AIRNEST_SMS_TOKEN="hook-secret")
    signup(c, "g@example.com")
    key = c.post("/api/v1/houses", json=HOUSE).json()["device_key"]
    # day-old chicks need 30-34 C: 32 C is comfortable, so the house is "ok"
    body = {"device_id": "hs-1", "nodes": [{"node": 0, "nh3_ppm": 5, "temp_c": 32, "rh_pct": 60}]}
    assert c.post("/api/v1/ingest", json=body).status_code == 401
    assert c.post("/api/v1/ingest", headers={"X-Device-Key": "x" * 32}, json=body).status_code == 401
    assert c.post("/api/v1/ingest", headers={"X-Device-Key": key}, json=body).json()["level"] == "ok"
    new = c.post("/api/v1/houses/hs-1/rotate-key").json()["device_key"]
    assert c.post("/api/v1/ingest", headers={"X-Device-Key": key}, json=body).status_code == 401
    assert c.post("/api/v1/ingest", headers={"X-Device-Key": new}, json=body).status_code == 200
    assert c.get("/api/v1/devices/hs-1/status", headers={"X-Device-Key": new}).status_code == 200
    assert c.post("/api/v1/sms", data={"from": "+254711222333", "text": "hali"}).status_code == 401
    assert c.post("/api/v1/sms?token=hook-secret",
                  data={"from": "+254711222333", "text": "hali"}).status_code == 200
    assert c.post("/api/v1/ingest", headers={"X-Device-Key": new},
                  json={"device_id": "hs-1", "nodes": [{"node": 42}]}).status_code == 422


def test_provisioning_and_platform_view(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/v1/admin/tenants", json=dict(org_name="Coop", email="c@example.com",
                                                  name="Coop Admin", password=PW))
    assert r.status_code == 401
    r = c.post("/api/v1/admin/tenants", headers={"X-Admin-Key": "admin-key-123"},
               json=dict(org_name="Coop", email="c@example.com", name="Coop Admin", password=PW))
    tid = r.json()["tenant_id"]
    assert c.post(f"/api/v1/admin/tenants/{tid}/houses", headers={"X-Admin-Key": "admin-key-123"},
                  json=dict(HOUSE, device_key="a-strong-device-key")).status_code == 200
    login(c, "c@example.com")
    assert [h["device_id"] for h in c.get("/api/v1/houses").json()] == ["hs-1"]
    assert c.get("/api/v1/admin/tenants").status_code == 403          # not a platform admin


def test_legacy_database_migrates(tmp_path):
    if is_pg():
        return                                   # old SQLite files only
    db = sqlite3.connect(str(tmp_path / "s.db"))
    db.executescript("""CREATE TABLE houses (device_id TEXT PRIMARY KEY, device_key TEXT NOT NULL,
      name TEXT, phone TEXT, tech_phone TEXT, lang TEXT DEFAULT 'sw', lat REAL, lon REAL,
      t_mean REAL DEFAULT 17, placement_ts INTEGER, has_fan INTEGER DEFAULT 0, n_birds INTEGER,
      last_curtain REAL, last_curtain_ts INTEGER);
      INSERT INTO houses (device_id, device_key, name, phone) VALUES
      ('old-1', 'old-device-key', 'Old farm', '+254700000123');""")
    db.commit()
    c = TestClient(create_app(str(tmp_path / "s.db"), MODELS, "admin-key-123"))
    row = sqlite3.connect(str(tmp_path / "s.db")).execute(
        "SELECT device_key, phone, tenant_id FROM houses").fetchone()
    assert row[0] == "" and "254700000123" not in row[1] and row[2] == "legacy"
    r = c.post("/api/v1/ingest", headers={"X-Device-Key": "old-device-key"}, json={
        "device_id": "old-1", "nodes": [{"node": 0, "nh3_ppm": 5, "temp_c": 25, "rh_pct": 60}]})
    assert r.status_code == 200


def test_production_refuses_without_data_key(tmp_path):
    old = {k: os.environ.pop(k, None) for k in ("AIRNEST_DATA_KEY", "AIRNEST_ENV")}
    try:
        security.Vault()
        raise AssertionError("started without a data key")
    except RuntimeError:
        pass
    finally:
        for k, v in old.items():
            if v is not None:
                os.environ[k] = v


if __name__ == "__main__":
    import pathlib
    import tempfile
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            with tempfile.TemporaryDirectory() as d:
                fn(pathlib.Path(d))
            print(f"PASS {name} ({time.time() - t:.1f}s)")
