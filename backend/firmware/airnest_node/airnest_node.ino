/*
 * AirNest sensor node (one per zone inside the poultry house, 6 per house).
 *
 * Board : ESP32-C3 SuperMini or any ESP32 (Arduino-ESP32 core 3.x)
 * Sensors:
 *   - MQ-137 ammonia sensor (5 V heater) -> ADS1115 16-bit ADC (ESP32 ADC is too
 *     non-linear for gas sensors). Use a 10k load resistor (RL).
 *   - SHT31 temperature/humidity (I2C, far more reliable than DHT22 in dusty,
 *     humid poultry houses).
 *   - Optional SCD40 CO2 sensor (one per house is enough).
 * Radio : ESP-NOW to the gateway (no WiFi router needed, ~100 m indoors).
 *
 * Every 60 s the node samples; every 10 min it sends the averages.
 *
 * Libraries: Adafruit ADS1X15, Adafruit SHT31, Sensirion I2C SCD4x (optional).
 *
 * CALIBRATION (important, MQ sensors drift):
 *   1. Burn in the new MQ-137 for 48 h powered.
 *   2. In clean outdoor air, hold the CAL button (GPIO 9) for 3 s: R0 is
 *      measured and stored in flash.
 *   3. Every month, compare against an electrochemical meter or Draeger tube and
 *      set PPM_GAIN via the server (the server also learns per-sensor gain).
 */
#include <Wire.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_SHT31.h>
// #define HAS_SCD40
#ifdef HAS_SCD40
#include <SensirionI2cScd4x.h>
SensirionI2cScd4x scd4x;
#endif

// ----- per-node settings -----
#define NODE_ID 0            // 0 brooder, 1 drinker_a, 2 drinker_b, 3 centre,
                             // 4 curtain_west, 5 exhaust_east  (matches server)
uint8_t GATEWAY_MAC[6] = {0x24, 0x6F, 0x28, 0x00, 0x00, 0x01};   // set to yours
const int WIFI_CHANNEL = 1;
const int CAL_PIN = 9;      // the BOOT button on ESP32-C3 SuperMini
const int PIN_SDA = 5, PIN_SCL = 6;
const int PIN_VBAT = 0;     // battery/5V sense through a 100k/100k divider (optional)

const float RL_KOHM = 10.0;   // MEASURE your module's load resistor: many boards use 1k
const float VCC = 5.0;
const float CLEAN_AIR_RATIO = 3.6;   // Rs/R0 in clean air (MQ-137 datasheet)
// ppm = A * (Rs/R0)^B   (fit of the MQ-137 datasheet NH3 curve)
const float CURVE_A = 102.2, CURVE_B = -2.473;
// temperature / humidity correction of Rs (datasheet curves, around 20 C / 65 %RH)
const float TC = -0.012, HC = -0.0035;

const uint32_t SAMPLE_MS = 60UL * 1000;
const int SAMPLES_PER_SEND = 10;

typedef struct __attribute__((packed)) {
  uint8_t node_id;
  uint16_t seq;
  float nh3_ppm;
  float temp_c;
  float rh_pct;
  float co2_ppm;          // NAN if no CO2 sensor
  float rs_kohm;          // raw sensor resistance, lets the server recalibrate
  float vbat;
  uint8_t flags;          // bit0 sht_err, bit1 ads_err, bit2 not_calibrated
} Packet;

Adafruit_ADS1115 ads;
Adafruit_SHT31 sht;
Preferences prefs;
float R0 = NAN, PPM_GAIN = 1.0;
uint16_t seq = 0;
float acc_nh3 = 0, acc_t = 0, acc_rh = 0, acc_co2 = 0, acc_rs = 0;
int n_ok = 0, n_co2 = 0;
uint8_t flags = 0;

float readRs() {
  int16_t raw = ads.readADC_SingleEnded(0);
  float v = ads.computeVolts(raw);          // through a 2:1 divider -> x2
  v *= 2.0;
  if (v < 0.01) { flags |= 2; return NAN; }
  return RL_KOHM * (VCC - v) / v;
}

