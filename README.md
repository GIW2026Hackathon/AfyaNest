# AfyaNest

Watches the air inside a poultry house day and night and warns the farmer by SMS or a
phone call (Kiswahili or English) before ammonia, cold or heat harms the birds.

**Farmers never log in.** When a farmer buys a sensor box, our staff add them in the
console (name, phone, county, box ID). From then on the farmer only receives SMS and, for
danger, a voice call - on any phone, no smartphone or app needed. The console with the
gauges, charts and predictions is for the AfyaNest team only.

```
 Arduino Uno box (DHT11/DHT22, LCD, LEDs,     USB      laptop / Raspberry Pi        HTTPS
 optional MQ-137, buzzer, fan relay)  ───────────────▶ tools/serial_bridge.py ───────────────▶ AfyaNest server
                                     ◀─── L,level ────                                         (FastAPI + PostgreSQL + AI)
                                                                                                   │
                                farmer's phone ◀──────────── SMS (Africa's Talking) ───────────────┤
                                staff console (browser) ◀────── HTTPS, sign-in ───────────────────┘
```

* `backend/` — API, AI forecaster/advisor, PostgreSQL storage, SMS. See `backend/README.md`.
* `backend/firmware/afyanest_uno/` — Arduino Uno sketch for the sensor box. Wiring: `backend/docs/HARDWARE.md`.
* `backend/tools/serial_bridge.py` — forwards the box's readings to the server.
* `frontend/` — staff console: Overview, Farmers, Disease watch (left menu).
* `SECURITY.md` — how farmers' data is protected; production settings.

## The three models

| | Model | What it does | Farmer receives |
|---|---|---|---|
| 1 | **Outbreak watch** (`server/osint.py`) | Reads news + official sources every 6 h for Newcastle disease, bird flu, Gumboro, fowl typhoid, fowl pox, coccidiosis in Kenya; finds the county; scores credibility | An SMS with prevention steps. Auto-sent only for official sources ≥ 80 % confidence; other reports wait for an owner/manager to approve on **Outbreak watch** |
| 2 | **Danger detection** (`server/pipeline.py`, `airnest/anomaly.py`) | Every reading: ammonia limits, cold/heat for the birds' age, sensor faults vs farm events (wet litter, heater failure) | An SMS when something is wrong now |
| 3 | **Prediction & check-in** (`airnest/forecasters.py`, `airnest/controller.py`) | 6-hour forecast; the gentlest curtain/fan plan; the time to go and check | "... Angalia banda saa 02:30." |

## The console (staff only)

* **Overview** - who needs attention now, every house at a glance, latest alerts.
* **Farmers** - search, filter, **Add farmer** (2 short steps). Adding a farmer creates
  their house and the sensor box code, and sends a welcome SMS. Tick **Test farmer** for
  training/demos: their messages show on the phone picture in the console and are never sent.
* **Farmer page** - one gauge each for ammonia, temperature and humidity, and a phone
  showing exactly what the farmer received. Test farmers also have **Try an alert**
  (ammonia, cold night, hot afternoon) to watch an SMS or phone call arrive.
* **House page** - the three gauges, then for each measure its own history chart and its
  own 6-hour prediction, plus what the farmer was told.
* **Disease watch** - outbreak news for the farmers' counties, waiting for approval.

Farmers can reply by SMS: `HALI`/`STATUS`, `SAWA`/`OK` (stop the follow-up calls), `PAZIA 50`/`CURTAIN 50`, `SIMAMISHA`/`STOP`, `ANZA`/`START`.

## Automatic response

When danger is detected AfyaNest does not wait for the farmer: the box switches the fan, heater,
curtain motor and alarm by itself (only the equipment ticked for that house), the SMS says what was
done, and danger is followed up with a call every 10 minutes until the farmer replies SAWA; after
the second call the backup contact is told; an all-clear SMS goes out when the house is safe.
Rules and wiring: `backend/docs/HARDWARE.md`.

## Synthetic data (no sensor box yet)

New houses start on **synthetic data**: the server simulates a realistic flock for each
house (same simulator the AI was trained on) and runs it through all three models every
minute, with 48 h of history on day one. The dashboard labels these houses
**Simulated**. Their alerts are logged but **never texted** to the farmer, unless you
tick "Send TEST SMS" in the house settings (messages then start with `TEST:`).

The IoT path stays open: when a real sensor box sends its first reading with the house's
gateway key, the house switches to live data automatically and the simulated history is
removed.

## Run it (Ubuntu)

**1. PostgreSQL (once)**
```bash
sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE USER afyanest WITH PASSWORD 'choose-a-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE afyanest OWNER afyanest;"
```

**2. Backend (terminal 1)**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-server.txt -r requirements-bridge.txt
cp .env.example .env            # then edit: database password, keys (see comments)
set -a; source .env; set +a
python tools/create_owner.py --org "Your Farm Name" --name "Your Name" --email you@example.com
uvicorn server.main:app --host 127.0.0.1 --port 8000
```

**3. Dashboard (terminal 2)**
```bash
cd frontend && npm install && npm run dev      # open http://localhost:5173 and sign in
```
Open **Farmers → Add farmer**. Copy the **sensor box code** it shows once.
Sign-up is closed: add staff from your account page (click your name, bottom left).

**4. Sensor box (terminal 3)** — upload `backend/firmware/afyanest_uno/afyanest_uno.ino`
with the Arduino IDE, close the IDE's Serial Monitor, then:
```bash
cd backend && source .venv/bin/activate
export AFYANEST_DEVICE_KEY='paste-the-gateway-key'
python tools/serial_bridge.py --port /dev/ttyACM0 --device-id <your-device-id> --node 0
```
Readings appear in the console within a minute and the house switches from Simulated to
**Sensor live**. The left menu shows **Server live** (green) or **Server offline** (red).

## Tests
```bash
cd backend
python tests/test_security.py && python tests/test_bridge.py && python tests/test_system.py \
  && python tests/test_models.py && python tests/test_console.py
# against PostgreSQL:
AIRNEST_TEST_DATABASE_URL=postgresql://afyanest:PASSWORD@localhost:5432/postgres python tests/test_security.py
```
