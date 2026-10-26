/*
 * AirNest gateway (one per poultry house).
 *
 * Board : ESP32 DevKit (Arduino-ESP32 core 3.x)
 * Modem : SIM800L (2G) or SIM7600 (4G) - Safaricom/Airtel data bundle
 * Also  : relay for the exhaust fan (optional), buzzer + red LED,
 *         optional curtain position sensor (10k potentiometer on the curtain
 *         winch pulley -> GPIO 34; 0 = closed, 1 = fully open).
 *
 * Receives node packets over ESP-NOW, uploads one JSON batch every 10 minutes
 * to the AirNest server, and applies the server's reply (fan on/off, buzzer).
 *
 * SAFETY FALLBACK: if the server is unreachable for 30 min (no network, power
 * cut at the server, out of data bundle), the gateway decides locally:
 *   any node > 30 ppm -> fan ON and buzzer beeps; < 20 ppm -> fan back to auto.
 * The farm is never left without protection because of the internet.
 *
 * Libraries: TinyGSM, ArduinoHttpClient, ArduinoJson (v7).
 */
#define TINY_GSM_MODEM_SIM800        // or TINY_GSM_MODEM_SIM7600
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ----- settings -----
const char APN[] = "safaricom";              // Airtel: "internet"
const char SERVER[] = "airnest.example.com"; // your server host
const int PORT = 80;                         // use a TLS-capable modem + 443 in production
const char DEVICE_ID[] = "house-001";
const char DEVICE_KEY[] = "change-me";
const int WIFI_CHANNEL = 1;
const int N_NODES = 6;
const int PIN_FAN = 26, PIN_BUZZ = 27, PIN_LED = 25, PIN_CURTAIN = 34;
const bool HAS_FAN = true;
const bool HAS_CURTAIN_SENSOR = false;
const uint32_t UPLOAD_MS = 10UL * 60 * 1000;
const uint32_t OFFLINE_FALLBACK_MS = 30UL * 60 * 1000;
const float LOCAL_ON_PPM = 30.0, LOCAL_OFF_PPM = 20.0;

HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClient gsm(modem);
HttpClient http(gsm, SERVER, PORT);

typedef struct __attribute__((packed)) {
  uint8_t node_id;
  uint16_t seq;
  float nh3_ppm, temp_c, rh_pct, co2_ppm, rs_kohm, vbat;
  uint8_t flags;
} Packet;

volatile bool fresh[N_NODES] = {false};
Packet latest[N_NODES];
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
bool fanOn = false, buzzer = false, localOverride = false;
uint32_t lastServerOk = 0;

void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != sizeof(Packet)) return;
  Packet p; memcpy(&p, data, sizeof(p));
  if (p.node_id >= N_NODES) return;
  portENTER_CRITICAL_ISR(&mux);
  latest[p.node_id] = p; fresh[p.node_id] = true;
  portEXIT_CRITICAL_ISR(&mux);
}

void applyOutputs() {
  digitalWrite(PIN_FAN, (HAS_FAN && fanOn) ? HIGH : LOW);
  digitalWrite(PIN_LED, (buzzer || localOverride) ? HIGH : LOW);
}

bool netUp() {
  if (modem.isGprsConnected()) return true;
  if (!modem.waitForNetwork(60000L)) return false;
  return modem.gprsConnect(APN, "", "");
}

float curtainPosition() {
  if (!HAS_CURTAIN_SENSOR) return NAN;
  return constrain(analogRead(PIN_CURTAIN) / 4095.0, 0.0, 1.0);
}

bool upload() {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["fan"] = fanOn ? 1 : 0;
  float c = curtainPosition();
  if (!isnan(c)) doc["curtain"] = c;
  doc["local_override"] = localOverride;
  JsonArray arr = doc["nodes"].to<JsonArray>();
  portENTER_CRITICAL(&mux);
  for (int i = 0; i < N_NODES; i++) {
    if (!fresh[i]) continue;
    JsonObject o = arr.add<JsonObject>();
    o["node"] = i; o["seq"] = latest[i].seq;
    o["nh3_ppm"] = latest[i].nh3_ppm; o["temp_c"] = latest[i].temp_c;
    o["rh_pct"] = latest[i].rh_pct;
    if (!isnan(latest[i].co2_ppm)) o["co2_ppm"] = latest[i].co2_ppm;
    o["rs_kohm"] = latest[i].rs_kohm; o["vbat"] = latest[i].vbat; o["flags"] = latest[i].flags;
    fresh[i] = false;
  }
  portEXIT_CRITICAL(&mux);
  String body; serializeJson(doc, body);

  if (!netUp()) return false;
  http.beginRequest();
  http.post("/api/v1/ingest");
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("X-Device-Key", DEVICE_KEY);
  http.sendHeader("Content-Length", body.length());
  http.beginBody();
  http.print(body);
  http.endRequest();
  int code = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  if (code != 200) { Serial.printf("server HTTP %d\n", code); return false; }

  JsonDocument r;
  if (deserializeJson(r, resp)) return false;
  // Server reply: {"fan":0|1, "buzzer":0|1, "level":"ok|watch|warn|danger"}
  if (!localOverride) fanOn = r["fan"] | 0;
  buzzer = r["buzzer"] | 0;
  return true;
}

void localSafety() {
  // runs when the server has been unreachable for OFFLINE_FALLBACK_MS
  float worst = 0;
  for (int i = 0; i < N_NODES; i++) if (!isnan(latest[i].nh3_ppm)) worst = max(worst, latest[i].nh3_ppm);
  if (worst >= LOCAL_ON_PPM) { localOverride = true; fanOn = true; buzzer = true; }
  else if (worst < LOCAL_OFF_PPM && localOverride) { localOverride = false; fanOn = false; buzzer = false; }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_FAN, OUTPUT); pinMode(PIN_BUZZ, OUTPUT); pinMode(PIN_LED, OUTPUT);
  applyOutputs();
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  Serial.print("Gateway MAC (put in nodes): "); Serial.println(WiFi.macAddress());
  esp_now_init();
  esp_now_register_recv_cb(onRecv);
  SerialAT.begin(9600, SERIAL_8N1, 16, 17);
  modem.restart();
  lastServerOk = millis();
}

void loop() {
  static uint32_t lastUpload = 0;
  if (millis() - lastUpload >= UPLOAD_MS) {
    lastUpload = millis();
    if (upload()) { lastServerOk = millis(); if (localOverride) localOverride = false; }
    else Serial.println("upload failed");
  }
  if (millis() - lastServerOk > OFFLINE_FALLBACK_MS) localSafety();
  applyOutputs();
  // buzzer: short beep every 5 s while an alarm is active
  digitalWrite(PIN_BUZZ, (buzzer && (millis() / 250) % 20 == 0) ? HIGH : LOW);
  delay(50);
}
