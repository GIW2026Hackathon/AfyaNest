"""AfyaNest API (FastAPI).

    pip install -r requirements-server.txt
    export AIRNEST_DATA_KEY=$(python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())")
    AIRNEST_ADMIN_KEY=... AIRNEST_SMS_TOKEN=... AT_USERNAME=... AT_API_KEY=... \
        uvicorn server.main:app --host 127.0.0.1 --port 8000

Local development:  AIRNEST_ENV=dev uvicorn server.main:app --reload --port 8000
(dev mode: non-Secure cookies over http://localhost, /docs enabled, a local data key).

Who calls what
  Browser dashboard  -> cookie session + X-CSRF-Token header        /api/v1/auth/*, houses, team
  Gateway (SIM800L)  -> X-Device-Key                                /api/v1/ingest, /devices/{id}/status
  Africa's Talking   -> ?token=AIRNEST_SMS_TOKEN                    /api/v1/sms
  Provisioning tool  -> X-Admin-Key                                 /api/v1/admin/tenants
"""
import asyncio
import logging
import os
import re
import sys
import time
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import Body, FastAPI, Form, Header, HTTPException, Request, Response  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse  # noqa: E402

from server.auth import AuthError  # noqa: E402
from server.schemas import (CodeIn, FarmerIn, FarmerUpdate, HouseIn, HouseUpdate,  # noqa: E402
                            IngestIn, IngestReply, InviteIn, LoginIn, MemberUpdate, OrgUpdate,
                            PasswordChangeIn, PasswordIn, ProvisionIn, SandboxSmsIn,
                            ScenarioIn, SignupIn, StatusOut)
from server.security import env, same  # noqa: E402
from server.service import AirNestService, ServiceError  # noqa: E402

MAX_BODY = 512 * 1024
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
APP_CSP = ("default-src 'self'; script-src 'self'; "
           "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; "
           "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; "
           "object-src 'none'")


