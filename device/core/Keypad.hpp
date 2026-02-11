#include <SPI.h>
#include <Adafruit_NeoTrellis.h>
#include <ArduinoJson.h>

// NOTE: From tests/neotrellis_lib_test/basic_8_new_animation_seqs
namespace Keypad {
  const int num_pixels = NEO_TRELLIS_NUM_KEYS;
  Adafruit_NeoTrellis trellis;
  
  // Framebuffer for gem state and dirty flag
  uint32_t gem_state[16];
  boolean needs_update = false;
  
  unsigned long loop_timer = 0;

  // TODO: Actually wire NeoTrellis INT pin to MCU interrupt pin
  // uint8_t  interrupt_pin = 10;

  void read() {

    // TODO: Actually wire NeoTrellis INT pin to MCU interrupt pin
    // // detect if trellis interrupt pin is low (meaning data is ready)
    // // instead of polling for new data
    // if(!digitalRead(interrupt_pin)) {
    //   trellis.read(false);
    // }

    // For now continue polling
    trellis.read(true);
  }

  // Draw the current gem_state to the pixels
  void draw() {
    for (int n = 0; n < 16; n++) {
      trellis.pixels.setPixelColor(n, gem_state[n]);
    }
    trellis.pixels.show();
    needs_update = false; 
  } 

  void loop() {
    read();
    if (needs_update) {
      draw();
    }
    delay(2);
  }

  // Returns a fixed Color for a given buttonIndex
  uint32_t keyColor(int buttonIndex) {
    // Input a value 0 to 255 to get a color value.
    // The colors are a transition r - g - b - back to r.
    byte wheelPos = map(buttonIndex, 0, num_pixels, 0, 255);
    if(wheelPos < 85) {
      return trellis.pixels.Color(wheelPos * 3, 255 - wheelPos * 3, 0);
    } else if(wheelPos < 170) {
      wheelPos -= 85;
      return trellis.pixels.Color(255 - wheelPos * 3, 0, wheelPos * 3);
    } else {
      wheelPos -= 170;
      return trellis.pixels.Color(0, wheelPos * 3, 255 - wheelPos * 3);
    }
    return 0;
  }
  
  // Update the state of the pixels based on the given state
  void update(uint16_t state) {
    needs_update = true;
    for (int n = 0; n < 16; n++) {
      if(((1 << n) & state) == (1 << n)) {
        uint32_t color = keyColor(n);
        gem_state[n] = color;
      } else {
        gem_state[n] = 0;     
      }
    }
  }

  // Update the state of the pixels based on the given RGB state
  void updateRGB(uint32_t *rgb_state) {
    needs_update = true;
    for (int n = 0; n < 16; n++) {
      gem_state[n] = rgb_state[n];
    }
  }

  void turnOnAll() {
    update(0xFFFF);
  }

  void turnOffAll() {
    update(0x0000);
  }

  // NOTE: This is a blocking animation that
  // also clears the gem_state framebuffer 
  void showCascade() {
    for (uint16_t i=0; i<num_pixels; i++) {
      trellis.pixels.setPixelColor(i, keyColor(i));
      trellis.pixels.show();
      delay(50);
    }
    for (uint16_t i=0; i<num_pixels; i++) {
      trellis.pixels.setPixelColor(i, 0x000000);
      gem_state[i] = 0;
      trellis.pixels.show();
      delay(50);
    }
  }

  //////////////////
  void loopPattern(const uint16_t *pattern, size_t len, unsigned long delay = 100) {
    if(loop_timer == 0) {
      loop_timer = millis();
      update(pattern[0]);
    } else if ((millis() - loop_timer) < delay * len) {
      size_t index = (millis() - loop_timer) / delay;
      if (index < len) {
        update(pattern[index]);
      }
    } else {
      loop_timer = 0;
    }
    loop();
  }

  size_t PATTERN_SEEK_LEN = 8;
  const uint16_t PATTERN_SEEK [] = {
    576, 12684, 4104, 0,
    1056, 51219, 32769, 0
  };  
  void loopSeek(unsigned long delay = 100) {
    loopPattern(PATTERN_SEEK, PATTERN_SEEK_LEN, delay);
  }

  //////////////////
  const size_t PATTERN_SPINNER_LEN = 6;
  const uint16_t PATTERN_SPINNER [] = {
    4680, 8772, 17442, 33825, 3120, 960
  };
  void loopSpinner(unsigned long delay = 100) {
    loopPattern(PATTERN_SPINNER, PATTERN_SPINNER_LEN, delay);
  }

  //////////////////
  const size_t PATTERN_SPIRAL_LEN = 24;
  const uint16_t PATTERN_SPIRAL [] = {
    1, 3, 7, 15, 143, 2191, 34959, 51343, 59535, 63631, 63887, 63903, 63902, 63900, 63896, 63888, 63760, 61712, 28944, 12560, 4368, 272, 16, 0
  };
  void loopSpiral(unsigned long delay = 100) {
    loopPattern(PATTERN_SPIRAL, PATTERN_SPIRAL_LEN, delay);
  }

  //////////////////
  const size_t PATTERN_ERROR_LEN = 2;
  const uint16_t PATTERN_ERROR [] = {
    38505, 0
  }; 
  void loopError(unsigned long delay = 100) {
    loopPattern(PATTERN_ERROR, PATTERN_ERROR_LEN, delay);
  }

