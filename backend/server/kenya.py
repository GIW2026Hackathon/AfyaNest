"""Kenya's 47 counties: approximate centre (county headquarters) and common town names,
used to place houses in a county and to find counties mentioned in outbreak reports."""
from __future__ import annotations

import math
import re

COUNTIES = {
    "Mombasa": (-4.04, 39.67), "Kwale": (-4.17, 39.45), "Kilifi": (-3.63, 39.85),
    "Tana River": (-1.50, 40.03), "Lamu": (-2.27, 40.90), "Taita Taveta": (-3.40, 38.56),
    "Garissa": (-0.45, 39.65), "Wajir": (1.75, 40.06), "Mandera": (3.94, 41.86),
    "Marsabit": (2.33, 37.99), "Isiolo": (0.35, 37.58), "Meru": (0.05, 37.65),
    "Tharaka Nithi": (-0.33, 37.65), "Embu": (-0.53, 37.45), "Kitui": (-1.37, 38.01),
    "Machakos": (-1.52, 37.26), "Makueni": (-1.78, 37.63), "Nyandarua": (-0.27, 36.38),
    "Nyeri": (-0.42, 36.95), "Kirinyaga": (-0.50, 37.28), "Murang'a": (-0.72, 37.15),
    "Kiambu": (-1.17, 36.83), "Turkana": (3.12, 35.60), "West Pokot": (1.24, 35.12),
    "Samburu": (1.10, 36.70), "Trans Nzoia": (1.02, 35.00), "Uasin Gishu": (0.51, 35.27),
    "Elgeyo Marakwet": (0.67, 35.51), "Nandi": (0.20, 35.10), "Baringo": (0.47, 35.97),
    "Laikipia": (0.02, 37.07), "Nakuru": (-0.30, 36.07), "Narok": (-1.08, 35.87),
    "Kajiado": (-1.85, 36.78), "Kericho": (-0.37, 35.28), "Bomet": (-0.78, 35.34),
    "Kakamega": (0.28, 34.75), "Vihiga": (0.08, 34.72), "Bungoma": (0.56, 34.56),
    "Busia": (0.46, 34.11), "Siaya": (0.06, 34.29), "Kisumu": (-0.10, 34.76),
    "Homa Bay": (-0.53, 34.46), "Migori": (-1.06, 34.47), "Kisii": (-0.68, 34.77),
    "Nyamira": (-0.57, 34.94), "Nairobi": (-1.29, 36.82),
}

TOWNS = {
    "eldoret": "Uasin Gishu", "thika": "Kiambu", "ruiru": "Kiambu", "limuru": "Kiambu",
    "juja": "Kiambu", "kikuyu": "Kiambu", "githunguri": "Kiambu", "kitale": "Trans Nzoia",
    "naivasha": "Nakuru", "molo": "Nakuru", "njoro": "Nakuru", "nanyuki": "Laikipia",
    "nyahururu": "Laikipia", "malindi": "Kilifi", "watamu": "Kilifi", "voi": "Taita Taveta",
    "taveta": "Taita Taveta", "lodwar": "Turkana", "kapsabet": "Nandi", "kitengela": "Kajiado",
    "ngong": "Kajiado", "athi river": "Machakos", "mlolongo": "Machakos", "chuka": "Tharaka Nithi",
    "kerugoya": "Kirinyaga", "ol kalou": "Nyandarua", "iten": "Elgeyo Marakwet",
    "kabarnet": "Baringo", "maralal": "Samburu", "hola": "Tana River", "wote": "Makueni",
    "kapenguria": "West Pokot", "karatina": "Nyeri", "othaya": "Nyeri", "maua": "Meru",
    "mwingi": "Kitui", "ukunda": "Kwale", "diani": "Kwale", "kangundo": "Machakos",
    "kisumu city": "Kisumu", "kakamega town": "Kakamega", "mumias": "Kakamega",
    "webuye": "Bungoma", "litein": "Kericho", "keroka": "Nyamira", "ogembo": "Kisii",
    "rongo": "Migori", "awendo": "Migori", "mbita": "Homa Bay", "bondo": "Siaya",
}

_NORMAL = {c.lower().replace("'", "").replace("-", " "): c for c in COUNTIES}


def normalise(name: str | None) -> str | None:
    if not name:
        return None
    key = name.strip().lower().replace("'", "").replace("-", " ")
    key = re.sub(r"\s+county$", "", key)
    return _NORMAL.get(key)


def km(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = (math.sin((la2 - la1) * p / 2) ** 2 +
         math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def county_of(lat, lon) -> str | None:
    """Nearest county headquarters (good enough for outbreak matching)."""
    if lat is None or lon is None:
        return None
    if not (-5.0 <= lat <= 5.5 and 33.5 <= lon <= 42.5):
        return None
    return min(COUNTIES, key=lambda c: km((lat, lon), COUNTIES[c]))


def nearby(county: str, radius_km: float = 100) -> set[str]:
    """The county itself plus counties whose centres are within radius_km."""
    if county not in COUNTIES:
        return set()
    c = COUNTIES[county]
    return {k for k, v in COUNTIES.items() if km(c, v) <= radius_km}


def find_counties(text: str) -> set[str]:
    t = " " + re.sub(r"[^a-z' ]+", " ", text.lower().replace("-", " ")) + " "
    t = t.replace("'", "")
    out = {c for k, c in _NORMAL.items() if f" {k} " in t}
    out |= {c for town, c in TOWNS.items() if f" {town} " in t}
    # "Nairobi" also appears in datelines ("NAIROBI, Kenya -"): only count it with context
    if "Nairobi" in out and not re.search(r"nairobi (county|city|farms?|estates?|residents)|in nairobi", t):
        out.discard("Nairobi")
    return out
