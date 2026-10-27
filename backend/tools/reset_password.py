"""List staff accounts or set a new password (for someone locked out or who forgot it).

    cd backend
    python tools/reset_password.py --list
    python tools/reset_password.py --email you@example.com

Run on the server machine only. The new password is typed in privately (not echoed). The
account is unlocked and every open session for it is signed out.
Uses the same database settings as the server (AIRNEST_DATABASE_URL / AIRNEST_DATA_KEY).
"""
import argparse
import getpass
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.auth import Auth, AuthError  # noqa: E402
from server.security import hash_password  # noqa: E402
from server.store import Store  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="show staff emails, names and roles")
    g.add_argument("--email", help="account to give a new password")
    a = p.parse_args()

    store = Store()
    if a.list:
        tenants = {t["id"]: (store.tenant(t["id"]) or {}).get("name", "?")
                   for t in store.q("SELECT id FROM tenants")}
        for r in store.q("SELECT id FROM users ORDER BY created_ts"):
            u = store.user(r["id"])
            state = "blocked" if u["disabled"] else ("locked" if (u["locked_until"] or 0) > time.time() else "active")
            print(f"{u['email']:<36} {u['name']:<28} {u['role']:<8} {tenants.get(u['tenant_id'], '?'):<24} {state}")
        return

    auth = Auth(store)
    u = store.user_by_email(auth._clean_email(a.email))
    if not u:
        sys.exit("No account with that email. Use --list to see the accounts.")
    pw = getpass.getpass(f"New password for {u['email']} (min 10 characters): ")
    if pw != getpass.getpass("Repeat the password: "):
        sys.exit("Passwords do not match.")
    try:
        auth._check_pw(pw, u["name"], u["email"])
    except AuthError as e:
        sys.exit(e.detail)
    store.q("UPDATE users SET pw_hash=?, failed=0, locked_until=0, must_change_pw=0, "
            "pw_changed_ts=? WHERE id=?", (hash_password(pw), int(time.time()), u["id"]))
    store.q("DELETE FROM sessions WHERE user_id=?", (u["id"],))
    store.audit("user.password_reset_cli", u["tenant_id"], u["id"], u["id"])
    print(f"Password changed for {u['email']}. Sign in with it now.")


if __name__ == "__main__":
    main()
