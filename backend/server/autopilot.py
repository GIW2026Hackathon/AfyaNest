"""Automatic response: what the sensor box does by itself when AfyaNest detects a problem.

The farmer is told by SMS/call, but the house does not wait for them. Each upload's reply
tells the box what to switch, based on the danger found now and the 6-hour plan:

    ammonia high     -> fan on, curtains opened to at least the plan's opening (min 40 %)
    cold for chicks  -> heater on, curtains closed down (5-10 %), fan off
    heat stress      -> fan on, curtains fully open, heater off
    otherwise        -> follow the gentlest plan (curtain) and keep chicks in their comfort band

Only equipment the house really has is switched (has_fan / has_heater / has_curtain). The box
also carries its own fallback (firmware) for when the server cannot be reached.
"""
from __future__ import annotations

RANK = {"ok": 0, "watch": 1, "warn": 2, "danger": 3}


def decide(house: dict, level: str, now_ppm: float | None, temp_now: float | None,
           comfort: tuple[float, float], climate: list[dict], plan_curtain: float | None,
           current_curtain: float | None) -> dict:
    """Return the commands for the box and plain-language notes of what was done."""
    has_fan = bool(house.get("has_fan"))
    has_heater = bool(house.get("has_heater"))
    has_curtain = bool(house.get("has_curtain"))
    lo, hi = comfort
    cold = next((c for c in climate if c["kind"] == "cold" and c.get("hours_to", 9) < 1.0), None)
    heat = next((c for c in climate if c["kind"] == "heat" and c.get("hours_to", 9) < 1.0), None)
    nh3_bad = now_ppm is not None and now_ppm >= 20
    fan, heater, curtain = 0, 0, None
    reasons = []

    if heat:
        fan, heater, curtain = 1, 0, 1.0
        reasons.append("heat")
    elif cold:
        heater = 1
        # close down to keep warmth, but never seal a house that also has ammonia
        curtain = max(0.2, plan_curtain or 0.2) if nh3_bad else 0.05
        fan = 0
        reasons.append("cold")
    elif nh3_bad:
        fan = 1
        curtain = max(0.4, plan_curtain or 0.4)
        reasons.append("ammonia")
    else:
        if plan_curtain is not None:
            curtain = plan_curtain
        # brooding: keep the chicks warm before it becomes a problem
        if temp_now is not None and temp_now < lo + 0.5:
            heater = 1

    cmd = {
        "fan": int(fan and has_fan),
        "heater": int(heater and has_heater),
        "curtain": (round(max(0.0, min(1.0, curtain)) * 100) if (has_curtain and curtain is not None)
                    else None),
        "buzzer": int(RANK.get(level, 0) >= 3),
        "tlo": round(lo, 1),
        "thi": round(hi, 1),
    }
    return {"cmd": cmd, "reasons": reasons, "done": _done(cmd, current_curtain)}


def _done(cmd: dict, current_curtain: float | None) -> list[str]:
    """Keys of the actions taken, for messages and the console."""
    out = []
    if cmd["fan"]:
        out.append("fan_on")
    if cmd["heater"]:
        out.append("heater_on")
    if cmd["curtain"] is not None:
        prev = None if current_curtain is None else round(current_curtain * 100)
        if prev is None or abs(cmd["curtain"] - prev) >= 10:
            out.append("curtain_open" if prev is None or cmd["curtain"] > prev else "curtain_close")
    if cmd["buzzer"]:
        out.append("alarm_on")
    return out


TEXT = {
    "sw": {"fan_on": "feni imewashwa", "heater_on": "joto limewashwa",
           "curtain_open": "pazia limefunguliwa hadi {c}%", "curtain_close": "pazia limefungwa hadi {c}%",
           "alarm_on": "kengele inalia bandani", "lead": "AfyaNest imechukua hatua: "},
    "en": {"fan_on": "fan switched on", "heater_on": "heater switched on",
           "curtain_open": "curtains opened to {c}%", "curtain_close": "curtains closed to {c}%",
           "alarm_on": "alarm sounding in the house", "lead": "AfyaNest has acted: "},
}


def done_text(auto: dict | None, lang: str) -> str:
    """' AfyaNest has acted: fan switched on, curtains opened to 60%.' or ''."""
    if not auto:
        return ""
    t = TEXT.get(lang, TEXT["en"])
    parts = [t[k].format(c=auto["cmd"].get("curtain")) for k in auto["done"] if k != "alarm_on"]
    if not parts:
        return ""
    return " " + t["lead"] + ", ".join(parts) + "."
