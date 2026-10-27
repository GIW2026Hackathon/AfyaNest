"""One place that decides whether a message really goes to a farmer's phone.

Every SMS and voice call is written to the outbox with a status:
  sent      handed to Africa's Talking
  dry_run   AT not configured (development): logged only
  sandbox   test farmer: shown in the console only, never sent
  held      synthetic data / back-filled history: kept for the record, NOT sent
  failed    AT refused or network error

Rules: back-filled history is never sent. Synthetic data is sent only if the house has
"send TEST SMS" on (prefixed "TEST:"). Sandbox farmers never touch the phone network.
Replies to a farmer's own SMS always go out (they asked).
"""
from __future__ import annotations

import os

from . import notify

DELIVERED = ("sent", "dry_run", "sandbox")
DIRECT = ("reply", "welcome")        # go out even before the sensor box is live


def deliver(store, to: str | None, text: str, *, house: dict | None = None,
            farmer: dict | None = None, channel: str = "sms", kind: str = "alert",
            mode: str = "live") -> str:
    if not to:
        return "no_phone"
    sandbox = bool((house or {}).get("sandbox") or (farmer or {}).get("sandbox"))
    synthetic = house is not None and (house.get("source") or "synthetic") == "synthetic"
    fid = (farmer or {}).get("id") or (house or {}).get("farmer_id")
    stopped = False
    if fid and kind != "reply":
        row = store.q("SELECT status FROM farmers WHERE id=?", (fid,), one=True)
        stopped = bool(row and row["status"] == "stopped")
    if mode == "backfill":
        status = "held"
    elif stopped:
        status = "opted_out"                         # farmer sent STOP / chose "Stop SMS"
    elif sandbox:
        status = "sandbox"
    elif synthetic and kind not in DIRECT and not house.get("sms_test"):
        status = "held"
    else:
        body = ("TEST: " + text) if synthetic and kind not in DIRECT else text
        ok = notify.call(to, body) if channel == "voice" else notify.send_sms(to, body)
        status = ("dry_run" if notify.dry_run() else "sent") if ok else "failed"
    tenant = (house or farmer or {}).get("tenant_id")
    store.add_outbox(tenant, to, text, channel, kind, status,
                     farmer_id=(farmer or {}).get("id") or (house or {}).get("farmer_id"),
                     device_id=(house or {}).get("device_id"))
    return status


def voice_enabled() -> bool:
    return os.getenv("AIRNEST_VOICE", "1") == "1"
