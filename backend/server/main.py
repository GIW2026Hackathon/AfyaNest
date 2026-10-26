"""AirNest API (FastAPI).

    pip install -r requirements-server.txt
    AIRNEST_ADMIN_KEY=... AT_USERNAME=... AT_API_KEY=... \
        uvicorn server.main:app --host 0.0.0.0 --port 8000

Interactive API docs: http://localhost:8000/docs

Endpoints
  POST /api/v1/houses                 register a house          (header X-Admin-Key)
  POST /api/v1/ingest                 gateway upload            (header X-Device-Key)
  GET  /api/v1/houses/{id}/status     latest advice + readings  (X-Device-Key or X-Admin-Key)
  POST /api/v1/sms                    Africa's Talking incoming-SMS callback (form data)
  GET  /health                        liveness check
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Form, Header, HTTPException  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.responses import PlainTextResponse  # noqa: E402

from server.schemas import HouseIn, IngestIn, IngestReply, StatusOut  # noqa: E402
from server.service import AirNestService, ServiceError  # noqa: E402


def create_app(db_path=None, model_dir=None, admin_key=None) -> FastAPI:
    svc = AirNestService(db_path or os.getenv("AIRNEST_DB", "airnest.db"),
                         model_dir or os.getenv("AIRNEST_MODELS", "models"),
                         admin_key or os.getenv("AIRNEST_ADMIN_KEY", ""))
    app = FastAPI(title="AirNest", version="1.0",
                  description="AI + IoT climate guardian for poultry houses")
    app.state.svc = svc

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

    @app.post("/api/v1/sms", response_class=PlainTextResponse)
    async def incoming_sms(from_: str = Form(default="", alias="from"),
                           text: str = Form(default="")):
        await call(svc.incoming_sms, from_, text)
        return ""

    return app


app = create_app()
