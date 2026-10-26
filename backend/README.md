# AirNest — AI + IoT climate guardian for Kenyan poultry houses

AirNest watches the air inside a poultry house day and night and warns the farmer,
by SMS, before conditions harm the birds: toxic **ammonia** at night, **cold** chicks in
the brooder, and **heat stress** on hot afternoons.

**Problem.** In Kenya's highlands, semi-commercial farmers (300–10,000 broilers or
layers in deep-litter houses) close the curtains at night to keep birds warm.
Ventilation stops, ammonia from wet litter builds up while the farmer sleeps, the
birds' airways get damaged and respiratory disease follows. Chicks die when a brooder
goes cold; older birds suffer in hot spells. Nobody measures any of it.

**What AirNest does.**
1. Small sensor nodes measure ammonia, temperature, humidity (and CO₂) across the house.
2. A gateway sends the data over GSM every 10 minutes (no WiFi needed).
3. AI forecasts ammonia and bird-zone temperature **6 hours ahead**, per zone.
4. A controller tests ~20–80 "what if" ventilation plans against the forecast and picks
   the one that keeps ammonia low **without chilling the birds**.
5. The farmer gets an early SMS in Swahili or English, e.g.
   `AirNest ONYO Shamba la Wanjiku: Amonia itafika 34ppm ndani ya saa 2 (maji A). Fungua pazia 50% kwa dakika 30, kisha rudisha.`
   `AirNest HATARI Shamba: Baridi sasa, 22C eneo la vifaranga (kuku wanahitaji 30-34C). Ongeza moto kwenye brooder/jiko, zuia upepo, matandiko makavu.`
6. Climate alerts for **cold chicks** (brooder below the comfort band for their age) and
   **heat stress** (bird zones above it; humid air counts as hotter).
7. Anomaly AI separates **sensor faults** (sent to the technician) from **real farm
   events** — a leaking drinker wetting the litter, a brooder heater that went out.
8. If the internet is down, the gateway's own safety rule turns on the fan and buzzer.

**Start here:** `SETUP.md` takes you from nothing to a working pilot, step by step.

```
 [6 x sensor node] --ESP-NOW--> [gateway + SIM800L] --GSM/HTTP--> [server]
   MQ-137 + SHT31                 fan relay, buzzer                  |
   (+ SCD40 CO2)                  offline safety rule                |-- AmmoniaNet (forecast)
                                                                     |-- GDN (anomalies)
 farmer's phone <------------- SMS (Africa's Talking) ---------------|-- MPC advisor
   "PAZIA 50" / "HALI" replies --------------------------------------^
```

## The AI models

| Job | Model | Why it is state of the art |
|---|---|---|
| Forecast NH₃ + temperature, 6 h, every zone | **AmmoniaNet** (`airnest/models/ammonianet.py`) — spatio-temporal graph transformer | Combines PatchTST patching (ICLR 2023), Graph WaveNet/MTGNN *adaptive adjacency* (learns how air moves between sensors), STAEformer-style alternating temporal/spatial attention, and a Temporal-Fusion-Transformer decoder fed with *known future inputs* (weather forecast, clock, and the curtain/fan plan). Outputs 10/50/90 % quantiles. |
| Sensor-fault vs real-event detection | **GDN — Graph Deviation Network** (`airnest/models/gdn.py`) | Leading graph method for multivariate IoT sensor anomaly detection (SWaT/WADI benchmarks); learns a sensor graph, predicts each channel from its neighbours, the largest deviation points to the root cause. Extended with house covariates so opening a curtain is not an "anomaly". |
| Decide what the farmer should do | **Model-predictive control** (`airnest/controller.py`) | Uses the forecaster as a learned world model; scores candidate plans on pessimistic (90 %) ammonia, cold stress for the birds' age, and effort. |
| Benchmark + fallback | Gradient-boosted quantile trees (`airnest/forecasters.py`) | Strong tabular baseline; the neural net must beat it. Runs anywhere. |

Because the curtain/fan plan is an *input* to the forecaster, the same network answers
"what happens if we keep the curtains closed?" and "what if we open 50 % for 30 min?".

## Results so far (simulated farms, held-out test houses)

