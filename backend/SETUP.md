# AirNest — setting up from scratch

This guide takes a team with nothing (no hardware, no server, no data) to a working
pilot on one farm. Follow the phases in order. Each phase ends with a check that tells
you it worked before you spend money on the next one.

| Phase | What you get | Time | Approx. cost (KES) |
|---|---|---|---|
| 0. Prepare | Accounts, laptop software, problem evidence | 1–3 weeks | ~0 |
| 1. Software on your laptop | Simulator, AI, server and SMS working, no hardware | 1–2 days | 0 |
| 2. Bench prototype | 1 sensor box + 1 main unit sending real readings | 2–4 weeks | ~10,000 |
| 3. Server online | Main unit reaches your server over the mobile network | 2–3 days | ~1,000/month |
| 4. Train the AI | Graph neural networks trained on Colab | 1 day | 0 |
| 5. First farm pilot | 3 sensor boxes on a real farm, farmer gets SMS | 1–3 months | ~20,000 more |

Prices are rough Nairobi estimates; check with local electronics shops.

---

## Phase 0 — Prepare

**Team roles** (one person can hold several):
* Field lead: talks to farmers, vets, agrovets; runs the problem validation.
* Hardware lead: soldering, wiring, flashing the boards.
* Software lead: Python, the server, the AI training.

**Accounts (free):**
* GitHub — keep this project in a private repository.
* Google account — for Google Colab (free GPU to train the AI).
* Africa's Talking — SMS. Start with the free **sandbox**.

**Laptop software:**
* Python 3.11 or newer
* Arduino IDE 2
* Git

**Problem evidence:** follow `docs/problem_validation.md`. Do not skip this — it decides
whether the project is worth building and is what judges and funders will ask for.

✅ **Check:** at least 10 farmer interviews written up; a list of 3–5 farms willing to host a pilot.

---

## Phase 1 — Run everything on your laptop (no hardware needed)

```bash
unzip airnest.zip && cd airnest
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-server.txt

python -m airnest.simulator --houses 64 --out data/sim.npz   # ~2 min: fake but realistic farms
python train/train_baseline.py                               # ~2 min: first AI model
python tests/test_system.py                                  # all tests should PASS
```

Start the server and play the role of a farm:

```bash
AIRNEST_ADMIN_KEY=secret AIRNEST_DRY_RUN=1 uvicorn server.main:app --port 8000
```

Open **http://localhost:8000/docs**: FastAPI's interactive page lets you try every
endpoint from the browser.

In a second terminal, register a test house (placement date = the day chicks arrived):

```bash
curl -X POST localhost:8000/api/v1/houses -H 'X-Admin-Key: secret' \
  -H 'Content-Type: application/json' -d '{
   "device_id":"house-001","device_key":"change-me","name":"Shamba la Majaribio",
   "phone":"+2547XXXXXXXX","lang":"sw","has_fan":false,
   "placement_ts":'"$(date -d '20 days ago' +%s)"'}'
```

With `AIRNEST_DRY_RUN=1`, SMS messages are printed in the server window instead of sent.

✅ **Check:** tests pass; http://localhost:8000/docs opens; the house registers.

---

## Phase 2 — Bench prototype (one sensor box + one main unit)

### Shopping list

**Sensor box (node):**
| Part | Qty | Notes |
|---|---|---|
| ESP32-C3 SuperMini | 1 | small, cheap, has WiFi radio for ESP-NOW |
| MQ-137 ammonia sensor module | 1 | needs 5 V for its heater |
| ADS1115 16-bit ADC module | 1 | reads the MQ-137 accurately |
| SHT31 temperature/humidity module | 1 | more reliable than DHT22 in dusty, damp houses |
| 10 kΩ resistors | 2 | voltage divider for the MQ-137 output |
| 5 V 2 A USB power adapter + cable | 1 | |
| Small plastic box + insect mesh | 1 | air must reach the sensors; birds must not |