float rsToPpm(float rs, float t, float rh) {
  if (isnan(R0) || isnan(rs)) return NAN;
  float corr = 1.0 + TC * (t - 20.0) + HC * (rh - 65.0);
  float ratio = (rs / corr) / R0;
  return max(0.0f, PPM_GAIN * CURVE_A * powf(ratio, CURVE_B));
}

void calibrate() {
  float s = 0; int n = 0;
  for (int i = 0; i < 30; i++) { float rs = readRs(); if (!isnan(rs)) { s += rs; n++; } delay(1000); }
  if (n > 20) {
    R0 = (s / n) / CLEAN_AIR_RATIO;
    prefs.putFloat("r0", R0);
    Serial.printf("Calibrated R0 = %.2f kOhm\n", R0);
  }
}

void onSent(const uint8_t *mac, esp_now_send_status_t st) {
  Serial.printf("send %s\n", st == ESP_NOW_SEND_SUCCESS ? "ok" : "FAILED");
}

void setup() {
  Serial.begin(115200);
  pinMode(CAL_PIN, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL);
  prefs.begin("airnest", false);
  R0 = prefs.getFloat("r0", NAN);
  PPM_GAIN = prefs.getFloat("gain", 1.0);
  if (!ads.begin()) flags |= 2;
  ads.setGain(GAIN_ONE);                     // +/-4.096 V
  if (!sht.begin(0x44)) flags |= 1;
#ifdef HAS_SCD40
  scd4x.begin(Wire, 0x62);
  scd4x.startPeriodicMeasurement();
#endif
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW init failed"); ESP.restart(); }
  esp_now_register_send_cb(onSent);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, GATEWAY_MAC, 6);
  peer.channel = WIFI_CHANNEL;
  esp_now_add_peer(&peer);
  Serial.printf("AirNest node %d ready, R0=%.2f\n", NODE_ID, R0);
}

void loop() {
  static uint32_t last = 0;
  static int count = 0;
  if (digitalRead(CAL_PIN) == LOW) { delay(3000); if (digitalRead(CAL_PIN) == LOW) calibrate(); }
  if (millis() - last < SAMPLE_MS) { delay(50); return; }
  last = millis();

  float t = sht.readTemperature(), rh = sht.readHumidity();
  float rs = readRs();
  if (isnan(t) || isnan(rh)) { flags |= 1; }
  else {
    float ppm = rsToPpm(rs, t, rh);
    acc_t += t; acc_rh += rh; acc_rs += isnan(rs) ? 0 : rs;
    acc_nh3 += isnan(ppm) ? 0 : ppm;
    n_ok++;
  }
#ifdef HAS_SCD40
  uint16_t co2; float tt, hh; bool ready = false;
  scd4x.getDataReadyStatus(ready);
  if (ready && scd4x.readMeasurement(co2, tt, hh) == 0 && co2 > 0) { acc_co2 += co2; n_co2++; }
#endif

  if (++count < SAMPLES_PER_SEND) return;
  Packet p;
  p.node_id = NODE_ID;
  p.seq = seq++;
  p.nh3_ppm = n_ok ? acc_nh3 / n_ok : NAN;
  p.temp_c = n_ok ? acc_t / n_ok : NAN;
  p.rh_pct = n_ok ? acc_rh / n_ok : NAN;
  p.co2_ppm = n_co2 ? acc_co2 / n_co2 : NAN;
  p.rs_kohm = n_ok ? acc_rs / n_ok : NAN;
  p.vbat = analogReadMilliVolts(PIN_VBAT) * 2 / 1000.0;
  p.flags = flags | (isnan(R0) ? 4 : 0);
  esp_now_send(GATEWAY_MAC, (uint8_t *)&p, sizeof(p));
  Serial.printf("node %d nh3 %.1f ppm  T %.1f  RH %.0f\n", NODE_ID, p.nh3_ppm, p.temp_c, p.rh_pct);
  acc_nh3 = acc_t = acc_rh = acc_co2 = acc_rs = 0; n_ok = n_co2 = 0; count = 0; flags = 0;
}
