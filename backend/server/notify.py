"""SMS sending through Africa's Talking (widely used in Kenya).

Set AT_USERNAME, AT_API_KEY and optionally AT_SENDER_ID. Without them (or with
AIRNEST_DRY_RUN=1) messages are logged instead of sent, which is what the tests use.
"""
import logging
import os
import urllib.parse
import urllib.request

log = logging.getLogger("airnest.sms")
SENT = []                                   # in-memory log, handy for tests / dashboard


def send_sms(to: str, message: str) -> bool:
    SENT.append((to, message))
    user, key = os.getenv("AT_USERNAME"), os.getenv("AT_API_KEY")
    if os.getenv("AIRNEST_DRY_RUN") == "1" or not (user and key):
        log.info("DRY-RUN SMS to %s: %s", to, message)
        return True
    host = "api.sandbox.africastalking.com" if user == "sandbox" else "api.africastalking.com"
    data = {"username": user, "to": to, "message": message}
    if os.getenv("AT_SENDER_ID"):
        data["from"] = os.getenv("AT_SENDER_ID")
    req = urllib.request.Request(
        f"https://{host}/version1/messaging",
        data=urllib.parse.urlencode(data).encode(),
        headers={"apiKey": key, "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:                  # never crash ingestion because of SMS
        log.error("SMS failed: %s", e)
        return False


CALLS = []                                  # in-memory log of voice calls (tests)


def dry_run() -> bool:
    return os.getenv("AIRNEST_DRY_RUN") == "1" or not (os.getenv("AT_USERNAME") and os.getenv("AT_API_KEY"))


def call(to: str, message: str) -> bool:
    """Danger voice call through Africa's Talking Voice. Needs AT_VOICE_NUMBER; when the
    call is answered, AT fetches /api/v1/voice which reads `message` aloud."""
    CALLS.append((to, message))
    user, key, number = os.getenv("AT_USERNAME"), os.getenv("AT_API_KEY"), os.getenv("AT_VOICE_NUMBER")
    if dry_run() or not number:
        log.info("DRY-RUN CALL to %s: %s", to, message)
        return True
    req = urllib.request.Request(
        "https://voice.africastalking.com/call",
        data=urllib.parse.urlencode({"username": user, "from": number, "to": to}).encode(),
        headers={"apiKey": key, "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:
        log.error("voice call failed: %s", e)
        return False
