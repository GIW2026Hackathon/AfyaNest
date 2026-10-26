"""Farmer-facing SMS text in Swahili and English.

Kept short, plain GSM-7 characters (no emoji) so every message fits a single
cheap SMS and works on any feature phone.
"""
from airnest.controller import Advice

ZONES = {
    "sw": {"brooder": "eneo la vifaranga", "drinker_a": "maji A", "drinker_b": "maji B",
           "centre": "katikati", "curtain_west": "upande wa pazia",
           "exhaust_east": "upande wa feni"},
    "en": {"brooder": "brooder", "drinker_a": "drinker line A", "drinker_b": "drinker line B",
           "centre": "centre", "curtain_west": "curtain side", "exhaust_east": "fan end"},
}

LEVEL = {"sw": {"watch": "TAHADHARI", "warn": "ONYO", "danger": "HATARI"},
         "en": {"watch": "WATCH", "warn": "WARNING", "danger": "DANGER"}}


def action_text(plan, current_curtain, lang):
    m = plan.meta
    sw = lang == "sw"
    parts = []
    if plan.name.startswith("air_"):
        pct, hrs = int(m["c"] * 100), m["hours"]
        if hrs < 1:
            dur_sw, dur_en = f"dakika {int(hrs * 60)}", f"{int(hrs * 60)} min"
        else:
            dur_sw, dur_en = f"saa {hrs:g}", f"{hrs:g} h"
        parts.append(f"Fungua pazia {pct}% kwa {dur_sw}, kisha rudisha" if sw else
                     f"Open curtains to {pct}% for {dur_en}, then return them")
    elif plan.name.startswith("curtain_"):
        pct = int(m["c"] * 100)
        if m["c"] > current_curtain + 0.05:
            parts.append(f"Fungua pazia hadi {pct}%" if sw else f"Open curtains to {pct}%")
        elif m["c"] < current_curtain - 0.05:
            parts.append(f"Funga pazia hadi {pct}%" if sw else f"Close curtains to {pct}%")
    if "fan_hours" in m:
        k = m["fan_hours"]
        parts.append(f"washa feni saa {k}" if sw else f"run the fan for {k} h")
    if not parts:
        return "Endelea kama kawaida" if sw else "Keep going as usual"
    return ", ".join(parts)


def advice_sms(house_name, adv: Advice, now_ppm, current_curtain, comfort_low, lang="sw"):
    zone = ZONES[lang].get(adv.worst_node, adv.worst_node)
    act = action_text(adv.best, current_curtain, lang)
    lvl = LEVEL[lang][adv.level]
    if lang == "sw":
        when = (f"itafika {adv.status_quo_peak_nh3:.0f}ppm ndani ya saa {adv.hours_to_warn:.0f}"
                if adv.hours_to_warn and now_ppm < 20 else f"iko {now_ppm:.0f}ppm")
        msg = f"AirNest {lvl} {house_name}: Amonia {when} ({zone}). {act}."
        if adv.best_min_temp < comfort_low - 3:
            msg += " Kuku wataona baridi: ongeza joto/matandiko makavu."
    else:
        when = (f"will reach {adv.status_quo_peak_nh3:.0f}ppm within {adv.hours_to_warn:.0f}h"
                if adv.hours_to_warn and now_ppm < 20 else f"is {now_ppm:.0f}ppm")
        msg = f"AirNest {lvl} {house_name}: Ammonia {when} ({zone}). {act}."
        if adv.best_min_temp < comfort_low - 3:
            msg += " Birds will be cold: add heat/dry litter."
    return msg


def finding_sms(house_name, f, lang="sw"):
    zone = ZONES[lang].get(f["node"], f["node"])
    if lang == "sw":
        if f["type"] == "wet_litter":
            return (f"AirNest {house_name}: Amonia na unyevu vinapanda {zone}. "
                    "Angalia maji yanayovuja, badilisha matandiko yaliyolowa.")
        if f["type"] == "heater_failure":
            return (f"AirNest {house_name}: Joto la vifaranga linashuka. "
                    "Angalia jiko/brooder sasa.")
        return f"AirNest {house_name}: Sensa ya {zone} ina hitilafu. Safisha au mwite fundi."
    if f["type"] == "wet_litter":
        return (f"AirNest {house_name}: Ammonia and humidity rising at {zone}. "
                "Check for a leaking drinker and replace wet litter.")
    if f["type"] == "heater_failure":
        return f"AirNest {house_name}: Brooder temperature dropping. Check the heater now."
    return f"AirNest {house_name}: Sensor at {zone} looks faulty. Clean it or call the technician."


def climate_sms(house_name, risk, plan, current_curtain, lang="sw"):
    """Cold-chick / heat-stress warning with a practical fix."""
    zone = ZONES[lang].get(risk["node"], risk["node"])
    lo, hi = risk["comfort"]
    t, h = risk["temp"], risk["hours_to"]
    lvl = LEVEL[lang][risk["level"]]
    act = action_text(plan, current_curtain, lang)
    if act.startswith(("Endelea", "Keep going")):
        act = ""                                   # nothing to change on ventilation
    act_s = f" {act}." if act else ""
    soon = h < 0.25
    if lang == "sw":
        when = "sasa" if soon else f"ndani ya saa {max(1, round(h))}"
        if risk["kind"] == "cold":
            return (f"AirNest {lvl} {house_name}: Baridi {when}, {t:.0f}C {zone} "
                    f"(kuku wanahitaji {lo:.0f}-{hi:.0f}C). Ongeza moto kwenye brooder/jiko, "
                    f"zuia upepo, matandiko makavu.{act_s}")
        return (f"AirNest {lvl} {house_name}: Joto kali {when}, {t:.0f}C {zone} "
                f"(kuku wanahitaji {lo:.0f}-{hi:.0f}C).{act_s} Maji safi ya baridi, "
                "usiwasumbue kuku mchana.")
    when = "now" if soon else f"within {max(1, round(h))}h"
    if risk["kind"] == "cold":
        return (f"AirNest {lvl} {house_name}: Cold {when}, {t:.0f}C at {zone} "
                f"(birds need {lo:.0f}-{hi:.0f}C). Add heat at the brooder, block draughts, "
                f"dry litter.{act_s}")
    return (f"AirNest {lvl} {house_name}: Heat stress {when}, {t:.0f}C at {zone} "
            f"(birds need {lo:.0f}-{hi:.0f}C).{act_s} Give cool fresh water, "
            "avoid disturbing birds at midday.")
