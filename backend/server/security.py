"""Security primitives for AfyaNest. Standard library + `cryptography` only.

* Passwords      scrypt (memory-hard, N=2^15 r=8 p=1), per-user salt, versioned
                 hash string so parameters can be raised later without a migration.
* PII at rest    AES-256-GCM field encryption (phone numbers, e-mails, GPS, names of
                 people). Lookups use a keyed blind index (HMAC-SHA256), so the DB
                 never holds a farmer's phone number in clear text.
* Secrets        session tokens, CSRF tokens, device keys and recovery codes are
                 high-entropy random values stored only as SHA-256 hashes.
* MFA            RFC 6238 TOTP (Google Authenticator, Authy, Microsoft Authenticator…)
* Abuse          sliding-window rate limiter (per IP + per bucket).

Keys come from the environment (`AIRNEST_DATA_KEY`, base64 32 bytes). In dev mode a
key is generated once into `.airnest_data_key` (chmod 600). In production a missing
key stops the server: silently running without encryption is worse than not running.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import struct
import threading
import time
from collections import defaultdict, deque

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = logging.getLogger("afyanest.security")


def env() -> str:
    """'dev' or 'production' (default). Production turns on every strict check."""
    return "dev" if os.getenv("AIRNEST_ENV", "production").lower() in ("dev", "development",
                                                                       "test") else "production"


# ---------------------------------------------------------------- random secrets
def token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def same(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(str(a), str(b))


# ---------------------------------------------------------------- passwords
_SCRYPT = dict(n=2 ** 15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
COMMON = {
    "password", "password1", "password123", "123456789", "1234567890", "qwerty123",
    "iloveyou", "admin1234", "welcome1", "letmein123", "kenya2024", "kenya2025",
    "kenya2026", "nairobi123", "kuku12345", "chicken123", "poultry123", "safaricom",
    "mpesa12345", "afyanest", "airnest123", "0712345678", "0722000000",
}


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, **_SCRYPT)
    return "scrypt$15$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: str | None) -> bool:
    if not stored:
        # spend the same time as a real check so attackers can't tell which
        # e-mail addresses exist from the response time
        hashlib.scrypt(pw.encode(), salt=b"0" * 16, **_SCRYPT)
        return False
    try:
        algo, ln, r, p, salt, dk = stored.split("$")
        assert algo == "scrypt"
        got = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=2 ** int(ln),
                             r=int(r), p=int(p), maxmem=_SCRYPT["maxmem"], dklen=32)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def password_problems(pw: str, *personal: str) -> list[str]:
    """Simple, explainable policy (NIST 800-63B style: length over complexity rules)."""
    out = []
    if len(pw) < 10:
        out.append("at least 10 characters")
    if len(pw) > 128:
        out.append("at most 128 characters")
    low = pw.lower()
    if low in COMMON or re.fullmatch(r"(.)\1+", pw) or re.fullmatch(r"\d+", pw):
        out.append("not a common or easily guessed password")
    words = {w for p in personal if p
             for w in re.split(r"[\s@._+-]+", p.lower().split("@")[0]) if len(w) >= 4}
    if any(w in low for w in words):
        out.append("must not contain your name or e-mail")
    if len(set(pw)) < 5:
        out.append("more variety of characters")
    return out


# ---------------------------------------------------------------- field encryption
class Vault:
    """AES-256-GCM field encryption + HMAC blind index."""

    def __init__(self, key_b64: str | None = None, key_file: str = ".airnest_data_key"):
        key_b64 = key_b64 or os.getenv("AIRNEST_DATA_KEY")
        if not key_b64:
            if env() == "production":
                raise RuntimeError(
                    "AIRNEST_DATA_KEY is not set. Generate one with\n"
                    "  python -c \"import os,base64;print(base64.b64encode(os.urandom(32)).decode())\"\n"
                    "and keep it in your secret manager. Losing it makes stored phone "
                    "numbers unreadable.")
            if os.path.exists(key_file):
                key_b64 = open(key_file).read().strip()
            else:
                key_b64 = base64.b64encode(os.urandom(32)).decode()
                fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(key_b64)
                log.warning("DEV MODE: generated data key in %s", key_file)
        master = base64.b64decode(key_b64)
        if len(master) != 32:
            raise RuntimeError("AIRNEST_DATA_KEY must be 32 bytes, base64-encoded")
        # separate sub-keys for encryption and indexing
        self._enc = AESGCM(hmac.new(master, b"afyanest-enc-v1", hashlib.sha256).digest())
        self._idx = hmac.new(master, b"afyanest-idx-v1", hashlib.sha256).digest()

    def enc(self, value, aad: str = "") -> str | None:
        if value is None:
            return None
        nonce = os.urandom(12)
        ct = self._enc.encrypt(nonce, str(value).encode(), aad.encode())
        return "v1:" + base64.b64encode(nonce + ct).decode()

    def dec(self, blob, aad: str = "") -> str | None:
        if blob is None:
            return None
        if not isinstance(blob, str) or not blob.startswith("v1:"):
            return blob                     # legacy plaintext (migrated on next write)
        raw = base64.b64decode(blob[3:])
        return self._enc.decrypt(raw[:12], raw[12:], aad.encode()).decode()

    def dec_float(self, blob, aad: str = "") -> float | None:
        v = self.dec(blob, aad)
        return None if v is None else float(v)

    def index(self, value: str | None) -> str | None:
        if not value:
            return None
        return hmac.new(self._idx, value.strip().lower().encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- TOTP (RFC 6238)
def totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def totp_verify(secret_b32: str, code: str, last_step: int | None = None,
                at: float | None = None) -> int | None:
    """Returns the matched time-step (store it to stop replay), or None."""
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    step = int((at or time.time()) // 30)
    for s in (step, step - 1, step + 1):              # +-30 s clock drift
        if (last_step is None or s > last_step) and hmac.compare_digest(_hotp(secret_b32, s), code):
            return s
    return None


def totp_uri(secret_b32: str, account: str, issuer: str = "AfyaNest") -> str:
    from urllib.parse import quote
    return (f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret_b32}"
            f"&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30")


def qr_svg(text: str) -> str:
    from .qrcodegen import QrCode
    qr = QrCode.encode_text(text, QrCode.Ecc.MEDIUM)
    n, b = qr.get_size(), 2
    parts = [f"M{x + b},{y + b}h1v1h-1z" for y in range(n) for x in range(n) if qr.get_module(x, y)]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n + 2 * b} {n + 2 * b}" '
            f'shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>'
            f'<path d="{" ".join(parts)}" fill="#0b0f0d"/></svg>')


def recovery_codes(n: int = 8) -> list[str]:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return ["-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))
            for _ in range(n)]


# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    """In-process sliding window. One API process per server is the expected
    deployment for small co-ops; behind several workers, swap for Redis."""

    def __init__(self):
        self._hits: dict[tuple, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, bucket: str, key: str, limit: int, window_s: int) -> bool:
        """Record a hit. False = over the limit (request must be refused)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[(bucket, key)]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            if len(self._hits) > 50_000:              # memory guard
                for k in list(self._hits)[:10_000]:
                    if not self._hits[k]:
                        del self._hits[k]
            return True

    def reset(self, bucket: str, key: str):
        with self._lock:
            self._hits.pop((bucket, key), None)
