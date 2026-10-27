# AfyaNest sensor box — Arduino Uno build

This is the box in the starter kit: Arduino Uno, DHT11, 16×2 LCD, red and yellow LEDs.
It plugs into a laptop / Raspberry Pi by USB; `tools/serial_bridge.py` sends its
readings to the server and passes the answer back to the LEDs.

## Wiring

| Part | Pin on part | Arduino Uno |
|---|---|---|
| DHT11 module (3-pin) | `+` / `VCC` | 5V |
| | `out` / `S` | **D7** |
| | `-` / `GND` | GND |
| 16×2 LCD (HD44780) | VSS, RW, K | GND |
| | VDD, A (backlight, via 220 Ω if no on-board resistor) | 5V |
| | V0 (contrast) | middle leg of a 10 kΩ pot (outer legs 5V / GND) |
| | RS | **D12** |
| | E | **D11** |
| | D4, D5, D6, D7 | **D5, D4, D3, D2** |
| Red LED (danger) | long leg → 220 Ω → | **D8** (short leg GND) |
| Yellow LED (warning / no server) | long leg → 220 Ω → | **D9** (short leg GND) |
| *optional* MQ-137 ammonia module | AO | **A0** (VCC 5V, GND) — set `HAS_MQ137 1` |
| *optional* active buzzer | + | **D10** — set `HAS_BUZZER 1` |
| *optional* relay module for a fan | IN | **D6** — set `HAS_FAN_RELAY 1` |
| *optional* relay for the heater / brooder lamp | IN | **A1** — set `HAS_HEATER_RELAY 1` |
| *optional* curtain servo or motor-driver signal | signal | **A2** — set `HAS_CURTAIN_SERVO 1` (0° closed … 180° open) |

Different pins? Change the `#define`s at the top of `firmware/afyanest_uno/afyanest_uno.ino`.

## Automatic response

When AfyaNest detects a problem, the box acts straight away; the farmer is told afterwards.

| Problem | Fan | Heater | Curtains | Alarm |
|---|---|---|---|---|
| Ammonia 20 ppm or more | on | — | open to the plan's opening, at least 40 % | on in danger |
| Too cold for the chicks' age | off | on | closed to 5 % (20 % if ammonia is also high) | on in danger |
| Heat stress | on | off | fully open | on in danger |
| Normal | as planned | on while chicks are below their comfort band | follows the 6-hour plan | off |

Only equipment ticked in the console (House settings: fan / heater / curtain motor) is switched.
If the server cannot be reached for 3 minutes the box uses the same rules by itself, with the
comfort band for the birds' age the server last sent. Mains loads (heater, fan) must go through
a relay module rated for them, installed by an electrician.

In danger AfyaNest also follows up: it calls the farmer again every 10 minutes (3 calls at most)
until they reply **SAWA** / **OK**, tells the backup contact after the second call, and sends an
all-clear SMS when the house is safe again.

## Upload

1. Arduino IDE → Library Manager → install **DHT sensor library** (Adafruit) and
   **Adafruit Unified Sensor**. LiquidCrystal is built in.
2. Open `firmware/afyanest_uno/afyanest_uno.ino`, Board: *Arduino Uno*, Port: your USB port.
3. Upload. The LCD shows `AfyaNest starting...` and both LEDs flash once (lamp test).
4. Open Serial Monitor at 9600 baud: a `D,24.0,61.0,-1,-1,60` line appears every minute.
   **Close the Serial Monitor** before starting the bridge (only one program can use the port).

## What the lights mean

| Red | Yellow | Meaning |
|---|---|---|
| off | off | all good (server connected) |
| off | steady | watch / warning — check the dashboard or SMS |
| on | any | danger — act now |
| off | blinking | server not answering: the box is using its own safety rules |

The LCD shows temperature, humidity, (ammonia), the level and `ONLINE` / `LOCAL`.

## Placement (matters more than the AI)

* Hang the box at **chicken height** (20–30 cm above the litter), not near the roof.
* First box: the **brooder** (`--node 0`). More boxes later: drinker lines (1, 2), centre (3).
  One Arduino + one bridge per box, each with `--node` set to its position.
* Keep it out of direct sun and away from the heater's radiant heat; protect from dust
  with a vented box (ammonia and humidity must reach the sensor).

## Sensor notes

* **DHT11** reads in whole degrees and ±2 °C / ±5 %RH. Fine to start; a **DHT22** (same
  wiring, set `DHT_TYPE DHT22`) or **SHT31** is much better for chicks, whose comfort band
  is only 4 °C wide.
* **Ammonia** is the main danger at night. Until an MQ-137 (or better, an electrochemical
  NH₃ cell) is fitted, the system gives temperature/humidity advice only and the dashboard
  says "No ammonia sensor fitted".
* MQ-137 calibration: power it for 48 h, take the box outside to clean air, send `C`
  from the Serial Monitor. The value is stored in the Arduino's EEPROM. Check monthly
  against a reference meter.

## Running the bridge permanently (Linux)

```bash
sudo usermod -aG dialout $USER          # once, then log out/in (serial port permission)
mkdir -p ~/.config/afyanest && chmod 700 ~/.config/afyanest
echo 'PASTE-GATEWAY-KEY' > ~/.config/afyanest/key && chmod 600 ~/.config/afyanest/key
```
`~/.config/systemd/user/afyanest-bridge.service`:
```ini
[Unit]
Description=AfyaNest serial bridge
After=network-online.target

[Service]
WorkingDirectory=%h/AfyaNest/backend
ExecStart=%h/AfyaNest/backend/.venv/bin/python tools/serial_bridge.py --port /dev/ttyACM0 --device-id YOUR-DEVICE-ID --node 0 --api https://your-server --key-file %h/.config/afyanest/key
Restart=always

[Install]
WantedBy=default.target
```
```bash
systemctl --user daemon-reload && systemctl --user enable --now afyanest-bridge
loginctl enable-linger $USER            # keep running when you log out
journalctl --user -u afyanest-bridge -f # watch it
```
If the internet drops, the bridge keeps up to 7 days of readings in
`~/.afyanest_backlog.json` and uploads them when it is back.
