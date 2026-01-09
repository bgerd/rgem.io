/*
Give me a non-blocking function with the following decleration:

  void ledLoopPattern(uint8_t ledPin, const long*pattern, size_t len)

Given a pattern array of time delays, it loops through the array and alternate between turning
the specified ledPin ON and OFF (e.g. digitalWrite(ledPin, HIGH) and digitalWrite(ledPin, LOW)
for the given delay. For instance 

      digitalWrite(ledPin, HIGH);
      delay(400);
      digitalWrite(ledPin, LOW);
      delay(50);
      digitalWrite(ledPin, HIGH);
      delay(100);
      digitalWrite(ledPin, LOW);
      delay(50);
      digitalWrite(ledPin, HIGH);
      delay(75);

Would correspond to a pattern of [400, 50, 100, 50, 50, 75]
*/

/**
 * Non-blocking LED pattern player.
 *
 * Repeatedly toggles the given LED pin HIGH/LOW using successive delays from
 * the pattern array. Uses millis()-based timing (no delay()), so it must be
 * called frequently from loop(). Starts with the LED ON for the first step,
 * advances through pattern[0..len-1], and loops back to index 0.
 *
 * Reinitializes and restarts the sequence when ledPin, pattern pointer, or
 * len changes. Uses internal static state, so only one active pattern is
 * supported at a time (refactor to a struct for multiple LEDs).
 *
 * Params:
 *  - ledPin  : Digital output pin for the LED; pinMode(OUTPUT) is set on init.
 *  - pattern : Array of millisecond intervals; pattern[i] <= 0 treated as 0.
 *  - len     : Number of entries in pattern; must be > 0.
 *
 * Example:
 *  const long pat[] = {400, 50, 100, 50, 50, 75};
 *  void loop() { ledLoopPattern(LED_BUILTIN, pat, 6); }
 */
void ledLoopPattern(uint8_t ledPin, const long* pattern, size_t len) {
  static const long* s_pattern = nullptr;
  static size_t s_len = 0;
  static size_t s_index = 0;
  static unsigned long s_last = 0;
  static bool s_state = LOW;
  static uint8_t s_pin = 255;

  if (!pattern || len == 0) return;

  // Initialize or reinitialize when pin/pattern/length changes
  if (pattern != s_pattern || len != s_len || ledPin != s_pin) {
    s_pattern = pattern;
    s_len = len;
    s_index = 0;
    s_pin = ledPin;
    s_last = millis();
    s_state = HIGH;                 // start pattern with LED ON
    pinMode(ledPin, OUTPUT);
    digitalWrite(ledPin, s_state);  // apply initial state
    return;                         // wait for pattern[0] interval
  }

  unsigned long now = millis();
  unsigned long interval = pattern[s_index] > 0 ? (unsigned long)pattern[s_index] : 0UL;

  if ((unsigned long)(now - s_last) >= interval) {
    s_last = now;
    s_state = !s_state;             // toggle LED
    digitalWrite(ledPin, s_state);
    s_index = (s_index + 1) % s_len; // next interval, loop at end
  }
}