**Main unit (gateway):**
| Part | Qty | Notes |
|---|---|---|
| ESP32 DevKit (38-pin) | 1 | |
| SIM800L module (2G) **or** A7670/SIM7600 (4G) | 1 | check which network works on the pilot farm first |
| 18650 Li-ion cell + holder + TP4056 charger | 1 | the modem needs ~4 V and up to 2 A bursts; never feed it 5 V |
| 5 V relay module | 1 | only if the farm has an exhaust fan |
| Buzzer + red LED + 220 Ω resistor | 1 each | |
| Safaricom or Airtel SIM with a data bundle | 1 | disable the SIM PIN in a phone first |

**Tools:** soldering iron, multimeter, breadboard, jumper wires, heat-shrink.

**For calibration (borrow or rent for the pilot):** a handheld electrochemical ammonia
meter, or colourimetric ammonia gas-detector tubes.

### Wiring — sensor box

| From | To (ESP32-C3) |
|---|---|
| SHT31 VIN / GND | 3V3 / GND |
| SHT31 SDA / SCL | GPIO 5 / GPIO 6 |
| ADS1115 VDD / GND | 3V3 / GND |
| ADS1115 SDA / SCL | GPIO 5 / GPIO 6 (shared bus) |
| ADS1115 ADDR | GND (address 0x48) |
| MQ-137 VCC / GND | 5 V / GND |
| MQ-137 AO | 10 kΩ → ADS1115 A0, and A0 → 10 kΩ → GND (halves 5 V to 2.5 V) |
| Calibration button | the board's BOOT button (GPIO 9), nothing to wire |

**Important:** measure the load resistor on your MQ-137 module with the multimeter
(the small resistor next to the chip, often marked 102 = 1 kΩ or 103 = 10 kΩ) and set
`RL_KOHM` in `firmware/airnest_node/airnest_node.ino` to match.

### Wiring — main unit

| From | To (ESP32 DevKit) |
|---|---|
| SIM800L TX | GPIO 16 |
| SIM800L RX | GPIO 17 (through a 1 kΩ resistor) |
| SIM800L VCC / GND | 18650 cell + / − (via TP4056), and GND shared with the ESP32 |
| Relay IN | GPIO 26 (relay contacts switch the fan — **a qualified electrician wires the mains side**) |
| Buzzer | GPIO 27 |
| LED (with 220 Ω) | GPIO 25 |
| Curtain potentiometer (optional) | GPIO 34 |

### Flashing

1. Arduino IDE → Preferences → Additional boards URL:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   then Boards Manager → install **esp32 by Espressif** (version 3.x).
2. Library Manager → install **Adafruit ADS1X15**, **Adafruit SHT31 Library**,
   **TinyGSM**, **ArduinoHttpClient**, **ArduinoJson** (v7).
3. Open `firmware/airnest_gateway/airnest_gateway.ino`. Set `APN`, `SERVER`,
   `DEVICE_ID`, `DEVICE_KEY`, `HAS_FAN`. For a SIM7600/A7670, change the
   `TINY_GSM_MODEM_...` line. Board: *ESP32 Dev Module*. Upload.
4. Open the Serial Monitor (115200). Copy the **Gateway MAC** it prints.
5. Open `firmware/airnest_node/airnest_node.ino`. Paste the MAC into `GATEWAY_MAC`,
   set `NODE_ID` (0 = brooder, 1 = drinker A, 2 = drinker B, 3 = centre,
   4 = curtain side, 5 = fan end). Board: *ESP32C3 Dev Module*, enable
   *USB CDC On Boot*. Upload.

Expect small compile fixes the first time (library versions change); the compiler
messages usually say exactly what to rename.

### Burn-in and calibration

1. Leave the MQ-137 powered for **48 hours** before trusting it.
2. Take the box outside into clean air (not near the poultry house, cars or a jiko).
   Hold the BOOT button for 3 seconds. The Serial Monitor prints `Calibrated R0 = …`.
3. Sanity test, outdoors or in a ventilated room: briefly hold a cloth lightly dampened
   with household ammonia cleaner near (not on) the box. The reading should jump and
   then fall when you remove it. Don't breathe it in.
4. Compare with the reference meter on the farm once a month; big differences mean
   recalibration or a new sensor.

