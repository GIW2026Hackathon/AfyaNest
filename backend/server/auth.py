"""Accounts, sessions, MFA and team management — independent of the web framework.

Threat model (small-scale farmers, co-operatives, extension officers):
  * credential stuffing / guessing   -> scrypt, per-IP rate limits, account lockout,
                                        common-password check, optional/required TOTP
  * stolen session / XSS / CSRF      -> opaque server-side sessions in HttpOnly
                                        SameSite=Strict cookies, CSRF token on every
                                        write, idle + absolute timeout, rotation on
                                        login/MFA, "log out everywhere"
  * one customer reading another's   -> every query is tenant-scoped; cross-tenant ids
    farms (IDOR)                        return 404, never 403
  * database theft                   -> PII encrypted (AES-GCM), secrets hashed
  * insider / after-the-fact review  -> hash-chained audit log, owners can read it
  * account enumeration              -> identical errors and timing for unknown e-mails
"""
from __future__ import annotations

import json
import os
import re
import time

from .security import (RateLimiter, hash_password, password_problems, qr_svg,
                       recovery_codes, sha256, token, totp_secret, totp_uri, totp_verify,
                       verify_password)
from .store import Store

ROLES = ("owner", "manager", "viewer")
IDLE_S = int(os.getenv("AIRNEST_SESSION_IDLE_MIN", "30")) * 60
ABSOLUTE_S = int(os.getenv("AIRNEST_SESSION_MAX_HOURS", "12")) * 3600
MFA_PENDING_S = 300
MAX_FAILS = 5
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)
GENERIC_LOGIN_ERROR = "Invalid email or password."


class AuthError(Exception):
    def __init__(self, status: int, detail: str, code: str | None = None):
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


