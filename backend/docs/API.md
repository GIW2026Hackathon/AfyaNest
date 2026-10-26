# AirNest API — guide for the frontend (React + Vite)

Base URL in development: `http://localhost:8000`
Live, clickable docs: `http://localhost:8000/docs`

The backend allows browser calls from `http://localhost:5173` (Vite's default).
For another address, start the backend with
`AIRNEST_CORS_ORIGINS=http://localhost:5173,https://your-site.example`.

Dashboard calls send the admin key in a header: `X-Admin-Key: <key>`.
(Fine for a hackathon demo. Before real farmers use it, replace this with proper user login.)

## Suggested `.env` in `frontend/`

```
VITE_API_URL=http://localhost:8000
VITE_ADMIN_KEY=secret
```

## Endpoints the dashboard needs

### `GET /health`
```json
{"ok": true, "model": "gbm_baseline", "detector": "robust_stats"}
```

### `GET /api/v1/houses` — list for the home screen
```json
[{"device_id": "house-001", "name": "Shamba la Wanjiku", "lang": "sw", "has_fan": true,
  "placement_ts": 1791000000, "level": "warn", "now_max_nh3": 23.4, "last_ts": 1793011200}]
```
`level` is one of `ok | watch | warn | danger` (null if no data yet). Suggested colours:
ok green, watch yellow, warn orange, danger red.

### `GET /api/v1/houses/{device_id}/status` — current advice card
```json
{"advice": {
   "ts": 1793011200, "now_max_nh3": 23.4, "level": "warn",
   "status_quo_peak_nh3": 34.1, "hours_to_warn": 2.0, "worst_node": "drinker_a",
   "plan": "air_0.5_for_0.5h", "plan_peak_nh3": 14.2, "plan_min_temp": 19.8,
   "plan_curtain": [0.5, 0.1, 0.1, 0.1, 0.1, 0.1],
   "climate": [{"kind": "cold", "level": "warn", "temp": 26.1, "comfort": [30, 34],
                "node": "brooder", "hours_to": 1.5}],
   "findings": [{"node": "drinker_b", "kind": "event", "type": "wet_litter",
                 "detail": "Ammonia and humidity rising together ..."}],
   "model": "gbm_baseline", "detector": "robust_stats"},
 "readings": [ ... last 12 h, raw rows ... ]}
```
* `status_quo_peak_nh3`: where ammonia is heading if the farmer changes nothing.
* `plan_peak_nh3`: where it goes if the advice is followed. Show these two side by side.
* `plan_curtain`: recommended curtain opening (0–1) for each of the next 6 hours.
* `advice` is `{"status": "warming_up", ...}` for the first 3 hours of a new house.

### `GET /api/v1/houses/{device_id}/history?hours=24` — charts and alert log
```json
{"readings": [{"ts": 1793011200, "node": 0, "nh3_ppm": 12.1, "temp_c": 24.3,
               "rh_pct": 71, "co2_ppm": 1450}],
 "alerts": [{"ts": 1793011200, "kind": "ammonia", "level": "warn",
             "message": "AirNest ONYO Shamba: Amonia itafika 34ppm ..."}]}
```
`hours` can be 1–336. Readings come every 10 minutes per sensor node.
Node numbers: 0 brooder, 1 drinker A, 2 drinker B, 3 centre, 4 curtain side, 5 fan end.

### `POST /api/v1/houses` — "add a farm" form
Body (JSON): `device_id`, `device_key` (min 8 chars), `name`, `phone` (`+2547...`),
optional `tech_phone`, `lang` (`sw`|`en`), `lat`, `lon`, `placement_ts` (unix seconds,
day chicks arrived), `has_fan`, `n_birds`. Returns `{"ok": true}`; invalid input → 422.

## Example (React)

```js
const API = import.meta.env.VITE_API_URL;
const headers = { "X-Admin-Key": import.meta.env.VITE_ADMIN_KEY };

export async function getHouses() {
  const r = await fetch(`${API}/api/v1/houses`, { headers });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export async function getHistory(id, hours = 24) {
  const r = await fetch(`${API}/api/v1/houses/${id}/history?hours=${hours}`, { headers });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
```

Poll every 60 seconds; data only changes every 10 minutes.

## Demo data without hardware

From `backend/`, with the server running:
`python tools/demo_feed.py` replays a simulated farm into the API so the dashboard
has live-looking data.
