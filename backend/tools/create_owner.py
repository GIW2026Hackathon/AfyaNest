"""Create an organisation and its first owner account (no built-in passwords).

    cd backend
    python tools/create_owner.py --org "Kiambu Poultry Co-op" --name "Jane Wanjiru" \
        --email jane@example.com [--platform-admin]

The password is typed in privately (not echoed, not stored in shell history).
Uses the same database settings as the server (AIRNEST_DATABASE_URL / AIRNEST_DATA_KEY).
"""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.auth import Auth, AuthError  # noqa: E402
from server.security import hash_password  # noqa: E402
from server.store import Store  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--org", required=True, help="farm or co-operative name")
    p.add_argument("--name", required=True, help="owner's full name")
    p.add_argument("--email", required=True)
    p.add_argument("--platform-admin", action="store_true",
                   help="can see the list of all organisations (never their farm data)")
    a = p.parse_args()

    store = Store()
    auth = Auth(store)
    email = auth._clean_email(a.email)
    if store.user_by_email(email):
        sys.exit("That email already has an account. Sign in, or reset it from the Team page.")
    pw = getpass.getpass("Choose a password (min 10 characters): ")
    if pw != getpass.getpass("Repeat the password: "):
        sys.exit("Passwords do not match.")
    try:
        auth._check_pw(pw, a.name, email)
    except AuthError as e:
        sys.exit(e.detail)
    tid = store.create_tenant(a.org.strip())
    uid = store.create_user(tid, email, a.name.strip(), hash_password(pw), "owner",
                            platform_admin=a.platform_admin)
    store.audit("tenant.created", tid, uid, tid, detail={"via": "cli"})
    print(f"Created '{a.org}' with owner {email}. Sign in on the dashboard and turn on "
          "two-step verification under Security.")


if __name__ == "__main__":
    main()
