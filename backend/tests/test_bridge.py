"""Serial bridge: parsing Arduino lines, 10-minute averaging, LED replies, offline backlog.

Run: python tests/test_bridge.py
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import serial_bridge as sb  # noqa: E402


def test_parse_line():
    assert sb.parse_line("D,24.0,61.0,-1,-1,120") == {"temp_c": 24.0, "rh_pct": 61.0,
                                                       "nh3_ppm": None, "rs_kohm": None}
    assert sb.parse_line("D,24.0,61.0,12.5,33.1,120")["nh3_ppm"] == 12.5
    for bad in ("", "HELLO,afyanest-uno,1", "D,abc,1,2", "D,99,50,-1", "D,20,140,-1", "D,1"):
        assert sb.parse_line(bad) is None, bad


def test_averaging_and_slot_close():
    a = sb.SlotAverager()
    t0 = 1_800_000_000 - 1_800_000_000 % 600
    assert a.add(t0 + 10, {"temp_c": 20, "rh_pct": 60, "nh3_ppm": None}) is None
    assert a.add(t0 + 70, {"temp_c": 22, "rh_pct": 62, "nh3_ppm": None}) is None
    assert a.current()["temp_c"] == 21 and "nh3_ppm" not in a.current()
    done = a.add(t0 + 610, {"temp_c": 30, "rh_pct": 50})
    assert done["temp_c"] == 21 and done["ts"] == t0 + 300
    assert a.current()["temp_c"] == 30


def test_reply_line():
    assert sb.reply_line({"level": "danger", "fan": 1, "buzzer": 1}) == "L,3,1,1,0,-1,-1,-1\n"
    assert sb.reply_line({"level": "ok"}) == "L,0,0,0,0,-1,-1,-1\n"
    # automatic response: heater on, curtains to 5 %, comfort band 27-31 C for the box fallback
    assert sb.reply_line({"level": "danger", "fan": 0, "buzzer": 1, "heater": 1, "curtain": 5,
                          "tlo": 27.0, "thi": 31.0}) == "L,3,0,1,1,5,270,310\n"


def test_offline_backlog_survives_restart():
    with tempfile.TemporaryDirectory() as d:
        q = os.path.join(d, "backlog.json")
        up = sb.Uploader("http://127.0.0.1:9", "h1", "k" * 20, queue_file=q, timeout=1)
        assert up.send({"ts": 1, "temp_c": 20, "rh_pct": 60}, final=True) is None
        assert up.send({"ts": 2, "temp_c": 21, "rh_pct": 60}, final=False) is None
        assert len(json.load(open(q))) == 1          # only finished slots are kept
        again = sb.Uploader("http://127.0.0.1:9", "h1", "k" * 20, queue_file=q, timeout=1)
        assert len(again.backlog) == 1


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
