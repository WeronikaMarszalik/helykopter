#include <Arduino.h>
#include <IRrecv.h>
#include <IRremoteESP8266.h>
#include <IRutils.h>

#include <string>

#include "IrFormat.h"

#ifndef IR_RECV_PIN
#define IR_RECV_PIN 14
#endif
#ifndef LED_PIN
#define LED_PIN 2
#endif
#ifndef SERIAL_BAUD
#define SERIAL_BAUD 115200
#endif

static const uint16_t kCaptureBufferSize = 1024;

IRrecv irrecv(IR_RECV_PIN, kCaptureBufferSize, kTimeoutMs, true);
decode_results results;

static std::string label = "unlabeled";
static std::string pending;
static unsigned counter = 1;
static const unsigned long kLedMs = 120;
static unsigned long ledOffAt = 0;
static bool ledOn = false;

static void readLabelInput() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (c == '\r' && Serial.peek() == '\n') continue;
      label = irfmt::sanitizeLabel(pending);
      pending.clear();
      counter = 1;
      Serial.printf("# label = %s\n", label.c_str());
    } else if (pending.size() < 128) {
      pending += c;
    }
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(SERIAL_BAUD);
  delay(200);
  irrecv.enableIRIn();
  Serial.printf("\n# IR dump ready: pin=%d baud=%d led=%d label=%s\n", IR_RECV_PIN,
                SERIAL_BAUD, LED_PIN, label.c_str());
}

void loop() {
  readLabelInput();
  if (irrecv.decode(&results)) {
    static uint16_t us[kCaptureBufferSize];
    size_t n = 0;
    for (uint16_t i = 1; i < results.rawlen && n < kCaptureBufferSize; i++)
      us[n++] = (uint16_t)(results.rawbuf[i] * kRawTick);
    std::string protocol = typeToString(results.decode_type).c_str();
    std::string out = irfmt::formatFrame(label, counter++, protocol, us, n,
                                         results.overflow);
    Serial.print(out.c_str());
    digitalWrite(LED_PIN, HIGH);
    ledOn = true;
    ledOffAt = millis() + kLedMs;
    irrecv.resume();
  }
  if (ledOn && (long)(millis() - ledOffAt) >= 0) {
    digitalWrite(LED_PIN, LOW);
    ledOn = false;
  }
  yield();
}