  //////////////////
  const size_t PATTERN_WARNING_LEN = 2;
  const uint16_t PATTERN_WARNING [] = {
    27030, 0
  }; 
  void loopWarning(unsigned long delay = 100) {
    loopPattern(PATTERN_WARNING, PATTERN_WARNING_LEN, delay);
  } 

// ----- Tuning knobs -----
static constexpr uint16_t NUM_KEYS      = NEO_TRELLIS_NUM_KEYS; // 16
static constexpr uint32_t DBLCLICK_MS   = 400;  // typical desktop-ish dblclick window

static void (*onPress)(uint8_t) = nullptr;
static void (*onRelease)(uint8_t) = nullptr;
static void(*onClick)(uint8_t, uint32_t) = nullptr; 
static void(*onDoubleClick)(uint8_t) = nullptr;

// ----- Per-key state -----
static bool     waitingSecond[NUM_KEYS]  = {false}; // after first click, waiting for second
static uint32_t firstClickMs[NUM_KEYS]   = {0};
static uint32_t mouseDownkMs[NUM_KEYS]   = {0};

static void logEvent(uint8_t key, const __FlashStringHelper* name) {
  INFO_PRINT(F("[Keypad] key "));
  INFO_PRINT(key);
  INFO_PRINT(F(" (x="));
  INFO_PRINT(NEO_TRELLIS_X(key));
  INFO_PRINT(F(",y="));
  INFO_PRINT(NEO_TRELLIS_Y(key));
  INFO_PRINT(F(") : "));
  INFO_PRINT(name);
  INFO_PRINT(F(" @ "));
  INFO_PRLN(millis());
}

// Called on every key RELEASE (mouseup), because clicks happen on release.
static void handleReleaseAsBrowserClick(uint8_t key) {
  const uint32_t now = millis();

  // 1) Browser-like click fires immediately on release.
  const uint32_t pressDuration = now - mouseDownkMs[key];
  onClick(key, pressDuration);

  // 2) Decide whether this is click#1 or click#2 of a potential double-click.
  if (!waitingSecond[key]) {
    // First click in a potential pair: arm the double-click window.
    waitingSecond[key] = true;
    firstClickMs[key]  = now;

  } else {
    // We were waiting for a second click.
    const uint32_t dt = now - firstClickMs[key];
    if (dt <= DBLCLICK_MS) {
      // Success: this is a browser-like dblclick AFTER two clicks.
      onDoubleClick(key);

    } else {
      // Too late: treat this as a new "first click" (start a new window).
      waitingSecond[key] = true;
      firstClickMs[key]  = now;
    }
  }
}

TrellisCallback handleKeyEvent(keyEvent evt) {
  const uint8_t key = evt.bit.NUM;

  if (evt.bit.EDGE == SEESAW_KEYPAD_EDGE_RISING) {    
    // Pressed
    mouseDownkMs[key] = millis();  
    logEvent(key, F("button_press"));
    onPress(key);

  } else if (evt.bit.EDGE == SEESAW_KEYPAD_EDGE_FALLING) {
    // Released
    logEvent(key, F("button_release"));
    onRelease(key);

    // Now model browser click/dblclick semantics on RELEASE:
    handleReleaseAsBrowserClick(key);
  }

  return 0;
}

  void init(
    void(*onPress)(uint8_t),
    void(*onRelease)(uint8_t),
    void(*onClick)(uint8_t, uint32_t),
    void(*onDoubleClick)(uint8_t),
    uint8_t interruptPin = 10) {
    
    Keypad::onPress = onPress;
    Keypad::onRelease = onRelease;
    Keypad::onClick = onClick;
    Keypad::onDoubleClick = onDoubleClick;

    // TODO: Actually wire NeoTrellis INT pin to MCU interrupt pin
    // // Setup trellis interrupt pin
    // interrupt_pin = interruptPin;
    // pinMode(interrupt_pin, INPUT); 

    if (!trellis.begin()) {
      ERROR_PRLN(F("ERROR: Could not start trellis, check wiring?"));
      while(1) delay(1);
    } else {
      //activate all keys and set doResetCallbacks
      for(int i=0; i<NEO_TRELLIS_NUM_KEYS; i++){
        trellis.activateKey(i, SEESAW_KEYPAD_EDGE_RISING);
        trellis.activateKey(i, SEESAW_KEYPAD_EDGE_FALLING);
        trellis.registerCallback(i, handleKeyEvent);
      }

      // Show boot-up animation and enter DEFAULT mode
      showCascade();
      
      INFO_PRLN("NeoPixel Trellis started");
    }
  }  

  // Blocking confirmation blink
  void blinkConfirmation() {
    turnOffAll();
    draw();

    turnOnAll();
    draw();
    delay(200);

    turnOffAll();
    draw();
    delay(200);
    
    turnOnAll();
    draw();
    delay(200);
    
    turnOffAll();
    draw();
  }

  // Blocking error blink
  void blinkError() {

    turnOffAll();
    draw();
    
    update(PATTERN_ERROR[0]);
    draw();
    delay(200);
    
    turnOffAll();
    draw();
    delay(200);
    
    update(PATTERN_ERROR[0]);
    draw();
    delay(200);
    
    turnOffAll();
    draw();
    delay(200);
    
    update(PATTERN_ERROR[0]);
    draw();
    delay(200);
    
    turnOffAll();
    draw();
  }

}