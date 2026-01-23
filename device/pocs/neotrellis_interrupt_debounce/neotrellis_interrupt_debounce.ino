#include "Adafruit_NeoTrellis.h"

Adafruit_NeoTrellis trellis;

#define INT_PIN 10  // match your wiring

// ---- Tuning knobs ----
static constexpr uint16_t NUM_KEYS = NEO_TRELLIS_NUM_KEYS; // 16 on a 4x4
static constexpr uint32_t DEBOUNCE_MS = 50;   // typical 20–50ms

// ---- Debouncer state ----
static bool rawPressed[NUM_KEYS] = {false};
static bool debouncedPressed[NUM_KEYS] = {false};
static uint32_t lastRawChangeMs[NUM_KEYS] = {0};

static void onDebouncedPress(uint8_t key) {
  // TODO: your “real press” action
  // example: light it up
  trellis.pixels.setPixelColor(key, trellis.pixels.Color(0, 50, 0));
  trellis.pixels.show();

  Serial.println("Debounced press detected on key " + String(key));
}

static void onDebouncedRelease(uint8_t key) {
  // TODO: your “real release” action
  trellis.pixels.setPixelColor(key, 0);
  trellis.pixels.show();

  Serial.println("Debounced release detected on key " + String(key));
}

// Callback invoked by trellis.read() when events are drained from seesaw FIFO
TrellisCallback handleKeyEvent(keyEvent evt) {
  const uint8_t k = evt.bit.NUM;
  const uint8_t edge = evt.bit.EDGE;

  // Update raw state immediately from edges
  if (edge == SEESAW_KEYPAD_EDGE_RISING) {

    Serial.println("Key " + String(k) + " pressed");
    rawPressed[k] = true;
    lastRawChangeMs[k] = millis();
  } else if (edge == SEESAW_KEYPAD_EDGE_FALLING) {
    
    Serial.println("Key " + String(k) + " released");
    rawPressed[k] = false;
    lastRawChangeMs[k] = millis();
  }
  return 0;
}

// Debouncer “tick”: promote raw -> debounced only after stability window
static void debounceTick() {
  const uint32_t now = millis();

  for (uint8_t k = 0; k < NUM_KEYS; k++) {
    if (rawPressed[k] == debouncedPressed[k]) continue;

    // Has raw stayed in its current state long enough?
    if ((now - lastRawChangeMs[k]) < DEBOUNCE_MS) continue;
    // Accept new debounced state
    debouncedPressed[k] = rawPressed[k];

    if (debouncedPressed[k]) {
      onDebouncedPress(k);
    } else {
      onDebouncedRelease(k);
    }
  }
}

// Input a value 0 to 255 to get a color value.
// The colors are a transition r - g - b - back to r.
uint32_t Wheel(byte WheelPos) {
  if(WheelPos < 85) {
   return trellis.pixels.Color(WheelPos * 3, 255 - WheelPos * 3, 0);
  } else if(WheelPos < 170) {
   WheelPos -= 85;
   return trellis.pixels.Color(255 - WheelPos * 3, 0, WheelPos * 3);
  } else {
   WheelPos -= 170;
   return trellis.pixels.Color(0, WheelPos * 3, 255 - WheelPos * 3);
  }
}


void setup() {
  Serial.begin(9600);
  delay(1000); // wait for serial

  pinMode(INT_PIN, INPUT);

  if (!trellis.begin()) {
    Serial.println("NeoTrellis not found");
    while (1) delay(10);
  }


  // Subscribe to events and route them to our raw-event handler
  for (uint8_t i = 0; i < NUM_KEYS; i++) {
    trellis.activateKey(i, SEESAW_KEYPAD_EDGE_RISING);
    trellis.activateKey(i, SEESAW_KEYPAD_EDGE_FALLING);
    trellis.registerCallback(i, handleKeyEvent);
  }

  //do a little animation to show we're on
  for(uint16_t i=0; i<trellis.pixels.numPixels(); i++) {
    trellis.pixels.setPixelColor(i, Wheel(map(i, 0, trellis.pixels.numPixels(), 0, 255)));
    trellis.pixels.show();
    delay(50);
  }
  for(uint16_t i=0; i<trellis.pixels.numPixels(); i++) {
    trellis.pixels.setPixelColor(i, 0x000000);
    trellis.pixels.show();
    delay(50);
  }

  trellis.pixels.setBrightness(30);
  trellis.pixels.show();

  Serial.println("NeoTrellis found!");

}

void loop() {
  // Drain seesaw FIFO when INT asserts (LOW). INT stays low until you read events.
  if (!digitalRead(INT_PIN)) {
    trellis.read(false); // read events + invoke callbacks
  }

  // Promote raw->debounced at your leisure; no need to run insanely fast
  debounceTick();
}
