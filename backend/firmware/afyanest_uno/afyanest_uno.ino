/*
 * AfyaNest — Arduino Uno sensor box (USB to a laptop / Raspberry Pi running
 * tools/serial_bridge.py, which forwards readings to the AfyaNest server).
 *
 * Matches the starter kit:
 *   - DHT11 temperature + humidity module   -> D7        (DHT22 also works, see DHT_TYPE)
 *   - 16x2 LCD (HD44780, 4-bit parallel)     -> RS D12, E D11, D4 D5, D5 D4, D6 D3, D7 D2
 *                                               (10k pot on V0 for contrast, RW to GND)
 *   - Red LED    (danger)  -> D8  through 220 ohm
 *   - Yellow LED (warning) -> D9  through 220 ohm
 * Optional (set the #define to 1 when fitted):
 *   - MQ-137 ammonia module, AO -> A0           HAS_MQ137
 *   - Active buzzer -> D10                       HAS_BUZZER
 *   - Fan relay module IN -> D6 (active HIGH)    HAS_FAN_RELAY
 *   - Heater/brooder relay IN -> A1 (active HIGH) HAS_HEATER_RELAY
 *   - Curtain servo / motor driver signal -> A2   HAS_CURTAIN_SERVO (0 % closed .. 100 % open)
 *
 * Libraries (Arduino IDE > Library Manager):
 *   "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor"), LiquidCrystal (built in)
 *
 * Serial protocol, 9600 baud, one line per message:
 *   box  -> PC  every 60 s : D,<temp_c>,<rh_pct>,<nh3_ppm|-1>,<rs_kohm|-1>,<uptime_s>
 *   PC   -> box after each upload : L,<level>,<fan>,<buzzer>,<heater>,<curtain%|-1>,<tlo*10>,<thi*10>
 *                                   level 0 ok, 1 watch, 2 warning, 3 danger
 *                                   (older servers send only the first three: still understood)
 *
 * AUTOMATIC RESPONSE: the server decides what to switch (fan, heater, curtains, alarm)
 * the moment it detects a problem; the box does it straight away, then the farmer is told.
 *   PC   -> box "C" : print MQ-137 calibration value (in clean outdoor air)
 *
 * Safety without the server: if no "L" line arrives for 3 minutes (laptop off,
 * no internet, server down) the box switches to LOCAL rules below, blinks the
 * yellow LED, and still drives the red LED / buzzer / fan / heater / curtain by itself,
 * using the comfort band for the birds' age that the server last sent.
 */
#include <DHT.h>
#include <LiquidCrystal.h>
#include <EEPROM.h>

// ------------------------------------------------------------------ settings
#define DHT_PIN        7
#define DHT_TYPE       DHT11      // DHT22 if you upgrade (more accurate, recommended)
#define PIN_RED        8
#define PIN_YELLOW     9
#define HAS_BUZZER     0
#define PIN_BUZZER     10
#define HAS_FAN_RELAY  0
#define PIN_FAN        6
#define HAS_HEATER_RELAY  0
#define PIN_HEATER     A1
#define HAS_CURTAIN_SERVO 0
#define PIN_CURTAIN    A2
#define HAS_MQ137      0
#define PIN_MQ         A0

#if HAS_CURTAIN_SERVO
#include <Servo.h>
Servo curtainServo;
int curtainPos = -1;
#endif

// local safety rules (used only when the server is not answering)
const float LOCAL_NH3_WARN = 20.0, LOCAL_NH3_DANGER = 25.0;   // ppm
const float LOCAL_T_LOW = 18.0,    LOCAL_T_HIGH = 32.0;        // deg C, adjust to bird age

// MQ-137: ppm = A * (Rs/R0)^B  (datasheet NH3 curve). Measure RL on your module!
const float RL_KOHM = 10.0, VCC = 5.0, CLEAN_AIR_RATIO = 3.6;
const float CURVE_A = 102.2, CURVE_B = -2.473;

const unsigned long SAMPLE_MS = 3000;         // DHT11: max one read per second
const unsigned long REPORT_MS = 60000;        // send averages every minute
const unsigned long SERVER_TIMEOUT_MS = 180000;

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
DHT dht(DHT_PIN, DHT_TYPE);