✅ **Check:** every 10 minutes the node prints readings and the gateway prints a send
attempt (it will fail until Phase 3 — that's expected).

---

## Phase 3 — Put the server online

The main unit is on the mobile network, so the server must be reachable from the
internet.

**Quick test from your laptop:** run the server as in Phase 1, expose it with a tunnel
tool (for example Cloudflare Tunnel or ngrok) and put that address in `SERVER`.

**For the pilot:** rent the smallest Linux cloud server (1 vCPU, 1 GB RAM is enough for
dozens of farms), then:

```bash
sudo apt install python3-venv nginx
git clone <your private repo> airnest && cd airnest
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-server.txt
python -m airnest.simulator --out data/sim.npz && python train/train_baseline.py
AIRNEST_ADMIN_KEY=<long random> AT_USERNAME=sandbox AT_API_KEY=<key> \
  uvicorn server.main:app --host 127.0.0.1 --port 8000 --workers 2
```

Put nginx in front (port 80 for the gateway, HTTPS for everything else), and run
uvicorn as a systemd service so it restarts after reboots.

**SMS (Africa's Talking):**
1. Sandbox first: username `sandbox` + sandbox API key; watch messages in their
   simulator.
2. Going live: production API key, buy SMS credit, and request a sender ID (e.g. AIRNEST).
3. For farmer replies (`PAZIA 50`, `HALI`), get an incoming short code or number and set
   its callback URL to `https://<your server>/api/v1/sms`.

**Security note:** the SIM800L only does plain HTTP, so the device key travels
unencrypted. Fine for a pilot; for production, move to a 4G module with TLS.

✅ **Check:** the gateway's Serial Monitor shows HTTP 200, and
`GET /api/v1/houses/house-001/status` shows your readings.

---

## Phase 4 — Train the neural networks

1. Open `train/AirNest_train_colab.ipynb` in Google Colab. Runtime → **T4 GPU**.
2. Upload `airnest.zip` and run the cells in order (20–40 minutes).
3. Download `airnest_models.zip`; copy `ammonianet.onnx`, `gdn.onnx`,
   `gdn_stats.json` and `scaler.json` into the server's `models/` folder; restart.
4. The server switches to the graph neural networks automatically
   (`"model": "ammonianet"` in the status endpoint).

Only deploy AmmoniaNet if its test error in `models/ammonianet.json` beats the baseline
in `RESULTS.md`.

✅ **Check:** status shows `"model": "ammonianet"` and `"detector": "gdn"`.

---

## Phase 5 — First farm pilot

**Choose the farm:** 500–3,000 birds, closed deep-litter house, curtains, mobile signal,
a farmer who is curious and will answer questions. Start a new flock if possible.

**Install 3 sensor boxes first** (expand to 6 later):
* Brooder area (node 0) — at chick height, out of reach of the heater.
* Drinker line (node 1) — near but not under drinkers (splashes kill sensors).
* Centre (node 3).
Hang each box about **30 cm above the litter** (bird breathing height), mesh facing
down, cable out of pecking reach. Main unit near the door where the signal is best,
away from water.

**Register the house** with the real placement date, farmer's phone and language.

**Train the farmer (10 minutes):**
* SMS warnings will arrive before problems, not after.
* `PAZIA 50` = "I set the curtain to 50 %". `HALI` = "what's the situation?"
* Don't spray water on the boxes; call the technician if a box is damaged.

**Run the pilot:**
* Week 1: read every alert yourself before trusting it. Call the farmer daily.
* Weekly: dust off the mesh; check the readings look sensible.
* Monthly: compare each MQ-137 with the reference meter.
* Keep a simple record: daily deaths, feed used, sick-bird signs, what the farmer did
  after each SMS.

**After 1–2 flock cycles:** export the readings, fine-tune the AI on real data
(see README "Sim-to-real"), and compare deaths, weights and medicine costs against the
previous flock and against a nearby farm without AirNest.

✅ **Check:** the farmer received useful warnings and acted on them, and you have real
before/after numbers for your pitch.

---

## Safety

* Mains wiring for fans: a qualified electrician only.
* Li-ion cells: use a proper charger board, keep them out of heat and away from litter.
* Ammonia tests: only in ventilated spaces; never put your face to the sensor.
* The system advises; the farmer stays responsible for the birds. Never remove an
  existing heater or alarm because AirNest is installed.
