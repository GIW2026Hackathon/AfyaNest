"""Model 1 - Outbreak watch (open-source intelligence).

Every few hours: read public news and official feeds, find reports of poultry disease
outbreaks in Kenya, work out which counties they are about, score how credible they are,
and text farmers in and around those counties how to protect their flock.

Safety rules (a wrong outbreak SMS can cause panic and panic-selling):
  * Only messages written by us are ever sent - never text copied from the news.
  * Auto-send only when at least one report comes from an OFFICIAL source (government,
    WOAH, FAO, WHO, KALRO, UN) AND overall confidence >= AUTO_SEND_CONFIDENCE AND the
    county is known. Everything else waits on the dashboard for an owner/manager.
  * Regional reports (Uganda, Tanzania...) are shown for awareness, never auto-sent.
  * Each farmer gets at most one SMS per outbreak signal.
"""
from __future__ import annotations

import email.utils
import hashlib
import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from . import delivery, kenya

log = logging.getLogger("afyanest.osint")

AUTO_SEND_CONFIDENCE = float(os.getenv("AIRNEST_OSINT_AUTO_CONFIDENCE", "0.8"))
MAX_AGE_DAYS = 30
MAX_BYTES = 2_000_000

# ------------------------------------------------------------------ sources
_GN = "https://news.google.com/rss/search?q={q}&hl=en-KE&gl=KE&ceid=KE:en"
QUERIES = ['"Newcastle disease" Kenya', '"bird flu" Kenya', '"avian influenza" Kenya',
           'Gumboro Kenya chickens', 'poultry disease outbreak Kenya', '"fowl typhoid" Kenya',
           'kuku ugonjwa Kenya', 'chickens dying Kenya county']
SOURCES = [{"name": f"Google News: {q}", "url": _GN.format(q=urllib.parse.quote(q)), "kind": "rss"}
           for q in QUERIES]
# extra feeds (comma separated RSS/Atom URLs), e.g. a county veterinary office feed
for _u in filter(None, os.getenv("AIRNEST_OSINT_FEEDS", "").split(",")):
    SOURCES.append({"name": _u.strip(), "url": _u.strip(), "kind": "rss"})

OFFICIAL_DOMAINS = ("kilimo.go.ke", "go.ke", "woah.org", "oie.int", "fao.org", "who.int",
                    "kalro.org", "reliefweb.int", "ilri.org", "au-ibar.org", "igad.int")
TRUSTED_MEDIA = ("nation.africa", "standardmedia.co.ke", "the-star.co.ke", "kbc.co.ke",
                 "citizen.digital", "capitalfm.co.ke", "businessdailyafrica.com",
                 "kenyanews.go.ke", "farmersreviewafrica.com", "reuters.com", "bbc.com",
                 "apnews.com", "theeastafrican.co.ke")

# ------------------------------------------------------------------ classification
DISEASES = {
    "avian_influenza": ["avian influenza", "avian flu", "bird flu", "h5n1", "h5n8", "h5n6", "hpai",
                        "homa ya ndege", "mafua ya ndege"],
    "newcastle": ["newcastle disease", "newcastle virus", "mdondo", "kideri"],
    "gumboro": ["gumboro", "infectious bursal"],
    "fowl_typhoid": ["fowl typhoid", "salmonella gallinarum", "pullorum"],
    "fowl_pox": ["fowl pox", "fowlpox", "ndui ya kuku"],
    "coccidiosis": ["coccidiosis"],
}
POULTRY = ("chicken", "poultry", "bird", "layers", "broiler", "kuku", "flock", "hatcher",
           "kienyeji", "ducks", "turkeys")
OUTBREAK_WORDS = ("outbreak", "died", "dying", "deaths", "mass death", "confirmed", "cases",
                  "quarantine", "ban on movement", "culled", "mlipuko", "vifo")
NEGATIVE = ("newcastle united", "premier league", "football", "st james", "magpies", "eddie howe")
REGION = ("uganda", "tanzania", "ethiopia", "somalia", "south sudan", "rwanda", "burundi")

