/*
 * AfyaNest DHT finder: tries every Arduino Uno pin and prints which one has a
 * working DHT11 or DHT22. Upload, open Serial Monitor at 9600 baud (or read it from
 * the terminal), note the pin, then set DHT_PIN / DHT_TYPE in afyanest_uno.ino.
 *
 * Needs the same "DHT sensor library" by Adafruit.
 */
#include <DHT.h>

const uint8_t PINS[] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, A0, A1, A2, A3, A4, A5};

void setup() {
  Serial.begin(9600);
  delay(1500);
  Serial.println(F("SCAN,start"));
}

void loop() {
  bool found = false;
  for (uint8_t i = 0; i < sizeof(PINS); i++) {
    uint8_t types[] = {DHT11, DHT22};
    for (uint8_t k = 0; k < 2; k++) {
      DHT d(PINS[i], types[k]);
      d.begin();
      delay(2100);                          // sensor needs 2 s between reads
      float t = d.readTemperature(), h = d.readHumidity();
      if (!isnan(t) && !isnan(h) && h > 0 && h <= 100) {
        Serial.print(F("FOUND,pin="));
        if (PINS[i] >= A0) { Serial.print('A'); Serial.print(PINS[i] - A0); }
        else Serial.print(PINS[i]);
        Serial.print(F(",type=")); Serial.print(types[k] == DHT11 ? F("DHT11") : F("DHT22"));
        Serial.print(F(",temp=")); Serial.print(t, 1);
        Serial.print(F(",rh=")); Serial.println(h, 0);
        found = true;
      }
    }
  }
  if (!found) Serial.println(F("NOTFOUND,check + to 5V, - to GND, S/OUT to a digital pin"));
  Serial.println(F("SCAN,again"));
}