See `models/*_test.json` and `models/closed_loop_*.json` after training. Baseline numbers
measured in this repo are in `RESULTS.md`.

These are **simulation** results. They show the pipeline works and the control logic is
sound; real accuracy must be measured on real farm data (see "Sim-to-real" below).

## Repository

```
airnest/            core library (no PyTorch needed except airnest/models)
  config.py         sensor layout, features, thresholds, comfort temperatures
  simulator.py      physics-based house simulator (data generator + A/B test bed)
  dataset.py        scaling, windowing
  models/           AmmoniaNet + GDN (PyTorch)
  forecasters.py    ONNX runtime wrapper + gradient-boosting baseline
  controller.py     model-predictive ventilation advisor
  anomaly.py        GDN runtime + robust-statistics fallback + fault/event diagnosis
train/              training scripts + Colab notebook + closed-loop evaluation
server/             FastAPI app (main.py), service layer, pipeline, Swahili/English SMS, Africa's Talking, weather
firmware/           ESP32 sensor node + GSM gateway (Arduino)
tests/              end-to-end tests (simulator -> API -> AI -> SMS)
```

## Quick start

```bash
# 1) server deps (no PyTorch needed on the server)
pip install -r requirements-server.txt

# 2) data + baseline model (CPU, ~3 min)
python -m airnest.simulator --houses 64 --out data/sim.npz
python train/train_baseline.py

# 3) neural networks: open train/AirNest_train_colab.ipynb in Google Colab (free T4 GPU)
#    and copy ammonianet.onnx, gdn.onnx, gdn_stats.json, scaler.json into models/
#    The server automatically prefers them over the baseline.

# 4) tests
python tests/test_system.py

# 5) run
AIRNEST_ADMIN_KEY=secret AT_USERNAME=sandbox AT_API_KEY=... uvicorn server.main:app --port 8000
# interactive API docs: http://localhost:8000/docs
curl -X POST localhost:8000/api/v1/houses -H 'X-Admin-Key: secret' -H 'Content-Type: application/json' \
  -d '{"device_id":"house-001","device_key":"change-me","name":"Shamba la Wanjiku",
       "phone":"+2547XXXXXXXX","lang":"sw","lat":-1.10,"lon":36.64,"has_fan":true,
       "placement_ts":1792000000}'
```

## Hardware (per house, approximate Nairobi prices — check locally)

| Part | Qty | Approx. KES |
|---|---|---|
| ESP32-C3 board | 6 | 700 each |
| MQ-137 ammonia sensor + ADS1115 ADC | 6 | 2,500 each |
| SHT31 temperature/humidity | 6 | 1,200 each |
| SCD40 CO₂ (optional, one per house) | 1 | 5,000 |
| ESP32 + SIM800L gateway, relay, buzzer, PSU, battery | 1 | 5,000 |
| Enclosures, cable, 5 V supplies | — | 3,000 |

About KES 30,000 for six zones. To start cheaper, use 3 nodes (brooder, drinker line,
centre); the server fills missing zones from neighbours. Put at least one
electrochemical NH₃ reference meter in your pilot to calibrate the MQ-137s monthly.

## Sim-to-real (what to do with real farms)

1. Install on 5–10 pilot farms. Log for 2–3 cycles. Farmers report curtain changes by
   SMS (`PAZIA 50`) or fit the curtain potentiometer.
2. Record outcomes: daily mortality, feed, respiratory signs, vet diagnoses.
3. Export real data to the same `.npz` format and fine-tune:
   `python train/train_ammonianet.py --data data/farm.npz --init models/ammonianet.pt --lr 2e-4 --epochs 15`
4. Re-run GDN training on real data (normal periods) so it learns your sensors' noise.
5. Validate the advice with a controlled trial (half the houses follow advice) before
   making claims about mortality or feed conversion.

## Known limits

* The simulator is a simplified model; its numbers are not field results.
* MQ-137 sensors drift and are humidity-sensitive. Calibration matters more than the AI.
* The controller only advises curtains and fan. Litter management (turning, adding dry
  litter, fixing leaks) is often the real fix, which is why wet-litter events are flagged.
* Weather forecasts come from Open-Meteo; without internet a typical highland curve is used.
