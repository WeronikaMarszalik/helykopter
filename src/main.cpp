#include <Arduino.h>
#include <esp_arduino_version.h>
#include "S107Controller.h"

// BC547B is active HIGH; GPIO2 is only an indicator, NOT the IR output.
constexpr uint8_t kTxPin = 4, kRxPin = 14, kLedPin = 2;
constexpr uint32_t kCarrierHz = 38000;
s107::Controller controller;
uint32_t txCount = 0, rxCount = 0, cleanCount = 0, referenceCount = 0;
uint32_t consecutiveReference = 0, bestReference = 0, nextStatus = 0;
char pending[128]; size_t pendingLength = 0; bool discardLine = false;
bool pwmReady = false;

constexpr size_t kRxCapacity = 128;
portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint16_t rxRaw[kRxCapacity];
volatile size_t rxLength = 0;
volatile uint32_t rxEdge = 0;
volatile uint32_t rxEdges = 0;
volatile bool rxRunning = false, rxReady = false, rxOverflow = false, rxHigh = true;

void IRAM_ATTR receiveEdge() {
  const uint32_t now = micros();
  const bool high = digitalRead(kRxPin);
  portENTER_CRITICAL_ISR(&rxMux);
  ++rxEdges;
  if (!rxReady) {
    if (!rxRunning) {
      if (!high) { rxRunning = true; rxEdge = now; rxHigh = false; }
    } else {
      const uint32_t duration = now-rxEdge;
      if (duration > 6000) { rxReady = true; rxRunning = false; }
      else if (rxLength < kRxCapacity) {
        rxRaw[rxLength++] = duration;
        rxEdge = now; rxHigh = high;
      } else { rxOverflow = rxReady = true; rxRunning = false; }
    }
  }
  portEXIT_CRITICAL_ISR(&rxMux);
}

void carrier(bool on) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(kTxPin, on ? 85 : 0);
#else
  ledcWrite(0, on ? 85 : 0);
#endif
}

void status(const char* event = "status", bool ok = true) {
  Serial.printf("{\"event\":\"%s\",\"ok\":%s,\"firmware\":\"parakopter-tx-2\","
    "\"protocol\":1,\"mode\":\"%s\",\"reason\":\"%s\",\"throttle\":%u,"
    "\"token\":%lu,\"sequence\":%lu,\"tx\":%lu,\"rx\":%lu,\"clean\":%lu,"
    "\"reference\":%lu,\"consecutive\":%lu,\"best\":%lu,\"uptime\":%lu,"
    "\"tx_pin\":4,\"rx_pin\":14,\"carrier_hz\":38000,\"period_ms\":183,"
    "\"watchdog_ms\":500,\"throttle_limit\":127,\"pwm_ready\":%s,"
    "\"rx_edges\":%lu,\"rx_level\":%d}\n",
    event, ok?"true":"false", controller.name(), controller.reason,
    controller.values.throttle, (unsigned long)controller.token,
    (unsigned long)controller.sequence, (unsigned long)txCount, (unsigned long)rxCount,
    (unsigned long)cleanCount, (unsigned long)referenceCount,
    (unsigned long)consecutiveReference, (unsigned long)bestReference,
    (unsigned long)millis(), pwmReady?"true":"false", (unsigned long)rxEdges,
    digitalRead(kRxPin));
}

void readCommands() {
  unsigned budget = 192;
  while (budget-- && Serial.available()) {
    const char c = char(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      if (!discardLine && pendingLength) {
        pending[pendingLength] = 0;
        if (!strcmp(pending,"TEST") && controller.mode == s107::Mode::Idle)
          referenceCount = consecutiveReference = bestReference = 0;
        const bool ok = pwmReady && controller.command(pending,millis());
        status("ack",ok);
      }
      pendingLength = 0; discardLine = false;
    } else if (c < 32 || c > 126 || pendingLength >= sizeof(pending)-1) {
      discardLine = true; pendingLength = 0;
      controller.stop(millis(),"invalid_line");
    } else if (!discardLine) pending[pendingLength++] = c;
  }
}

void readReceiver() {
  uint16_t raw[kRxCapacity]; size_t n = 0; bool overflow = false;
  portENTER_CRITICAL(&rxMux);
  if (rxRunning && rxHigh && uint32_t(micros()-rxEdge) > 6000) {
    rxReady = true; rxRunning = false;
  }
  if (rxReady) {
    n = rxLength; overflow = rxOverflow;
    for (size_t i = 0; i < n; ++i) raw[i] = rxRaw[i];
    rxLength = 0; rxReady = rxRunning = rxOverflow = false;
  }
  portEXIT_CRITICAL(&rxMux);
  if (!n) return;
  ++rxCount;
  uint32_t word = 0;
  bool valid = s107::decode(raw,n,overflow,word);
  if (valid) ++cleanCount;
  if (valid && word == 0x3F3F8051) {
    ++referenceCount; ++consecutiveReference;
    if (consecutiveReference > bestReference) bestReference = consecutiveReference;
  } else consecutiveReference = 0;
  Serial.printf("{\"event\":\"rx\",\"valid\":%s,\"word\":\"%08lX\","
    "\"overflow\":%s,\"count\":%u,\"uptime\":%lu,\"raw\":[",
    valid?"true":"false", (unsigned long)word, overflow?"true":"false",
    unsigned(n), (unsigned long)millis());
  for (size_t i = 0; i < n; ++i) Serial.printf(i?",%u":"%u",raw[i]);
  Serial.println("]}");
}

void setup() {
  pinMode(kTxPin,OUTPUT); digitalWrite(kTxPin,LOW);
  pinMode(kLedPin,OUTPUT); digitalWrite(kLedPin,LOW);
  Serial.begin(115200);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  pwmReady = ledcAttach(kTxPin,kCarrierHz,8);
#else
  pwmReady = ledcSetup(0,kCarrierHz,8) > 0;
  ledcAttachPin(kTxPin,0);
#endif
  if (pwmReady) carrier(false);
  pinMode(kRxPin,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(kRxPin),receiveEdge,CHANGE);
  status("ready");
}

void loop() {
  controller.tick(millis());
  readCommands();
  readReceiver();
  uint16_t raw[67];
  if (pwmReady && controller.frame(millis(),raw)) {
    digitalWrite(kLedPin,HIGH);
    for (unsigned i = 0; i < 67; ++i) {
      carrier(!(i&1)); delayMicroseconds(raw[i]);
    }
    carrier(false); digitalWrite(kLedPin,LOW); ++txCount;
  }
  if (int32_t(millis()-nextStatus) >= 0) {
    nextStatus = millis()+250; status();
  }
  delay(1);
}