def create_app(db=None, model_dir=None, admin_key=None, vault=None, connect=None) -> FastAPI:
    dev = env() == "dev"
    svc = AirNestService(db,
                         model_dir or os.getenv("AIRNEST_MODELS", "models"),
                         admin_key or os.getenv("AIRNEST_ADMIN_KEY", ""), vault, connect)
    auth = svc.auth
    secure_cookies = os.getenv("AIRNEST_COOKIE_SECURE", "0" if dev else "1") == "1"
    # __Host- prefix: browser refuses the cookie unless Secure, Path=/ and no Domain
    SESSION = "__Host-afya_session" if secure_cookies else "afya_session"
    CSRF = "__Host-afya_csrf" if secure_cookies else "afya_csrf"
    trust_proxy = os.getenv("AIRNEST_TRUST_PROXY", "0") == "1"
    sms_token = os.getenv("AIRNEST_SMS_TOKEN", "")
    static_dir = os.getenv("AIRNEST_STATIC_DIR", "")
    show_docs = dev or os.getenv("AIRNEST_DOCS", "0") == "1"
    osint_hours = float(os.getenv("AIRNEST_OSINT_HOURS", "6"))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def watchdog():
            while True:
                await asyncio.sleep(600)
                try:
                    await run_in_threadpool(svc.check_offline)
                except Exception:
                    logging.exception("offline watchdog failed")

        async def escalation():                          # follow up danger until answered
            await asyncio.sleep(20)
            while True:
                try:
                    await run_in_threadpool(svc.escalate)
                except Exception:
                    logging.exception("escalation failed")
                await asyncio.sleep(60)

        async def synthetic_feed():                       # houses without a sensor box yet
            await asyncio.sleep(5)
            while True:
                try:
                    await run_in_threadpool(svc.synthetic.tick)
                except Exception:
                    logging.exception("synthetic feed failed")
                await asyncio.sleep(60)

        async def outbreak_watch():                      # model 1: news + official feeds
            await asyncio.sleep(30)
            while True:
                try:
                    r = await run_in_threadpool(svc.outbreaks.run)
                    logging.info("outbreak watch: %s", r)
                except Exception:
                    logging.exception("outbreak watch failed")
                await asyncio.sleep(osint_hours * 3600)

        tasks = [asyncio.create_task(watchdog()), asyncio.create_task(escalation())]
        if os.getenv("AIRNEST_SYNTHETIC", "1") == "1":
            tasks.append(asyncio.create_task(synthetic_feed()))
        if os.getenv("AIRNEST_OSINT", "1") == "1":
            tasks.append(asyncio.create_task(outbreak_watch()))
        yield
        for t in tasks:
            t.cancel()

    app = FastAPI(title="AfyaNest", version="2.0", lifespan=lifespan,
                  description="AI + IoT climate guardian for poultry houses",
                  docs_url="/docs" if show_docs else None,
                  redoc_url=None, openapi_url="/openapi.json" if show_docs else None)
    app.state.svc = svc

    # Only needed when the dashboard is served from another origin. The recommended
    # set-up (Vite proxy in dev, AIRNEST_STATIC_DIR or a reverse proxy in production)
    # is same-origin and needs no CORS at all.
    origins = [o.strip() for o in os.getenv("AIRNEST_CORS_ORIGINS", "").split(",") if o.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                           allow_methods=["GET", "POST", "PATCH", "DELETE"],
                           allow_headers=["Content-Type", "X-CSRF-Token"])

    @app.middleware("http")
    async def harden(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY:
            return JSONResponse({"detail": "Request too large."}, status_code=413)
        resp = await call_next(request)
        is_api = request.url.path.startswith(("/api/", "/health"))
        h = resp.headers
        h.setdefault("Content-Security-Policy", API_CSP if is_api else APP_CSP)
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        h["Cross-Origin-Resource-Policy"] = "same-origin"
        if secure_cookies:
            h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        if is_api:
            h["Cache-Control"] = "no-store"
        return resp

    @app.exception_handler(AuthError)
    async def auth_error(_, e: AuthError):
        return JSONResponse({"detail": e.detail, "code": e.code}, status_code=e.status)

    @app.exception_handler(ServiceError)
    async def svc_error(_, e: ServiceError):
        return JSONResponse({"detail": e.detail}, status_code=e.status)

    # ------------------------------------------------------------ helpers
    def ip_of(request: Request) -> str:
        if trust_proxy and request.headers.get("x-forwarded-for"):
            return request.headers["x-forwarded-for"].split(",")[0].strip()
        return request.client.host if request.client else "-"

    def set_session(resp: Response, tok: str, csrf: str, max_age: int | None = None):
        resp.set_cookie(SESSION, tok, httponly=True, secure=secure_cookies, samesite="strict",
                        path="/", max_age=max_age)
        resp.set_cookie(CSRF, csrf, httponly=False, secure=secure_cookies, samesite="strict",
                        path="/", max_age=max_age)

    def clear_session(resp: Response):
        for c in (SESSION, CSRF):
            resp.delete_cookie(c, path="/", secure=secure_cookies, samesite="strict")

    async def run(fn, *args, **kw):
        # scrypt + the AI are CPU-bound: keep them off the event loop
        return await run_in_threadpool(lambda: fn(*args, **kw))

    async def ctx(request: Request, write=False, roles=None, restricted_ok=False):
        """Authenticate a dashboard request. Returns (session, user)."""
        s, u = await run(auth.session_user, request.cookies.get(SESSION))
        if write:
            auth.check_csrf(s, request.headers.get("x-csrf-token"))
        if not restricted_ok:
            if u["must_change_pw"]:
                raise AuthError(403, "Please choose a new password first.", "password_change_required")
            pub = auth.public_user(u)
            if pub["mfa_setup_required"]:
                raise AuthError(403, "Your organisation requires two-step verification. "
                                     "Set it up to continue.", "mfa_setup_required")
        if roles:
            auth.require_role(u, *roles)
        return s, u

    # ------------------------------------------------------------ health
    started = time.time()

    @app.get("/health")
    async def health():
        """Liveness for the dashboard's "server live" indicator and for uptime monitors."""
        db_ok = await run(svc.store.ping)
        body = {"ok": db_ok, "db": svc.store.db.dialect if db_ok else "unreachable",
                "model": svc.brain.model_name, "detector": svc.brain.detector_name,
                "time": int(time.time()), "uptime_s": int(time.time() - started)}
        return JSONResponse(body, status_code=200 if db_ok else 503)

    # ------------------------------------------------------------ auth
    @app.post("/api/v1/auth/signup")
    async def signup(body: SignupIn, request: Request, response: Response):
        tok, csrf, user = await run(auth.signup, body.org_name, body.name, body.email,
                                    body.password, ip_of(request), request.headers.get("user-agent"))
        set_session(response, tok, csrf)
        return {"user": user, "csrf": csrf}

    @app.post("/api/v1/auth/login")
    async def login(body: LoginIn, request: Request, response: Response):
        tok, csrf, out = await run(auth.login, body.email, body.password, ip_of(request),
                                   request.headers.get("user-agent"))
        set_session(response, tok, csrf)
        return {**out, "csrf": csrf}

    @app.post("/api/v1/auth/mfa")
    async def mfa(body: CodeIn, request: Request, response: Response):
        tok = request.cookies.get(SESSION)
        s, _ = await run(auth.session_user, tok, stage="mfa")
        auth.check_csrf(s, request.headers.get("x-csrf-token"))
        tok, csrf, out = await run(auth.verify_mfa, tok, body.code, ip_of(request),
                                   request.headers.get("user-agent"))
        set_session(response, tok, csrf)
        return {**out, "csrf": csrf}

    @app.post("/api/v1/auth/logout")
    async def logout(request: Request, response: Response, everywhere: bool = False):
        try:
            s, u = await ctx(request, write=True, restricted_ok=True)
            await run(auth.logout, s, u, ip_of(request), everywhere)
        except AuthError:
            pass
        clear_session(response)
        return {"ok": True}

    @app.get("/api/v1/auth/me")
    async def me(request: Request):
        _, u = await ctx(request, restricted_ok=True)
        return auth.public_user(u)

    @app.post("/api/v1/auth/password")
    async def change_password(body: PasswordChangeIn, request: Request):
        s, u = await ctx(request, write=True, restricted_ok=True)
        await run(auth.change_password, s, u, body.current_password, body.new_password,
                  ip_of(request))
        return {"ok": True}

    @app.post("/api/v1/auth/mfa/setup")
    async def mfa_setup(request: Request):
        _, u = await ctx(request, write=True, restricted_ok=True)
        return await run(auth.mfa_setup, u)

    @app.post("/api/v1/auth/mfa/enable")
    async def mfa_enable(body: CodeIn, request: Request):
        _, u = await ctx(request, write=True, restricted_ok=True)
        return await run(auth.mfa_enable, u, body.code, ip_of(request))

    @app.post("/api/v1/auth/mfa/disable")
    async def mfa_disable(body: PasswordIn, request: Request):
        s, u = await ctx(request, write=True)
        await run(auth.mfa_disable, s, u, body.password, ip_of(request))
        return {"ok": True}

    @app.get("/api/v1/auth/sessions")
    async def sessions(request: Request):
        s, u = await ctx(request)
        return auth.sessions(s, u)

    @app.delete("/api/v1/auth/sessions/{pub_id}")
    async def revoke(pub_id: str, request: Request):
        _, u = await ctx(request, write=True)
        auth.revoke_session(u, pub_id, ip_of(request))
        return {"ok": True}

    # ------------------------------------------------------------ team & org
    @app.get("/api/v1/team")
    async def team(request: Request):
        _, u = await ctx(request, roles=("owner", "manager"))
        return auth.team(u)

    @app.post("/api/v1/team")
    async def invite(body: InviteIn, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        return await run(auth.invite, u, body.email, body.name, body.role, ip_of(request))

    @app.patch("/api/v1/team/{member_id}")
    async def update_member(member_id: str, body: MemberUpdate, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        auth.update_member(u, member_id, body.role, body.disabled, ip_of(request))
        return {"ok": True}

    @app.post("/api/v1/team/{member_id}/reset-password")
    async def reset_member(member_id: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        return await run(auth.reset_member_password, u, member_id, ip_of(request))

    @app.patch("/api/v1/org")
    async def update_org(body: OrgUpdate, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        auth.set_org(u, body.require_mfa, body.name, ip_of(request))
        return auth.public_user(svc.store.user(u["id"]))

    @app.get("/api/v1/audit")
    async def audit(request: Request, limit: int = 200):
        _, u = await ctx(request, roles=("owner",))
        return await run(auth.audit_log, u, limit)

    # ------------------------------------------------------------ houses (tenant scoped)
    @app.get("/api/v1/houses")
    async def houses(request: Request):
        _, u = await ctx(request)
        return await run(svc.list_houses, u["tenant_id"])

    @app.post("/api/v1/houses")
    async def register(house: HouseIn, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.register_house, u["tenant_id"], house, u["id"], ip_of(request))

    @app.get("/api/v1/houses/{device_id}")
    async def house(device_id: str, request: Request):
        _, u = await ctx(request)
        return await run(svc.house_detail, u["tenant_id"], device_id,
                         u["role"] in ("owner", "manager"))

    @app.patch("/api/v1/houses/{device_id}")
    async def update_house(device_id: str, body: HouseUpdate, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.update_house, u["tenant_id"], device_id, body, u["id"], ip_of(request))

    @app.delete("/api/v1/houses/{device_id}")
    async def delete_house(device_id: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        await run(svc.delete_house, u["tenant_id"], device_id, u["id"], ip_of(request))
        return {"ok": True}

    @app.post("/api/v1/houses/{device_id}/rotate-key")
    async def rotate(device_id: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.rotate_device_key, u["tenant_id"], device_id, u["id"], ip_of(request))

    @app.get("/api/v1/houses/{device_id}/history")
    async def history(device_id: str, request: Request, hours: int = 24):
        _, u = await ctx(request)
        return await run(svc.history, u["tenant_id"], device_id, hours)

    # ------------------------------------------------------------ operator console
    @app.get("/api/v1/overview")
    async def overview(request: Request):
        _, u = await ctx(request)
        return await run(svc.overview, u["tenant_id"])

    @app.get("/api/v1/farmers")
    async def farmers(request: Request):
        _, u = await ctx(request)
        return await run(svc.list_farmers, u["tenant_id"])

    @app.post("/api/v1/farmers")
    async def farmer_add(body: FarmerIn, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.register_farmer, u["tenant_id"], body.name, body.phone, body.lang,
                         body.county, body.n_birds, body.age_weeks, "console", body.test, None, u["id"],
                         body.device_id, True, body.backup_phone, body.has_fan, body.has_heater,
                         body.has_curtain)

    @app.get("/api/v1/farmers/{fid}")
    async def farmer_get(fid: str, request: Request):
        _, u = await ctx(request)
        return await run(svc.farmer_detail, u["tenant_id"], fid)

    @app.patch("/api/v1/farmers/{fid}")
    async def farmer_patch(fid: str, body: FarmerUpdate, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.update_farmer, u["tenant_id"], fid, body.model_dump(exclude_unset=True), u["id"])

    @app.delete("/api/v1/farmers/{fid}")
    async def farmer_delete(fid: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner",))
        await run(svc.delete_farmer, u["tenant_id"], fid, u["id"])
        return {"ok": True}

    # ------------------------------------------------------------ test farmers (messages stay in the console)
    @app.post("/api/v1/sandbox/sms")
    async def sandbox_sms(body: SandboxSmsIn, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        f = svc.store.farmer_by_phone(body.phone, u["tenant_id"])
        if not f or not f["sandbox"]:
            raise HTTPException(404, "Only test farmers can reply from the console.")
        return {"reply": await run(svc.incoming_sms, body.phone, body.text, u["tenant_id"])}

    @app.get("/api/v1/sandbox/inbox")
    async def sandbox_inbox(phone: str, request: Request):
        _, u = await ctx(request)
        if not re.fullmatch(r"\+\d{9,15}", phone):
            raise HTTPException(422, "bad phone")
        return await run(svc.sandbox_inbox, u["tenant_id"], phone)

    @app.post("/api/v1/sandbox/scenario")
    async def sandbox_scenario(body: ScenarioIn, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        if not auth.rl.hit("scenario", u["id"], 20, 60):
            raise HTTPException(429, "Slow down.")
        return await run(svc.sandbox_scenario, u["tenant_id"], body.device_id, body.kind)

    # ------------------------------------------------------------ telecom callbacks (voice)
    @app.post("/api/v1/voice")
    async def voice_callback(token: str = "", callerNumber: str = Form(default=""),
                             destinationNumber: str = Form(default=""), isActive: str = Form(default="1")):
        if sms_token and not same(token, sms_token):
            raise HTTPException(401, "bad token")
        if not sms_token and not dev:
            raise HTTPException(503, "voice disabled")
        from xml.sax.saxutils import escape
        msg = await run(svc.voice_message, destinationNumber or callerNumber) or "AfyaNest."
        xml = f'<?xml version="1.0" encoding="UTF-8"?><Response><Say>{escape(msg)}</Say></Response>'
        return Response(xml, media_type="application/xml")

    # ------------------------------------------------------------ the three models
    @app.get("/api/v1/models")
    async def models(request: Request):
        _, u = await ctx(request)
        return await run(svc.models_status, u["tenant_id"])

    @app.get("/api/v1/outbreaks")
    async def outbreaks(request: Request):
        _, u = await ctx(request)
        return await run(svc.outbreak_list, u["tenant_id"])

    @app.post("/api/v1/outbreaks/refresh")
    async def outbreaks_refresh(request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        if not auth.rl.hit("osint-refresh", u["tenant_id"], 1, 600):
            raise HTTPException(429, "Checked recently. Try again in 10 minutes.")
        return await run(svc.outbreaks.run)

    @app.post("/api/v1/outbreaks/{signal_id}/approve")
    async def outbreak_approve(signal_id: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.outbreak_decide, u["tenant_id"], signal_id, True, u["id"], ip_of(request))

    @app.post("/api/v1/outbreaks/{signal_id}/dismiss")
    async def outbreak_dismiss(signal_id: str, request: Request):
        _, u = await ctx(request, write=True, roles=("owner", "manager"))
        return await run(svc.outbreak_decide, u["tenant_id"], signal_id, False, u["id"], ip_of(request))

    @app.get("/api/v1/counties")
    async def counties():
        from server.kenya import COUNTIES
        return sorted(COUNTIES)

    # ------------------------------------------------------------ gateway
    @app.post("/api/v1/ingest", response_model=IngestReply)
    async def ingest(body: IngestIn, x_device_key: str | None = Header(default=None)):
        return await run(svc.ingest, body, x_device_key)

    @app.get("/api/v1/devices/{device_id}/status", response_model=StatusOut)
    async def device_status(device_id: str, x_device_key: str | None = Header(default=None)):
        return await run(svc.status, device_id, x_device_key)

    # ------------------------------------------------------------ platform admin
    @app.post("/api/v1/admin/tenants")
    async def provision(body: ProvisionIn, x_admin_key: str | None = Header(default=None)):
        if not svc.admin_key:
            raise HTTPException(503, "Provisioning is disabled (AIRNEST_ADMIN_KEY not set).")
        return await run(svc.provision_tenant, x_admin_key, body.org_name, body.email,
                         body.name, body.password)

    @app.post("/api/v1/admin/tenants/{tenant_id}/houses")
    async def provision_house(tenant_id: str, house: HouseIn,
                              x_admin_key: str | None = Header(default=None)):
        if not svc.admin_key or not same(x_admin_key, svc.admin_key):
            raise HTTPException(401, "bad admin key")
        if not svc.store.tenant(tenant_id):
            raise HTTPException(404, "unknown tenant")
        return await run(svc.register_house, tenant_id, house)

    @app.get("/api/v1/admin/tenants")
    async def platform(request: Request):
        _, u = await ctx(request)
        return svc.platform_overview(u)

    # ------------------------------------------------------------ SMS webhook
    @app.post("/api/v1/sms", response_class=PlainTextResponse)
    async def incoming_sms(token: str = "", from_: str = Form(default="", alias="from"),
                           text: str = Form(default="")):
        if not sms_token and not dev:
            raise HTTPException(503, "SMS webhook disabled: set AIRNEST_SMS_TOKEN")
        if sms_token and not same(token, sms_token):
            raise HTTPException(status_code=401, detail="bad token")
        await run(svc.incoming_sms, from_[:20], text[:320])
        return ""

    # ------------------------------------------------------------ dashboard (optional)
    if static_dir and os.path.isdir(static_dir):
        root = os.path.realpath(static_dir)

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            f = os.path.realpath(os.path.join(root, path))
            if path and f.startswith(root + os.sep) and os.path.isfile(f):
                resp = FileResponse(f)
                if "/assets/" in f:
                    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                return resp
            return FileResponse(os.path.join(root, "index.html"),
                                headers={"Cache-Control": "no-cache"})

    return app


app = create_app() if os.getenv("AIRNEST_NO_APP") != "1" else None