float accT = 0, accH = 0, accRs = 0;
int nT = 0, nRs = 0;
float lastT = NAN, lastH = NAN, lastNh3 = NAN;
float R0 = NAN;
int level = 0, fanCmd = 0, buzzCmd = 0, heaterCmd = 0, curtainCmd = -1;
float tLo = NAN, tHi = NAN;                   // comfort band for the birds' age (from server)
unsigned long lastSample = 0, lastReport = 0, lastServer = 0, lastErr = 0;
int dhtFails = 0;
bool everHeardServer = false;
char rx[40];
byte rxLen = 0;

// ------------------------------------------------------------------ helpers
float readRs() {
#if HAS_MQ137
  long s = 0;
  for (int i = 0; i < 16; i++) { s += analogRead(PIN_MQ); delay(2); }
  float v = (s / 16.0) * VCC / 1023.0;
  if (v < 0.01) return NAN;
  return RL_KOHM * (VCC - v) / v;
#else
  return NAN;
#endif
}

float rsToPpm(float rs) {
  if (isnan(rs) || isnan(R0) || R0 <= 0) return NAN;
  return CURVE_A * pow(rs / R0, CURVE_B);
}

bool serverAlive() {
  return everHeardServer && (millis() - lastServer < SERVER_TIMEOUT_MS);
}

int localLevel() {
  int lv = 0;
  if (!isnan(lastNh3)) {
    if (lastNh3 >= LOCAL_NH3_DANGER) lv = 3;
    else if (lastNh3 >= LOCAL_NH3_WARN) lv = 2;
  }
  if (!isnan(lastT)) {
    float lo = isnan(tLo) ? LOCAL_T_LOW : tLo, hi = isnan(tHi) ? LOCAL_T_HIGH : tHi;
    if (lastT < lo - 6 || lastT > hi + 6) lv = max(lv, 3);
    else if (lastT < lo - 3 || lastT > hi + 3) lv = max(lv, 2);
  }
  return lv;
}

void drive() {
  bool live = serverAlive();
  int lv = live ? level : localLevel();
  bool blink = (millis() / 500) % 2;
  digitalWrite(PIN_RED, lv >= 3 ? HIGH : LOW);
  // yellow: steady on warning; blinking = no server (local mode)
  digitalWrite(PIN_YELLOW, (lv == 2 || lv == 1) ? HIGH : (!live && blink) ? HIGH : LOW);
#if HAS_BUZZER
  bool buzz = live ? buzzCmd : (lv >= 3);
  digitalWrite(PIN_BUZZER, (buzz && blink) ? HIGH : LOW);
#endif
  float lo = isnan(tLo) ? LOCAL_T_LOW : tLo, hi = isnan(tHi) ? LOCAL_T_HIGH : tHi;
  bool cold = !isnan(lastT) && lastT < lo;
  bool hot = !isnan(lastT) && lastT > hi + 3;
  bool nh3Bad = !isnan(lastNh3) && lastNh3 >= LOCAL_NH3_WARN;
#if HAS_FAN_RELAY
  bool fan = live ? fanCmd : ((nh3Bad || hot) && !cold);
  digitalWrite(PIN_FAN, fan ? HIGH : LOW);
#endif
#if HAS_HEATER_RELAY
  bool heat = live ? heaterCmd : (cold && !hot);
  digitalWrite(PIN_HEATER, heat ? HIGH : LOW);
#endif
#if HAS_CURTAIN_SERVO
  int want = live ? curtainCmd : (hot ? 100 : nh3Bad ? 60 : cold ? 10 : curtainPos);
  if (want >= 0 && want != curtainPos) {
    curtainServo.write(map(constrain(want, 0, 100), 0, 100, 0, 180));
    curtainPos = want;
  }
#endif
}

void showLcd() {
  static const char *names[] = {"OK    ", "WATCH ", "WARN  ", "DANGER"};
  lcd.setCursor(0, 0);
  char l1[17];
  if (isnan(lastT)) snprintf(l1, 17, "Sensor error!   ");
  else snprintf(l1, 17, "T%3d.%dC  H%3d%%  ", (int)lastT, abs((int)(lastT * 10)) % 10, (int)lastH);
  lcd.print(l1);
  lcd.setCursor(0, 1);
  char l2[17];
  bool live = serverAlive();
  int lv = live ? level : localLevel();
  if (!isnan(lastNh3)) snprintf(l2, 17, "NH3%3d %s%s", (int)(lastNh3 + 0.5), names[lv], live ? "*" : "L");
  else snprintf(l2, 17, "%s   %s", names[lv], live ? "ONLINE " : "LOCAL  ");
  lcd.print(l2);
}