LABEL = {
    "en": {"avian_influenza": "Bird flu (avian influenza)", "newcastle": "Newcastle disease",
           "gumboro": "Gumboro (IBD)", "fowl_typhoid": "Fowl typhoid", "fowl_pox": "Fowl pox",
           "coccidiosis": "Coccidiosis", "poultry_disease": "A poultry disease"},
    "sw": {"avian_influenza": "Homa ya ndege (bird flu)", "newcastle": "Ugonjwa wa mdondo (Newcastle)",
           "gumboro": "Gumboro", "fowl_typhoid": "Homa ya matumbo ya kuku (fowl typhoid)",
           "fowl_pox": "Ndui ya kuku (fowl pox)", "coccidiosis": "Koksidiosisi",
           "poultry_disease": "Ugonjwa wa kuku"},
}

# Short, practical prevention advice (plain GSM text, about two SMS). Reviewed against
# common Kenyan extension guidance; always ends by pointing to the vet.
ADVICE = {
    "en": {
        "avian_influenza": "Keep birds inside, away from wild birds and ducks. Do not touch sick or dead birds with bare hands. Report sudden deaths to the county veterinary officer at once. Wash hands after handling birds.",
        "newcastle": "Vaccinate now if due (ask your vet). Keep visitors out, use a footbath at the door, do not bring in birds from markets this month. Separate sick birds and call the vet.",
        "gumboro": "Chicks 2-6 weeks are most at risk. Check the Gumboro vaccine schedule with your vet, clean drinkers daily, keep visitors out, separate sick chicks and call the vet.",
        "fowl_typhoid": "Give clean water, keep litter dry, do not bring in new birds. Separate sick birds, do not sell them, and ask the vet about treatment.",
        "fowl_pox": "Control mosquitoes, vaccinate if advised by your vet, separate birds with scabs and keep visitors out.",
        "coccidiosis": "Keep litter dry, fix leaking drinkers, clean feeders. If birds have bloody droppings call the vet for treatment.",
        "poultry_disease": "Keep visitors out, use a footbath, do not bring in new birds, and report sudden deaths to your vet or county veterinary officer.",
    },
    "sw": {
        "avian_influenza": "Weka kuku ndani, mbali na ndege wa porini na bata. Usishike kuku wagonjwa au waliokufa kwa mikono mitupu. Ripoti vifo vya ghafla kwa afisa wa mifugo wa kaunti mara moja. Nawa mikono.",
        "newcastle": "Chanja sasa kama muda umefika (uliza daktari wa mifugo). Zuia wageni, weka dawa ya miguu mlangoni, usinunue kuku sokoni mwezi huu. Tenga kuku wagonjwa, mpigie daktari.",
        "gumboro": "Vifaranga wa wiki 2-6 wako hatarini. Hakikisha ratiba ya chanjo ya Gumboro na daktari, safisha vyombo vya maji kila siku, zuia wageni, tenga wagonjwa, mpigie daktari.",
        "fowl_typhoid": "Wape maji safi, matandiko makavu, usilete kuku wapya. Tenga wagonjwa, usiwauze, uliza daktari kuhusu dawa.",
        "fowl_pox": "Dhibiti mbu, chanja kama daktari ameshauri, tenga kuku wenye vidonda, zuia wageni.",
        "coccidiosis": "Matandiko yawe makavu, rekebisha vyombo vya maji vinavyovuja, safisha vyombo vya chakula. Kinyesi chenye damu: mpigie daktari.",
        "poultry_disease": "Zuia wageni, weka dawa ya miguu mlangoni, usilete kuku wapya, ripoti vifo vya ghafla kwa daktari wa mifugo.",
    },
}


def sms_text(disease: str, area: str, lang: str = "sw") -> str:
    lang = lang if lang in ADVICE else "sw"
    name = LABEL[lang].get(disease, LABEL[lang]["poultry_disease"])
    adv = ADVICE[lang].get(disease, ADVICE[lang]["poultry_disease"])
    if lang == "sw":
        return f"AfyaNest TAHADHARI: {name} imeripotiwa {area}. {adv}"
    return f"AfyaNest ALERT: {name} reported in {area}. {adv}"


