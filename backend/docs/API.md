# AfyaNest API — guide for the dashboard

Live docs in dev mode: `http://localhost:8000/docs` (start with `AIRNEST_ENV=dev`).
Storage: PostgreSQL (`AIRNEST_DATABASE_URL`).
Security design: see `../../SECURITY.md`.

## How the dashboard talks to the API

* **Same origin.** `npm run dev` proxies `/api` to `http://127.0.0.1:8000` (see `vite.config.js`).
  In production serve `frontend/dist` from FastAPI (`AIRNEST_STATIC_DIR`) or one reverse proxy.
* **Cookie session.** `POST /api/v1/auth/login` sets an HttpOnly session cookie and a readable
  CSRF cookie, and returns `{"csrf": ...}`. Send `credentials: "same-origin"` and, on every
  POST/PATCH/DELETE, the header `X-CSRF-Token: <csrf>`. `src/api.js` does all of this.
* There is **no admin key in the frontend** any more.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | `{org_name, name, email, password}` → new organisation (tenant) + owner |
| POST | `/api/v1/auth/login` | `{email, password}` → `{mfa_required, user?, csrf}` |
| POST | `/api/v1/auth/mfa` | `{code}` 6-digit TOTP or a recovery code (after `mfa_required`) |
| POST | `/api/v1/auth/logout[?everywhere=true]` | |
| GET | `/api/v1/auth/me` | user, role, tenant, `must_change_password`, `mfa_setup_required` |
| POST | `/api/v1/auth/password` | `{current_password, new_password}` |
| POST | `/api/v1/auth/mfa/setup` · `/enable` · `/disable` | QR (SVG), then `{code}` → recovery codes |
| GET / DELETE | `/api/v1/auth/sessions[/{id}]` | signed-in devices |

Errors: `{"detail": "...", "code": "..."}`; codes include `password_change_required`,
`mfa_setup_required`, `csrf`, `rate_limited`, `expired`.

## Team (owner; managers can list)
`GET/POST /api/v1/team`, `PATCH /api/v1/team/{id}` `{role?, disabled?}`,
`POST /api/v1/team/{id}/reset-password`, `PATCH /api/v1/org` `{name?, require_mfa?}`,
`GET /api/v1/audit` → `{chain_ok, entries[]}`.

## Houses (always limited to the caller's organisation)
| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/houses` | any — list with level, NH₃/temp/RH now, 24 h sparkline, online |
| POST | `/api/v1/houses` | owner/manager — returns `device_key` once if you didn't supply one |
| GET | `/api/v1/houses/{id}` | any — detail + `advice` (incl. `forecast` curves, `action_en/sw`) + sensor layout |
| PATCH | `/api/v1/houses/{id}` | owner/manager |
| DELETE | `/api/v1/houses/{id}` | owner |
| POST | `/api/v1/houses/{id}/rotate-key` | owner/manager |
| GET | `/api/v1/houses/{id}/history?hours=24` | any — `readings`, `controls` (curtain/fan), `alerts`, `comfort` |

`advice.forecast` = `{hours[], status_quo:{nh3_p10,nh3_p50,nh3_p90,temp_min,temp_max}, plan:{...}}`
every 20 minutes for 6 hours.

## Gateway and integrations
* `POST /api/v1/ingest` with `X-Device-Key` (unchanged for the firmware)
* `GET /api/v1/devices/{id}/status` with `X-Device-Key`
* `POST /api/v1/sms?token=AIRNEST_SMS_TOKEN` (Africa's Talking callback)
* `POST /api/v1/admin/tenants` and `/api/v1/admin/tenants/{tid}/houses` with `X-Admin-Key` (provisioning)

## Sensor boxes

The Arduino Uno box talks to `tools/serial_bridge.py` over USB; the bridge posts to
`/api/v1/ingest` with the house's gateway key. See `HARDWARE.md`.
A box without an ammonia sensor sends only temperature/humidity: `advice.has_nh3` is
`false`, ammonia fields are `null`, and advice is based on the comfort band for the birds' age.

`GET /health` → `{"ok": true, "db": "postgres", "model": ..., "time": ..., "uptime_s": ...}`
(503 when the database is unreachable). The dashboard polls it for the "Server live" indicator.

## The three models

* `GET /api/v1/models` — status of outbreak watch, detection and prediction + how many houses are synthetic/live.
* `GET /api/v1/outbreaks` — outbreak reports that affect the caller's houses, with confidence, sources, SMS preview and status (`pending | auto_sent | sent | dismissed`).
* `POST /api/v1/outbreaks/{id}/approve` (owner/manager) — text the farmers in the area (each farmer once per outbreak).
* `POST /api/v1/outbreaks/{id}/dismiss`, `POST /api/v1/outbreaks/refresh` (max once per 10 min).
* `GET /api/v1/counties` — the 47 counties for the house form.

House fields: `source` (`synthetic | live`), `sms_test` (bool), `county`.
`advice.detection` = what is wrong now; `advice.next_check` = `{local: "02:30", in_hours, reason}`;
`advice.data_mode` = `live | synthetic`. Alerts have `delivered` (false = logged, not texted).