void handleLine(char *s) {
  if (s[0] == 'L' && s[1] == ',') {
    int lv, fn, bz, ht = 0, ct = -1, lo10 = -1, hi10 = -1;
    int n = sscanf(s + 2, "%d,%d,%d,%d,%d,%d,%d", &lv, &fn, &bz, &ht, &ct, &lo10, &hi10);
    if (n >= 3) {
      level = constrain(lv, 0, 3); fanCmd = fn; buzzCmd = bz;
      if (n >= 4) heaterCmd = ht;
      if (n >= 5) curtainCmd = ct;
      if (n >= 6 && lo10 > 0) tLo = lo10 / 10.0;
      if (n >= 7 && hi10 > 0) tHi = hi10 / 10.0;
      lastServer = millis(); everHeardServer = true;
    }
  } else if (s[0] == 'C') {
    // calibration: in clean outdoor air, after 48 h burn-in
    float s2 = 0; int n = 0;
    for (int i = 0; i < 30; i++) { float rs = readRs(); if (!isnan(rs)) { s2 += rs; n++; } delay(100); }
    if (n) {
      R0 = (s2 / n) / CLEAN_AIR_RATIO;
      EEPROM.put(0, R0);
      Serial.print(F("CAL,R0=")); Serial.println(R0, 3);
    } else {
      Serial.println(F("CAL,no MQ-137 fitted"));
    }
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (rxLen) { rx[rxLen] = 0; handleLine(rx); rxLen = 0; }
    } else if (rxLen < sizeof(rx) - 1) {
      rx[rxLen++] = c;
    }
  }
}

// ------------------------------------------------------------------ setup/loop
void setup() {
  Serial.begin(9600);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_YELLOW, OUTPUT);
#if HAS_BUZZER
  pinMode(PIN_BUZZER, OUTPUT);
#endif
#if HAS_FAN_RELAY
  pinMode(PIN_FAN, OUTPUT);
#endif
#if HAS_HEATER_RELAY
  pinMode(PIN_HEATER, OUTPUT);
#endif
#if HAS_CURTAIN_SERVO
  curtainServo.attach(PIN_CURTAIN);
#endif
  EEPROM.get(0, R0);
  if (!(R0 > 0.01 && R0 < 10000)) R0 = NAN;
  dht.begin();
  lcd.begin(16, 2);
  lcd.print("AfyaNest");
  lcd.setCursor(0, 1);
  lcd.print("starting...");
  // lamp test
  digitalWrite(PIN_RED, HIGH); digitalWrite(PIN_YELLOW, HIGH);
  delay(800);
  digitalWrite(PIN_RED, LOW); digitalWrite(PIN_YELLOW, LOW);
  lcd.clear();
  Serial.println(F("HELLO,afyanest-uno,1"));
}

void loop() {
  unsigned long now = millis();
  readSerial();
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    float t = dht.readTemperature(), h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) { accT += t; accH += h; nT++; lastT = t; lastH = h; dhtFails = 0; }
    else {
      dhtFails++;
      if (dhtFails >= 3) lastT = NAN;                  // LCD shows "Sensor error!"
      // tell the laptop instead of staying silent (every 15 s at most)
      if (dhtFails >= 3 && now - lastErr >= 15000) {
        lastErr = now;
        Serial.print(F("E,DHT not responding on pin "));
        Serial.println(DHT_PIN);
      }
    }
    float rs = readRs();
    if (!isnan(rs)) { accRs += rs; nRs++; lastNh3 = rsToPpm(rs); }
    showLcd();
  }
  if (now - lastReport >= REPORT_MS && nT > 0) {
    lastReport = now;
    float rs = nRs ? accRs / nRs : NAN;
    float ppm = rsToPpm(rs);
    Serial.print(F("D,"));
    Serial.print(accT / nT, 1); Serial.print(',');
    Serial.print(accH / nT, 1); Serial.print(',');
    if (isnan(ppm)) Serial.print(F("-1")); else Serial.print(ppm, 1);
    Serial.print(',');
    if (isnan(rs)) Serial.print(F("-1")); else Serial.print(rs, 2);
    Serial.print(',');
    Serial.println(now / 1000);
    accT = accH = accRs = 0; nT = nRs = 0;
  }
  drive();
}
