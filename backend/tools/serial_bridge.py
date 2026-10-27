"""AfyaNest serial bridge: Arduino sensor box (USB) -> AfyaNest server.

Runs on the laptop / Raspberry Pi / old Android-with-Termux that the Arduino is plugged
into. Every minute it posts the current 10-minute average to /api/v1/ingest and sends
the server's answer back to the box (LEDs, buzzer, fan). If the server or internet is
down it keeps the readings on disk and uploads them later, while the box falls back
to its own safety rules.

    pip install pyserial
    export AFYANEST_DEVICE_KEY='<the gateway key shown when you added the house>'
    python tools/serial_bridge.py --port /dev/ttyACM0 --device-id house-001 \
        --api http://127.0.0.1:8000

    Windows: --port COM3        Find the port: Arduino IDE > Tools > Port
    Linux permission error: sudo usermod -aG dialout $USER  (then log out and in)

Never put the key on the command line of a shared machine (it shows in `ps`): use the
environment variable or --key-file (chmod 600).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from collections import deque

SLOT = 600                      # server works in 10-minute slots
LEVELS = {"ok": 0, "watch": 1, "warn": 2, "danger": 3}
log = logging.getLogger("afyanest.bridge")


# ------------------------------------------------------------------ parsing
def parse_line(line: str) -> dict | None:
    """'D,24.5,61.0,-1,-1,3600' -> {'temp_c':24.5,'rh_pct':61.0,'nh3_ppm':None,...}"""
    line = line.strip()
    if not line.startswith("D,"):
        return None
    parts = line.split(",")
    if len(parts) < 4:
        return None
    try:
        t, h, nh3 = float(parts[1]), float(parts[2]), float(parts[3])
        rs = float(parts[4]) if len(parts) > 4 else -1
    except ValueError:
        return None
    # reject physically impossible values (loose wire, electrical noise)
    if not (-20 <= t <= 70 and 0 <= h <= 100):
        return None
    return {"temp_c": t, "rh_pct": h,
            "nh3_ppm": nh3 if 0 <= nh3 <= 1000 else None,
            "rs_kohm": rs if rs > 0 else None}


class SlotAverager:
    """Average all samples that fall in the same 10-minute slot."""

    def __init__(self):
        self.slot = None
        self.acc: dict[str, list[float]] = {}

    def add(self, ts: float, sample: dict) -> dict | None:
        """Add a sample. Returns the finished previous slot when a new slot starts."""
        slot = int(ts // SLOT)
        done = None
        if self.slot is not None and slot != self.slot:
            done = self.current()
            self.acc = {}
        self.slot = slot
        for k, v in sample.items():
            if v is not None:
                self.acc.setdefault(k, []).append(v)
        return done

    def current(self) -> dict | None:
        if self.slot is None or not self.acc:
            return None
        out = {"ts": self.slot * SLOT + SLOT / 2}
        for k, vals in self.acc.items():
            out[k] = round(sum(vals) / len(vals), 2)
        return out


# ------------------------------------------------------------------ server
class Uploader:
    def __init__(self, api, device_id, key, node=0, queue_file=None, timeout=20):
        self.api, self.device_id, self.key, self.node = api.rstrip("/"), device_id, key, node
        self.timeout = timeout
        self.queue_file = queue_file
        self.backlog: deque = deque(maxlen=7 * 144)       # one week of 10-min slots
        if queue_file and os.path.exists(queue_file):
            try:
                self.backlog.extend(json.load(open(queue_file)))
            except Exception:
                log.warning("could not read backlog file, starting empty")

    def _save(self):
        if self.queue_file:
            tmp = self.queue_file + ".tmp"
            with open(tmp, "w") as f:
                json.dump(list(self.backlog), f)
            os.replace(tmp, self.queue_file)

    def _post(self, avg: dict) -> dict:
        node = {"node": self.node, **{k: avg[k] for k in ("temp_c", "rh_pct", "nh3_ppm", "rs_kohm")
                                      if avg.get(k) is not None}}
        body = json.dumps({"device_id": self.device_id, "ts": avg["ts"], "nodes": [node]}).encode()
        req = urllib.request.Request(f"{self.api}/api/v1/ingest", data=body, method="POST",
                                     headers={"Content-Type": "application/json",
                                              "X-Device-Key": self.key})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.load(r)

    def send(self, avg: dict, final: bool) -> dict | None:
        """Upload the slot average. Finished slots that fail go to the backlog."""
        reply = None
        try:
            while self.backlog:                       # oldest first, keep order
                self._post(self.backlog[0])
                self.backlog.popleft()
                self._save()
            reply = self._post(avg)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                log.error("server refused the device key (%s). Check --device-id and the key.", e.code)
            elif e.code == 422:
                log.error("server rejected the data: %s", e.read()[:200])
                return None
            else:
                log.warning("server error %s", e.code)
            if final:
                self.backlog.append(avg)
                self._save()
        except Exception as e:                        # offline, DNS, timeout...
            log.warning("server not reachable (%s); %d slots waiting", e.__class__.__name__,
                        len(self.backlog) + int(final))
            if final:
                self.backlog.append(avg)
                self._save()
        return reply


def reply_line(reply: dict) -> str:
    """L,level,fan,buzzer,heater,curtain%(-1 = leave),tlo*10,thi*10 (integers: AVR has no %f)."""
    def tenth(v):
        return int(round(float(v) * 10)) if v is not None else -1
    curtain = reply.get("curtain")
    return "L,{},{},{},{},{},{},{}\n".format(
        LEVELS.get(reply.get("level"), 0), int(reply.get("fan", 0) or 0),
        int(reply.get("buzzer", 0) or 0), int(reply.get("heater", 0) or 0),
        int(curtain) if curtain is not None else -1, tenth(reply.get("tlo")), tenth(reply.get("thi")))


# ------------------------------------------------------------------ main loop
def run(port, uploader: Uploader, every=60, clock=time.time, max_loops=None):
    """port: anything with readline() -> bytes and write(bytes) (pyserial or a fake)."""
    avg = SlotAverager()
    last_send = 0.0
    loops = 0
    while max_loops is None or loops < max_loops:
        loops += 1
        raw = port.readline()
        line = raw.decode(errors="ignore") if isinstance(raw, bytes) else (raw or "")
        if line.startswith(("HELLO", "CAL")):
            log.info("box: %s", line.strip())
        elif line.startswith("E,"):
            log.warning("box reports a problem: %s", line[2:].strip())
        sample = parse_line(line) if line else None
        now = clock()
        if sample:
            finished = avg.add(now, sample)
            if finished:                              # slot closed: upload the final value
                r = uploader.send(finished, final=True)
                if r:
                    port.write(reply_line(r).encode())
        if sample and now - last_send >= every and avg.current():
            last_send = now
            r = uploader.send(avg.current(), final=False)
            if r:
                port.write(reply_line(r).encode())
                log.info("sent T=%.1f H=%.0f NH3=%s -> %s", avg.current().get("temp_c", 0),
                         avg.current().get("rh_pct", 0), avg.current().get("nh3_ppm"), r)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", required=True, help="/dev/ttyACM0, /dev/ttyUSB0 or COM3")
    p.add_argument("--baud", type=int, default=9600)
    p.add_argument("--api", default=os.getenv("AFYANEST_API", "http://127.0.0.1:8000"))
    p.add_argument("--device-id", default=os.getenv("AFYANEST_DEVICE_ID"), required=False)
    p.add_argument("--key-file", help="file containing the gateway key (chmod 600)")
    p.add_argument("--node", type=int, default=0,
                   help="where the box hangs: 0 brooder, 1 drinker A, 2 drinker B, 3 centre, "
                        "4 curtain side, 5 fan end")
    p.add_argument("--every", type=int, default=60, help="seconds between uploads")
    p.add_argument("--queue-file", default=os.path.expanduser("~/.afyanest_backlog.json"))
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    key = (open(a.key_file).read().strip() if a.key_file else os.getenv("AFYANEST_DEVICE_KEY"))
    if not a.device_id or not key:
        sys.exit("Set --device-id and the key (AFYANEST_DEVICE_KEY or --key-file).")
    if a.api.startswith("http://") and not a.api.startswith(("http://127.", "http://localhost")):
        log.warning("Sending the device key over plain HTTP. Use https:// for a remote server.")
    try:
        import serial                                  # pyserial
    except ImportError:
        sys.exit("Install pyserial first:  pip install pyserial")
    up = Uploader(a.api, a.device_id, key, a.node, a.queue_file)
    while True:
        try:
            with serial.Serial(a.port, a.baud, timeout=5) as port:
                log.info("connected to %s, posting to %s as %s (node %d)", a.port, a.api,
                         a.device_id, a.node)
                run(port, up, a.every)
        except serial.SerialException as e:
            log.warning("serial port problem: %s - retrying in 10 s", e)
            time.sleep(10)
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()
