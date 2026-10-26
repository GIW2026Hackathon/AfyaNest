"""Outside weather for the next 6 h (the forecaster needs it as a known future input).

Uses the free Open-Meteo API (no key) for the farm's coordinates and caches it
for an hour. If the internet fails it falls back to a typical highland Kenyan
day/night curve so the system keeps working.
"""
import json
import math
import time
import urllib.request
from datetime import datetime, timedelta, timezone

EAT = timezone(timedelta(hours=3))
_cache = {}


def _fallback(ts_list, t_mean=17.0, t_amp=6.0):
    out = []
    for ts in ts_list:
        h = datetime.fromtimestamp(ts, EAT).hour + datetime.fromtimestamp(ts, EAT).minute / 60
        t = t_mean + t_amp * math.cos(2 * math.pi * (h - 15) / 24)
        out.append((t, max(30.0, min(100.0, 75 - 3 * (t - t_mean)))))
    return out


def outside(lat, lon, ts_list, t_mean=17.0):
    """[(t_out, rh_out)] for each unix timestamp in ts_list."""
    if lat is None or lon is None:
        return _fallback(ts_list, t_mean)
    key = (round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if not hit or time.time() - hit[0] > 3600:
        try:
            url = ("https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f"
                   "&hourly=temperature_2m,relative_humidity_2m&past_days=1&forecast_days=2"
                   "&timezone=UTC" % (lat, lon))
            with urllib.request.urlopen(url, timeout=10) as r:
                d = json.load(r)["hourly"]
            times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()
                     for t in d["time"]]
            hit = (time.time(), times, d["temperature_2m"], d["relative_humidity_2m"])
            _cache[key] = hit
        except Exception:
            return _fallback(ts_list, t_mean)
    _, times, temps, rhs = hit
    out = []
    for ts in ts_list:
        i = min(range(len(times)), key=lambda k: abs(times[k] - ts))
        if abs(times[i] - ts) > 2 * 3600:
            out += _fallback([ts], t_mean)
        else:
            out.append((temps[i], rhs[i]))
    return out
