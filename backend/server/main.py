"""AirNest API (FastAPI).

    pip install -r requirements-server.txt
    AIRNEST_ADMIN_KEY=... AT_USERNAME=... AT_API_KEY=... \
        uvicorn server.main:app --host 0.0.0.0 --port 8000

Interactive API docs: http://localhost:8000/docs

Endpoints
  POST /api/v1/houses                 register a house          (header X-Admin-Key)
  POST /api/v1/ingest                 gateway upload            (header X-Device-Key)
  GET  /api/v1/houses                 dashboard: all houses + current level (X-Admin-Key)
  GET  /api/v1/houses/{id}/status     latest advice + readings  (X-Device-Key or X-Admin-Key)
  GET  /api/v1/houses/{id}/history    dashboard: readings + alerts, ?hours=24 (X-Admin-Key)
  POST /api/v1/sms                    Africa's Talking incoming-SMS callback (form data)
  GET  /health                        liveness check
"""
import os
import sys
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Form, Header, HTTPException  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import PlainTextResponse  # noqa: E402

from server.schemas import HouseIn, IngestIn, IngestReply, StatusOut  # noqa: E402
from server.service import AirNestService, ServiceError  # noqa: E402


def create_app(db_path=None, model_dir=None, admin_key=None) -> FastAPI:
    svc = AirNestService(db_path or os.getenv("AIRNEST_DB", "airnest.db"),
                         model_dir or os.getenv("AIRNEST_MODELS", "models"),
                         admin_key or os.getenv("AIRNEST_ADMIN_KEY", ""))

    # 1. Define the async context manager lifespan event handler
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def watchdog():
            while True:
                await asyncio.sleep(600)
                try:
                    await run_in_threadpool(svc.check_offline)
                except Exception:
                    logging.exception("offline watchdog failed")

        task = asyncio.create_task(watchdog())
        yield
        task.cancel()

    # 2. Pass parameters cleanly to the FastAPI constructor
    app = FastAPI(
        title="AirNest",
        version="1.0",
        lifespan=lifespan,
        description="AI + IoT climate guardian for poultry houses"
    )

    app.state.svc = svc

    # Let the React (Vite) dashboard call the API from the browser
    default_origins = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174,"
        "http://localhost:5175,http://127.0.0.1:5175,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3333,http://127.0.0.1:3333"
    )
    origins = os.getenv("AIRNEST_CORS_ORIGINS", default_origins).split(",")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],  # Essential change: allow OPTIONS flight prechecks and all HTTP methods
        allow_headers=["*"],  # Essential change: accepts any frontend custom layout headers
        expose_headers=["X-Admin-Key", "X-Device-Key"]  # Explicitly expose your secure header metrics to frontend
    )

    sms_token = os.getenv("AIRNEST_SMS_TOKEN", "")

    async def call(fn, *args):
        # the AI work is CPU-bound: run it off the event loop
        try:
            return await run_in_threadpool(fn, *args)
        except ServiceError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)

    @app.get("/health")
    async def health():
        return {"ok": True, "model": svc.brain.model_name, "detector": svc.brain.detector_name}

    @app.post("/api/v1/houses")
    async def register(house: HouseIn, x_admin_key: str | None = Header(default=None)):
        return await call(svc.register_house, house, x_admin_key)

    @app.post("/api/v1/ingest", response_model=IngestReply)
    async def ingest(body: IngestIn, x_device_key: str | None = Header(default=None)):
        return await call(svc.ingest, body, x_device_key)

    @app.get("/api/v1/houses/{device_id}/status", response_model=StatusOut)
    async def status(device_id: str, x_device_key: str | None = Header(default=None),
                     x_admin_key: str | None = Header(default=None)):
        return await call(svc.status, device_id, x_device_key, x_admin_key)

    @app.get("/api/v1/houses")
    async def houses(x_admin_key: str | None = Header(default=None)):
        return await call(svc.list_houses, x_admin_key)

    @app.get("/api/v1/houses/{device_id}/history")
    async def history(device_id: str, hours: int = 24,
                      x_admin_key: str | None = Header(default=None)):
        return await call(svc.history, device_id, hours, x_admin_key)

    @app.post("/api/v1/sms", response_class=PlainTextResponse)
    async def incoming_sms(token: str = "", from_: str = Form(default="", alias="from"),
                           text: str = Form(default="")):
        if sms_token and not hmac.compare_digest(token, sms_token):
            raise HTTPException(status_code=401, detail="bad token")
        await call(svc.incoming_sms, from_, text)
        return ""

    return app


app = create_app()
