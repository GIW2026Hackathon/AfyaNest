# AfyaNest security model

AfyaNest holds data about small-scale farmers: their phone numbers, farm locations and
flock performance. This page explains how that data is protected and what you must do
when you deploy.

## What is protected, and how

| Risk | Protection |
|---|---|
| Password guessing / credential stuffing | scrypt hashing (memory-hard), 20 attempts / 10 min per IP, 10 per account, lockout after 5 failures (15 min, doubling, max 24 h), common-password + "contains your name" checks |
| Stolen password | Optional TOTP two-step verification (any authenticator app) with 8 one-time recovery codes; owners can **require** it for the whole organisation; replay of a used code is refused |
| Session theft (XSS) | Session token lives in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie with the `__Host-` prefix; JavaScript never sees it. Strict Content-Security-Policy; no admin keys in the frontend bundle |
| Cross-site request forgery | Every write needs an `X-CSRF-Token` header matching a per-session token |
| Forgotten open sessions | 30 min idle timeout, 12 h absolute, token rotated after two-step login, "sign out everywhere", password change signs out other devices, active-device list |
| One customer reading another's farms (multi-tenant leak) | Every query is filtered by tenant; another tenant's house returns **404** (not 403), so IDs can't be probed; device IDs can't be re-registered by another tenant |
| Over-privileged staff | Roles: **owner** (everything), **manager** (houses, keys), **viewer** (read-only). Viewers see masked phone numbers. The last owner can't be removed |
| Database file stolen | Phone numbers, e-mails, people's names, GPS coordinates, IPs and TOTP secrets are AES-256-GCM encrypted (bound to the row); lookups use HMAC blind indexes; session tokens, CSRF tokens, gateway keys and recovery codes are stored only as SHA-256 hashes |
| Insider changes / disputes | Hash-chained audit log (sign-ins, failures, role changes, key rotations, deletions); owners see it and a tamper check |
| Stolen gateway | Per-house random keys, rotatable from the dashboard (old key stops working immediately). The USB bridge reads the key from an environment variable or a chmod-600 file, never the command line |
| No default passwords | There are no built-in accounts. The first owner is created with `tools/create_owner.py` (password typed privately) or by signing up |
| Fake SMS webhooks | `AIRNEST_SMS_TOKEN` is mandatory in production |
| Platform staff snooping | Platform admins see only organisation names and counts, never readings or phone numbers |
| Misc | HSTS, X-Frame-Options DENY, nosniff, no-referrer, Permissions-Policy, `Cache-Control: no-store` on the API, 512 KB body limit, `/docs` off in production |

## Deploying

```bash
# 1. secrets (keep them in a secret manager, never in git)
export AIRNEST_DATA_KEY=$(python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())")
export AIRNEST_SMS_TOKEN=$(python -c "import secrets;print(secrets.token_urlsafe(24))")
export AIRNEST_ADMIN_KEY=$(python -c "import secrets;print(secrets.token_urlsafe(32))")   # provisioning scripts only

# 2. build the dashboard and serve it from the API (same origin = simplest and safest)
cd frontend && npm ci && npm run build && cd ..
export AIRNEST_DATABASE_URL=postgresql://afyanest:PASSWORD@localhost:5432/afyanest
cd backend && AIRNEST_STATIC_DIR=../frontend/dist uvicorn server.main:app --host 127.0.0.1 --port 8000
```

Put Caddy or nginx with HTTPS in front (cookies are `Secure`; plain HTTP will not log in).
If the proxy sets `X-Forwarded-For`, add `AIRNEST_TRUST_PROXY=1` so rate limits see real IPs.

**Back up `AIRNEST_DATA_KEY`.** Without it the encrypted phone numbers can't be read.

| Variable | Default | Meaning |
|---|---|---|
| `AIRNEST_ENV` | `production` | `dev` = http cookies, /docs on, local key file |
| `AIRNEST_DATABASE_URL` | — (required) | `postgresql://afyanest:PASSWORD@localhost:5432/afyanest` |
| `AIRNEST_DATA_KEY` | — (required) | 32-byte base64 encryption key |
| `AIRNEST_SMS_TOKEN` | — (required) | add `?token=...` to the Africa's Talking callback URL |
| `AIRNEST_ADMIN_KEY` | — | enables `/api/v1/admin/tenants` for provisioning scripts |
| `AIRNEST_ALLOW_SIGNUP` | `1` | `0` = invitation only |
| `AIRNEST_SESSION_IDLE_MIN` / `_MAX_HOURS` | 30 / 12 | session lifetime |
| `AIRNEST_CORS_ORIGINS` | empty | only if the dashboard is on another origin |
| `AIRNEST_STATIC_DIR` | empty | serve the built dashboard |

## Known limits / next steps

* The SIM800L gateway talks plain HTTP, so the device key travels unencrypted over the
  mobile network. Next step: HMAC-sign each upload with a timestamp (key never sent) or
  move to a modem with TLS 1.2 (SIM7600/A7670).
* Rate limits are in-process; with several API workers use Redis.
* PostgreSQL is the production database. Next hardening step: row-level security as a
  second tenant guard, and encrypted, off-site backups (`pg_dump` + `age`/`gpg`).
* There is no e-mail password reset yet: owners reset their members' passwords from the
  Team page (temporary password, must change on first sign-in).
* `backend/airnest.db` is committed in the repository from earlier development; remove it
  from git history before going public.
