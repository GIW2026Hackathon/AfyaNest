"""Shared constants for AirNest (sensor layout, features, window sizes).

Everything that the firmware, the server and the models must agree on lives here.
"""

STEP_MIN = 10                    # one reading every 10 minutes
STEPS_PER_HOUR = 60 // STEP_MIN
L_HIST = 72                      # model looks back 12 hours
H_FUT = 36                       # model forecasts 6 hours ahead
PATCH = 6                        # 1-hour patches for the transformer

# Sensor nodes inside one poultry house (an ~8 m x 30 m deep-litter house).
# x, y in metres. Order matters: it is the node index used everywhere.
NODES = [
    ("brooder",      3.0,  4.0),
    ("drinker_a",   10.0,  2.0),
    ("drinker_b",   20.0,  6.0),
    ("centre",      15.0,  4.0),
    ("curtain_west", 27.0, 1.0),
    ("exhaust_east", 29.0, 6.0),
]
NODE_NAMES = [n[0] for n in NODES]
N_NODES = len(NODES)

# Per-node sensor channels
NODE_FEATS = ["nh3_ppm", "temp_c", "rh_pct", "co2_ppm"]
F_NODE = len(NODE_FEATS)
NH3, TEMP, RH, CO2 = range(4)

# House-level covariates. All are "known in the future": weather from a forecast,
# time of day from the clock, bird age from the flock record and the control plan
# (curtain, fan, heater) from what the farmer will do / what the AI recommends.
GLOBAL_FEATS = ["t_out", "rh_out", "hour_sin", "hour_cos", "age_days",
                "curtain", "fan", "heater"]
G_FEATS = len(GLOBAL_FEATS)
CURTAIN, FAN, HEATER = 5, 6, 7

# Forecast targets (per node): ammonia and temperature
TARGETS = [NH3, TEMP]
QUANTILES = [0.1, 0.5, 0.9]

# Welfare thresholds (ppm). 25 ppm is the common upper limit for poultry;
# above ~10 ppm long exposure already hurts airways, so the controller aims lower.
NH3_TARGET = 15.0
NH3_WARN = 20.0
NH3_DANGER = 25.0


def comfort_temp(age_days: float) -> tuple[float, float]:
    """Comfortable air temperature band for broilers by age (deg C)."""
    if age_days < 7:
        return 30.0, 34.0
    if age_days < 14:
        return 27.0, 31.0
    if age_days < 21:
        return 24.0, 28.0
    if age_days < 28:
        return 21.0, 25.0
    return 18.0, 24.0