def _domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).hostname or ""
    except Exception:
        return ""


def source_weight(domain: str) -> tuple[float, bool]:
    d = domain.lower()
    if any(d == o or d.endswith("." + o) for o in OFFICIAL_DOMAINS):
        return 0.9, True
    if any(d == m or d.endswith("." + m) for m in TRUSTED_MEDIA):
        return 0.7, False
    return 0.45, False


def classify(title: str, text: str = "") -> dict | None:
    """Which disease, which places, how relevant. None = not a poultry outbreak report."""
    t = f" {title} {text} ".lower()
    if any(n in t for n in NEGATIVE):
        return None
    disease = next((d for d, kws in DISEASES.items() if any(k in t for k in kws)), None)
    poultry = any(p in t for p in POULTRY)
    outbreak = any(w in t for w in OUTBREAK_WORDS)
    if disease is None:
        if not (poultry and outbreak):
            return None
        disease = "poultry_disease"
    elif disease in ("newcastle", "gumboro", "coccidiosis", "fowl_pox", "fowl_typhoid") and not poultry \
            and "disease" not in t:
        return None
    counties = kenya.find_counties(t)
    kenya_mentioned = bool(counties) or "kenya" in t
    region = [r for r in REGION if r in t]
    if not kenya_mentioned and not region:
        return None
    scope = "county" if counties else "national" if kenya_mentioned else "regional"
    strength = 0.5 + 0.25 * outbreak + 0.25 * (disease != "poultry_disease")
    return {"disease": disease, "counties": sorted(counties), "scope": scope,
            "regional": region, "strength": strength}