class Auth:
    def __init__(self, store: Store):
        self.store = store
        self.rl = RateLimiter()
        # operator console: staff are created by an admin, never by self sign-up
        self.allow_signup = os.getenv("AIRNEST_ALLOW_SIGNUP", "0") == "1"

    # ============================================================ helpers
    def _limit(self, bucket, key, limit, window):
        if not self.rl.hit(bucket, key, limit, window):
            raise AuthError(429, "Too many attempts. Please wait a few minutes and try again.",
                            "rate_limited")

    @staticmethod
    def _clean_email(email: str) -> str:
        email = (email or "").strip().lower()
        if not EMAIL_RE.match(email):
            raise AuthError(422, "Enter a valid email address.")
        return email

    def _check_pw(self, pw, *personal):
        problems = password_problems(pw or "", *personal)
        if problems:
            raise AuthError(422, "Password needs: " + "; ".join(problems) + ".", "weak_password")

    def public_user(self, u: dict) -> dict:
        t = self.store.tenant(u["tenant_id"]) or {}
        return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
                "tenant": {"id": u["tenant_id"], "name": t.get("name"),
                           "require_mfa": bool(t.get("require_mfa"))},
                "mfa_enabled": bool(u["totp_enabled"]),
                "platform_admin": bool(u["is_platform_admin"]),
                "must_change_password": bool(u["must_change_pw"]),
                "mfa_setup_required": bool(t.get("require_mfa")) and not u["totp_enabled"],
                "last_login_ts": u["last_login_ts"], "lang": u["lang"]}

    # ============================================================ sessions
    def _new_session(self, u, stage, ip, ua) -> tuple[str, str]:
        tok, csrf = token(32), token(24)
        now = int(time.time())
        ttl = MFA_PENDING_S if stage == "mfa" else ABSOLUTE_S
        self.store.add_session(token_hash=sha256(tok), pub_id=token(9), user_id=u["id"],
                               tenant_id=u["tenant_id"], csrf_hash=sha256(csrf), stage=stage,
                               created_ts=now, last_seen_ts=now, expires_ts=now + ttl,
                               ip_enc=self.store.vault.enc(ip) if ip else None,
                               ua=(ua or "")[:160])
        # housekeeping: drop expired sessions
        self.store.q("DELETE FROM sessions WHERE expires_ts<? OR last_seen_ts<?",
                     (now, now - IDLE_S))
        return tok, csrf

    def session_user(self, tok: str | None, *, stage="full") -> tuple[dict, dict]:
        """Validate a session cookie. Returns (session row, user)."""
        if not tok or len(tok) > 100:
            raise AuthError(401, "Please sign in.", "no_session")
        s = self.store.session(sha256(tok))
        now = int(time.time())
        if not s or s["expires_ts"] < now or (s["stage"] == "full" and s["last_seen_ts"] < now - IDLE_S):
            if s:
                self.store.q("DELETE FROM sessions WHERE token_hash=?", (s["token_hash"],))
            raise AuthError(401, "Your session has ended. Please sign in again.", "expired")
        if s["stage"] != stage:
            raise AuthError(401, "Finish signing in first.", "mfa_pending")
        u = self.store.user(s["user_id"])
        if not u or u["disabled"] or u["tenant_id"] != s["tenant_id"]:
            self.store.q("DELETE FROM sessions WHERE token_hash=?", (s["token_hash"],))
            raise AuthError(401, "Please sign in.", "no_session")
        t = self.store.tenant(u["tenant_id"])
        if not t or t["status"] != "active":
            raise AuthError(403, "This account is suspended. Contact AfyaNest support.")
        if now - s["last_seen_ts"] > 30:                       # sliding idle window
            self.store.q("UPDATE sessions SET last_seen_ts=? WHERE token_hash=?",
                         (now, s["token_hash"]))
        return dict(s), u

    @staticmethod
    def check_csrf(session: dict, header_value: str | None):
        if not header_value or sha256(header_value) != session["csrf_hash"]:
            raise AuthError(403, "Security check failed. Reload the page and try again.", "csrf")

    # ============================================================ signup / login
    def signup(self, org_name, name, email, password, ip, ua):
        if not self.allow_signup:
            raise AuthError(403, "Self sign-up is turned off. Ask your co-operative admin "
                                 "for an invitation.")
        self._limit("signup", ip or "-", 5, 3600)
        email = self._clean_email(email)
        org_name, name = (org_name or "").strip()[:80], (name or "").strip()[:80]
        if len(org_name) < 2 or len(name) < 2:
            raise AuthError(422, "Enter your name and your farm or organisation name.")
        self._check_pw(password, name, email)
        if self.store.user_by_email(email):
            # do not reveal that the address is registered
            hash_password(password)
            raise AuthError(409, "We could not create that account. If you already have one, "
                                 "sign in instead.")
        tid = self.store.create_tenant(org_name)
        is_first = self.store.q("SELECT COUNT(*) c FROM users", one=True)["c"] == 0
        uid = self.store.create_user(tid, email, name, hash_password(password), "owner",
                                     platform_admin=is_first and
                                     os.getenv("AIRNEST_FIRST_USER_ADMIN", "0") == "1")
        self.store.audit("tenant.created", tid, uid, tid, ip=ip)
        u = self.store.user(uid)
        tok, csrf = self._new_session(u, "full", ip, ua)
        self.store.q("UPDATE users SET last_login_ts=? WHERE id=?", (int(time.time()), uid))
        return tok, csrf, self.public_user(self.store.user(uid))

    def login(self, email, password, ip, ua):
        self._limit("login-ip", ip or "-", 20, 600)
        try:
            email = self._clean_email(email)
        except AuthError:
            raise AuthError(401, GENERIC_LOGIN_ERROR, "bad_credentials")
        self._limit("login-acct", sha256(email), 10, 600)
        u = self.store.user_by_email(email)
        now = int(time.time())
        if u and u["locked_until"] and u["locked_until"] > now:
            self.store.audit("auth.login_blocked", u["tenant_id"], u["id"], ok=False, ip=ip)
            raise AuthError(429, "Too many attempts. Please wait a few minutes and try again.",
                            "locked")
        ok = verify_password(password or "", u["pw_hash"] if u else None)
        if not ok or not u or u["disabled"]:
            if u:
                fails = u["failed"] + 1
                lock = now + min(86400, 900 * 2 ** (fails - MAX_FAILS)) if fails >= MAX_FAILS else 0
                self.store.q("UPDATE users SET failed=?, locked_until=? WHERE id=?",
                             (fails, lock, u["id"]))
                self.store.audit("auth.login_failed", u["tenant_id"], u["id"], ok=False, ip=ip,
                                 detail={"locked": bool(lock)})
            raise AuthError(401, GENERIC_LOGIN_ERROR, "bad_credentials")
        self.store.q("UPDATE users SET failed=0, locked_until=0 WHERE id=?", (u["id"],))
        self.rl.reset("login-acct", sha256(email))
        if u["totp_enabled"]:
            tok, csrf = self._new_session(u, "mfa", ip, ua)
            return tok, csrf, {"mfa_required": True}
        return self._finish_login(u, ip, ua)

    def _finish_login(self, u, ip, ua):
        tok, csrf = self._new_session(u, "full", ip, ua)
        self.store.q("UPDATE users SET last_login_ts=? WHERE id=?", (int(time.time()), u["id"]))
        self.store.audit("auth.login", u["tenant_id"], u["id"], ip=ip)
        return tok, csrf, {"mfa_required": False, "user": self.public_user(self.store.user(u["id"]))}

    def verify_mfa(self, pending_tok, code, ip, ua):
        s, u = self.session_user(pending_tok, stage="mfa")
        self._limit("mfa", u["id"], 6, 300)
        code = (code or "").strip().lower()
        step = totp_verify(self.store.vault.dec(u["totp_enc"], u["id"]), code, u["totp_last_step"])
        if step is not None:
            self.store.q("UPDATE users SET totp_last_step=? WHERE id=?", (step, u["id"]))
        else:
            codes = json.loads(u["recovery_json"] or "[]")
            h = sha256(code)
            if h not in codes:
                self.store.audit("auth.mfa_failed", u["tenant_id"], u["id"], ok=False, ip=ip)
                raise AuthError(401, "That code is not correct. Check your authenticator app.",
                                "bad_mfa")
            codes.remove(h)
            self.store.q("UPDATE users SET recovery_json=? WHERE id=?", (json.dumps(codes), u["id"]))
            self.store.audit("auth.recovery_code_used", u["tenant_id"], u["id"], ip=ip,
                             detail={"left": len(codes)})
        # rotate: the pending token is discarded and a new full session is issued
        self.store.q("DELETE FROM sessions WHERE token_hash=?", (s["token_hash"],))
        return self._finish_login(u, ip, ua)

    def logout(self, s, u, ip, everywhere=False):
        if everywhere:
            self.store.q("DELETE FROM sessions WHERE user_id=?", (u["id"],))
        else:
            self.store.q("DELETE FROM sessions WHERE token_hash=?", (s["token_hash"],))
        self.store.audit("auth.logout_all" if everywhere else "auth.logout",
                         u["tenant_id"], u["id"], ip=ip)

    # ============================================================ self-service
    def change_password(self, s, u, current, new, ip):
        self._limit("pwchange", u["id"], 5, 900)
        if not verify_password(current or "", u["pw_hash"]):
            self.store.audit("auth.password_change_failed", u["tenant_id"], u["id"], ok=False, ip=ip)
            raise AuthError(401, "Your current password is not correct.")
        if current == new:
            raise AuthError(422, "Choose a password you have not used here before.")
        self._check_pw(new, u["name"], u["email"])
        self.store.q("UPDATE users SET pw_hash=?, must_change_pw=0, pw_changed_ts=? WHERE id=?",
                     (hash_password(new), int(time.time()), u["id"]))
        # sign out every other device
        self.store.q("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
                     (u["id"], s["token_hash"]))
        self.store.audit("auth.password_changed", u["tenant_id"], u["id"], ip=ip)

    def mfa_setup(self, u):
        if u["totp_enabled"]:
            raise AuthError(409, "Two-step verification is already on.")
        # reuse a pending (not yet confirmed) secret so a repeated request — a second
        # tab, a refresh — never leaves the QR code and the server out of step
        secret = self.store.vault.dec(u["totp_enc"], u["id"]) if u["totp_enc"] else None
        if not secret:
            secret = totp_secret()
            self.store.q("UPDATE users SET totp_enc=? WHERE id=?",
                         (self.store.vault.enc(secret, u["id"]), u["id"]))
        uri = totp_uri(secret, u["email"])
        return {"secret": secret, "otpauth_uri": uri, "qr_svg": qr_svg(uri)}

    def mfa_enable(self, u, code, ip):
        self._limit("mfa", u["id"], 6, 300)
        secret = self.store.vault.dec(u["totp_enc"], u["id"]) if u["totp_enc"] else None
        step = totp_verify(secret, code) if secret else None
        if step is None:
            raise AuthError(422, "That code is not correct. Scan the QR code again and enter "
                                 "the 6-digit code.")
        codes = recovery_codes()
        self.store.q("UPDATE users SET totp_enabled=1, totp_last_step=?, recovery_json=? WHERE id=?",
                     (step, json.dumps([sha256(c) for c in codes]), u["id"]))
        self.store.audit("auth.mfa_enabled", u["tenant_id"], u["id"], ip=ip)
        return {"recovery_codes": codes}

    def mfa_disable(self, s, u, password, ip):
        t = self.store.tenant(u["tenant_id"])
        if t and t["require_mfa"]:
            raise AuthError(403, "Your organisation requires two-step verification.")
        if not verify_password(password or "", u["pw_hash"]):
            raise AuthError(401, "Your password is not correct.")
        self.store.q("UPDATE users SET totp_enabled=0, totp_enc=NULL, recovery_json=NULL "
                     "WHERE id=?", (u["id"],))
        self.store.audit("auth.mfa_disabled", u["tenant_id"], u["id"], ip=ip)

    def sessions(self, s, u):
        rows = self.store.q("SELECT pub_id, created_ts, last_seen_ts, ua, token_hash FROM sessions "
                            "WHERE user_id=? AND stage='full' ORDER BY last_seen_ts DESC", (u["id"],))
        return [{"id": r["pub_id"], "created_ts": r["created_ts"],
                 "last_seen_ts": r["last_seen_ts"], "device": _device(r["ua"]),
                 "current": r["token_hash"] == s["token_hash"]} for r in rows]

    def revoke_session(self, u, pub_id, ip):
        self.store.q("DELETE FROM sessions WHERE user_id=? AND pub_id=?", (u["id"], pub_id))
        self.store.audit("session.revoked", u["tenant_id"], u["id"], pub_id, ip=ip)

    # ============================================================ team (owner)
    @staticmethod
    def require_role(u, *roles):
        if u["role"] not in roles:
            raise AuthError(403, "Your role does not allow this.", "forbidden")

    def team(self, u):
        self.require_role(u, "owner", "manager")
        return [{"id": m["id"], "name": m["name"], "email": m["email"], "role": m["role"],
                 "mfa_enabled": bool(m["totp_enabled"]), "disabled": bool(m["disabled"]),
                 "last_login_ts": m["last_login_ts"], "you": m["id"] == u["id"]}
                for m in self.store.users_in(u["tenant_id"])]

    def invite(self, u, email, name, role, ip):
        """Owner adds a team member. Returns a one-time temporary password that must be
        changed at first sign-in (share it in person or by phone, never by group chat)."""
        self.require_role(u, "owner")
        if role not in ROLES:
            raise AuthError(422, "Unknown role.")
        email = self._clean_email(email)
        if self.store.user_by_email(email):
            raise AuthError(409, "That email address already has an AfyaNest account.")
        temp = "-".join(token(4).replace("_", "x").replace("-", "y")[:5] for _ in range(4))
        uid = self.store.create_user(u["tenant_id"], email, (name or email).strip()[:80],
                                     hash_password(temp), role, must_change=True)
        self.store.audit("user.invited", u["tenant_id"], u["id"], uid, ip=ip, detail={"role": role})
        return {"id": uid, "temporary_password": temp}

    def _member(self, u, member_id):
        m = self.store.user(member_id)
        if not m or m["tenant_id"] != u["tenant_id"]:
            raise AuthError(404, "No such team member.")
        return m

    def _owners_left(self, tenant_id, excluding):
        return self.store.q("SELECT COUNT(*) c FROM users WHERE tenant_id=? AND role='owner' "
                            "AND disabled=0 AND id<>?", (tenant_id, excluding), one=True)["c"]

    def update_member(self, u, member_id, role=None, disabled=None, ip=None):
        self.require_role(u, "owner")
        m = self._member(u, member_id)
        if (role and role != "owner" and m["role"] == "owner") or disabled:
            if m["role"] == "owner" and self._owners_left(u["tenant_id"], m["id"]) == 0:
                raise AuthError(409, "Every organisation needs at least one active owner.")
        if role:
            if role not in ROLES:
                raise AuthError(422, "Unknown role.")
            self.store.q("UPDATE users SET role=? WHERE id=?", (role, m["id"]))
            self.store.audit("user.role_changed", u["tenant_id"], u["id"], m["id"], ip=ip,
                             detail={"from": m["role"], "to": role})
        if disabled is not None:
            self.store.q("UPDATE users SET disabled=? WHERE id=?", (int(disabled), m["id"]))
            if disabled:
                self.store.q("DELETE FROM sessions WHERE user_id=?", (m["id"],))
            self.store.audit("user.disabled" if disabled else "user.enabled",
                             u["tenant_id"], u["id"], m["id"], ip=ip)

    def reset_member_password(self, u, member_id, ip):
        self.require_role(u, "owner")
        m = self._member(u, member_id)
        temp = "-".join(token(4).replace("_", "x").replace("-", "y")[:5] for _ in range(4))
        self.store.q("UPDATE users SET pw_hash=?, must_change_pw=1, failed=0, locked_until=0, "
                     "totp_enabled=0, totp_enc=NULL, recovery_json=NULL WHERE id=?",
                     (hash_password(temp), m["id"]))
        self.store.q("DELETE FROM sessions WHERE user_id=?", (m["id"],))
        self.store.audit("user.password_reset", u["tenant_id"], u["id"], m["id"], ip=ip)
        return {"temporary_password": temp}

    def set_org(self, u, require_mfa=None, name=None, ip=None):
        self.require_role(u, "owner")
        tid = u["tenant_id"]
        if require_mfa is not None:
            if require_mfa and not u["totp_enabled"]:
                raise AuthError(409, "Turn on two-step verification for yourself first.")
            self.store.q("UPDATE tenants SET require_mfa=? WHERE id=?", (int(require_mfa), tid))
            self.store.audit("org.require_mfa", tid, u["id"], ip=ip, detail={"on": bool(require_mfa)})
        if name:
            self.store.q("UPDATE tenants SET name_enc=? WHERE id=?",
                         (self.store.vault.enc(name.strip()[:80], tid), tid))
            self.store.audit("org.renamed", tid, u["id"], ip=ip)

    def audit_log(self, u, limit=200):
        self.require_role(u, "owner")
        names = {m["id"]: m["name"] for m in self.store.users_in(u["tenant_id"])}
        rows = self.store.q("SELECT seq, ts, user_id, action, target, ok, detail FROM audit_log "
                            "WHERE tenant_id=? ORDER BY seq DESC LIMIT ?",
                            (u["tenant_id"], max(1, min(limit, 1000))))
        return {"chain_ok": self.store.audit_chain_ok(),
                "entries": [{"seq": r["seq"], "ts": r["ts"], "action": r["action"],
                             "actor": names.get(r["user_id"], "system"),
                             "target": r["target"], "ok": bool(r["ok"]),
                             "detail": json.loads(r["detail"]) if r["detail"] else None}
                            for r in rows]}


def _device(ua: str | None) -> str:
    ua = ua or ""
    os_ = next((n for k, n in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"),
                               ("Windows", "Windows"), ("Mac OS", "Mac"), ("Linux", "Linux"))
                if k in ua), "Unknown device")
    br = next((n for k, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"),
                              ("Firefox/", "Firefox"), ("Safari/", "Safari")) if k in ua), "")
    return f"{br} on {os_}".strip() if br else os_
