#include <SPI.h>
#include <Adafruit_NeoTrellis.h>
#include <ArduinoJson.h>

// NOTE: From tests/neotrellis_lib_test/basic_8_new_animation_seqs
namespace Keypad {
  const int num_pixels = NEO_TRELLIS_NUM_KEYS;
  Adafruit_NeoTrellis trellis;
  uint32_t gem_state[16];
  unsigned long loop_timer = 0;

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
    for (int n = 0; n < 16; n++) {
      if(((1 << n) & state) == (1 << n)) {
        uint32_t color = keyColor(n);
        trellis.pixels.setPixelColor(n, color);
        gem_state[n] = color;
      } else {
        trellis.pixels.setPixelColor(n, 0);
        gem_state[n] = 0;     
      }
    }
    trellis.pixels.show();
  }

  // Update the state of the pixels based on the given RGB state
  void updateRGB(uint32_t *rgb_state) {

    for (int n = 0; n < 16; n++) {
      trellis.pixels.setPixelColor(n, rgb_state[n]);
      gem_state[n] = rgb_state[n];
    }
    trellis.pixels.show();
  }

  void turnOnAll() {
    update(0xFFFF);
  }

  void turnOffAll() {
    update(0x0000);
  }

  void showCascade() {
    for (uint16_t i=0; i<num_pixels; i++) {
      trellis.pixels.setPixelColor(i, keyColor(i));
      trellis.pixels.show();
      delay(50);
    }
    for (uint16_t i=0; i<num_pixels; i++) {
      trellis.pixels.setPixelColor(i, 0x000000);
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
    trellis.read();
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

  void loop() {
    trellis.read();
  }

  void init(TrellisCallback(*onKeyPress)(keyEvent)) {

    if (!trellis.begin()) {
      ERROR_PRLN(F("ERROR: Could not start trellis, check wiring?"));
      while(1) delay(1);
    } else {
      //activate all keys and set doResetCallbacks
      for(int i=0; i<NEO_TRELLIS_NUM_KEYS; i++){
        trellis.activateKey(i, SEESAW_KEYPAD_EDGE_RISING);
        trellis.activateKey(i, SEESAW_KEYPAD_EDGE_FALLING);
        trellis.registerCallback(i, onKeyPress);
      }

      // Show boot-up animation and enter DEFAULT mode
      showCascade();
      
      INFO_PRLN("NeoPixel Trellis started");
    }
  }  


  void blinkConfirmation() {
    turnOffAll();
    turnOnAll();
    delay(200);
    turnOffAll();
    delay(200);    
    turnOnAll();
    delay(200);
    turnOffAll();
  }

  void blinkError() {
    turnOffAll();
    update(PATTERN_ERROR[0]);
    delay(200);
    turnOffAll();
    delay(200);
    update(PATTERN_ERROR[0]);
    delay(200);
    turnOffAll();
    delay(200);
    update(PATTERN_ERROR[0]);
    delay(200);
    turnOffAll();        
  }

}