# ------------------------------------------------------------------ fetching
def _safe_fetch(url: str, timeout=15) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("only https feeds are allowed")
    req = urllib.request.Request(url, headers={"User-Agent": "AfyaNest-OutbreakWatch/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(MAX_BYTES + 1)
    return check_xml(data)


def check_xml(data: bytes) -> bytes:
    """Refuse oversized feeds and any DTD/entity (blocks 'billion laughs' style attacks)."""
    if len(data) > MAX_BYTES:
        raise ValueError("feed too large")
    up = data.upper()
    if b"<!DOCTYPE" in up or b"<!ENTITY" in up:
        raise ValueError("feed contains DTD/entities - refused")
    return data


def parse_feed(data: bytes) -> list[dict]:
    """RSS 2.0 and Atom. Returns [{title, link, ts, domain, summary}]."""
    root = ET.fromstring(data)
    out = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = {c.tag.split("}")[-1]: c for c in it}
        title = (g["title"].text or "").strip() if "title" in g else ""
        link = ""
        if "link" in g:
            link = (g["link"].text or g["link"].get("href") or "").strip()
        src = g.get("source")
        domain = _domain(src.get("url", "")) if src is not None and src.get("url") else _domain(link)
        when = None
        for k in ("pubDate", "published", "updated"):
            if k in g and g[k].text:
                try:
                    when = email.utils.parsedate_to_datetime(g[k].text).timestamp()
                except Exception:
                    try:
                        from datetime import datetime
                        when = datetime.fromisoformat(g[k].text.replace("Z", "+00:00")).timestamp()
                    except Exception:
                        pass
                break
        summary = ""
        for k in ("description", "summary", "content"):
            if k in g and g[k].text:
                summary = re.sub(r"<[^>]+>", " ", g[k].text)[:600]
                break
        if title and link.startswith(("http://", "https://")):
            out.append({"title": title[:300], "link": link[:1000], "ts": when or time.time(),
                        "domain": domain, "summary": summary})
    return out


# ------------------------------------------------------------------ the watcher
class OutbreakWatch:
    def __init__(self, store, fetch=_safe_fetch, sources=None):
        self.store = store
        self.fetch = fetch
        self.sources = sources if sources is not None else SOURCES

    # ---- collect + score
    def run(self, now: float | None = None) -> dict:
        now = now or time.time()
        items, ok, failed = [], 0, 0
        for s in self.sources:
            try:
                items += parse_feed(check_xml(self.fetch(s["url"])))
                ok += 1
            except Exception as e:
                failed += 1
                log.warning("outbreak source failed: %s (%s)", s["name"], e.__class__.__name__)
        seen, signals = set(), {}
        for it in items:
            if it["link"] in seen or now - it["ts"] > MAX_AGE_DAYS * 86400:
                continue
            seen.add(it["link"])
            c = classify(it["title"], it["summary"])
            if not c:
                continue
            w, official = source_weight(it["domain"])
            conf = w * c["strength"]
            for county in (c["counties"] or (["Kenya"] if c["scope"] == "national" else ["Region"])):
                key = (c["disease"], county)
                sig = signals.setdefault(key, {"disease": c["disease"], "county": county,
                                               "scope": c["scope"], "items": [], "official": False})
                sig["items"].append({"title": it["title"], "link": it["link"], "ts": int(it["ts"]),
                                     "domain": it["domain"], "official": official,
                                     "confidence": round(conf, 2)})
                sig["official"] |= official
        n = 0
        for (disease, county), sig in signals.items():
            self._save(sig, now)
            n += 1
        from .store import upsert_sql
        self.store.q(upsert_sql("osint_runs", ("ts", "n_items", "n_signals", "sources_ok",
                                               "sources_failed", "note"), "ts"),
                     (int(now), len(items), n, ok, failed, None))
        sent = self.dispatch(now)
        return {"items": len(items), "signals": n, "sources_ok": ok, "sources_failed": failed,
                "auto_sent": sent}

    def _save(self, sig, now):
        month = time.strftime("%Y-%m", time.gmtime(min(i["ts"] for i in sig["items"])))
        sid = hashlib.sha256(f"{sig['disease']}|{sig['county']}|{month}".encode()).hexdigest()[:16]
        old = self.store.q("SELECT * FROM outbreak_signals WHERE id=?", (sid,), one=True)
        items = {i["link"]: i for i in (json.loads(old["items_json"]) if old else [])}
        for i in sig["items"]:
            items[i["link"]] = i
        items = sorted(items.values(), key=lambda i: -i["ts"])[:20]
        # independent reports raise confidence: 1 - prod(1 - c_i)
        p = 1.0
        for i in items:
            p *= 1 - i["confidence"]
        conf = min(0.97, 1 - p)
        last = max(i["ts"] for i in items)
        if now - last > 14 * 86400:
            conf *= 0.7
        official = int(any(i["official"] for i in items))
        domains = {i["domain"] for i in items}
        from .store import upsert_sql
        self.store.q(upsert_sql("outbreak_signals", ("id", "disease", "county", "scope", "first_seen",
                                                     "last_seen", "confidence", "official",
                                                     "n_sources", "items_json"), "id"),
                     (sid, sig["disease"], sig["county"], sig["scope"],
                      old["first_seen"] if old else min(i["ts"] for i in items), last,
                      round(conf, 3), official, len(domains), json.dumps(items)))

    # ---- who is affected
    def area_houses(self, signal, tenant_id=None) -> list[dict]:
        houses = (self.store.houses_for_tenant(tenant_id) if tenant_id else self.store.all_houses())
        if signal["scope"] == "regional":
            return []
        if signal["scope"] == "national" or signal["county"] == "Kenya":
            return houses
        zone = kenya.nearby(signal["county"])
        return [h for h in houses if (h.get("county") or kenya.county_of(h["lat"], h["lon"])) in zone]

    def dispatch(self, now=None) -> int:
        """Create per-tenant decisions; auto-send the ones that meet the safety rule."""
        now = now or time.time()
        sent = 0
        for sig in self.store.q("SELECT * FROM outbreak_signals WHERE last_seen>=?",
                                (int(now - MAX_AGE_DAYS * 86400),)):
            tenants = {h["tenant_id"] for h in self.area_houses(sig)}
            for tid in tenants:
                have = self.store.q("SELECT status FROM outbreak_alerts WHERE tenant_id=? AND signal_id=?",
                                    (tid, sig["id"]), one=True)
                if have:
                    continue
                auto = (sig["official"] and sig["confidence"] >= AUTO_SEND_CONFIDENCE
                        and sig["scope"] == "county")
                self.store.q("INSERT INTO outbreak_alerts (tenant_id, signal_id, status, ts) "
                             "VALUES (?,?,?,?)", (tid, sig["id"], "pending", int(now)))
                if auto:
                    sent += self.send(tid, sig["id"], actor=None, status="auto_sent")
        return sent

    def send(self, tenant_id, signal_id, actor=None, status="sent") -> int:
        sig = self.store.q("SELECT * FROM outbreak_signals WHERE id=?", (signal_id,), one=True)
        if not sig:
            return 0
        n = 0
        area = sig["county"] if sig["county"] not in ("Kenya", "Region") else "Kenya"
        for h in self.area_houses(sig, tenant_id):
            if not h["phone"]:
                continue
            if self.store.q("SELECT 1 AS x FROM outbreak_sms WHERE signal_id=? AND device_id=?",
                            (signal_id, h["device_id"]), one=True):
                continue
            text = sms_text(sig["disease"], area + (" na maeneo ya karibu" if h["lang"] == "sw" else " and nearby")
                            if sig["scope"] == "county" else area, h["lang"])
            deliver = delivery.deliver(self.store, h["phone"], text, house=h,
                                       kind="outbreak") in delivery.DELIVERED
            self.store.add_alert(h["device_id"], int(time.time()), f"outbreak:{sig['disease']}",
                                 "warn", text, delivered=deliver)
            self.store.q("INSERT INTO outbreak_sms (signal_id, device_id, ts) VALUES (?,?,?)",
                         (signal_id, h["device_id"], int(time.time())))
            n += int(deliver)                       # count only farmers actually texted
        self.store.q("UPDATE outbreak_alerts SET status=?, decided_by=?, ts=?, n_sent=n_sent+? "
                     "WHERE tenant_id=? AND signal_id=?",
                     (status, actor, int(time.time()), n, tenant_id, signal_id))
        return n

    # ---- dashboard
    def for_tenant(self, tenant_id, now=None) -> list[dict]:
        now = now or time.time()
        out = []
        rows = self.store.q("SELECT s.*, a.status, a.decided_by, a.ts AS decided_ts, a.n_sent FROM "
                            "outbreak_signals s JOIN outbreak_alerts a ON a.signal_id=s.id WHERE "
                            "a.tenant_id=? AND s.last_seen>=? ORDER BY s.last_seen DESC",
                            (tenant_id, int(now - 60 * 86400)))
        for r in rows:
            items = json.loads(r["items_json"] or "[]")
            houses = self.area_houses(r, tenant_id)
            area = r["county"] if r["county"] not in ("Kenya", "Region") else "Kenya"
            out.append({"id": r["id"], "disease": r["disease"], "label": LABEL["en"].get(r["disease"]),
                        "county": r["county"], "scope": r["scope"], "nearby": sorted(kenya.nearby(r["county"]))
                        if r["scope"] == "county" else [], "first_seen": r["first_seen"],
                        "last_seen": r["last_seen"], "confidence": r["confidence"],
                        "official": bool(r["official"]), "n_sources": r["n_sources"],
                        "status": r["status"], "n_sent": r["n_sent"], "houses_in_area": len(houses),
                        "sms_preview": {"sw": sms_text(r["disease"], area, "sw"),
                                        "en": sms_text(r["disease"], area, "en")},
                        "items": [{k: i[k] for k in ("title", "link", "ts", "domain", "official")}
                                  for i in items[:8]]})
        return out

    def status(self) -> dict:
        r = self.store.q("SELECT * FROM osint_runs ORDER BY ts DESC LIMIT 1", one=True)
        return {"last_run": r["ts"] if r else None, "sources": len(self.sources),
                "sources_ok": r["sources_ok"] if r else None,
                "sources_failed": r["sources_failed"] if r else None,
                "items": r["n_items"] if r else None, "signals": r["n_signals"] if r else None,
                "auto_send_confidence": AUTO_SEND_CONFIDENCE}
