// File: lib/Debug/debug.h
#pragma once
#include <Arduino.h>

// Log levels
#define LOG_LEVEL_NONE -1
#define LOG_LEVEL_ERROR 0
#define LOG_LEVEL_WARN  1
#define LOG_LEVEL_INFO  2
#define LOG_LEVEL_DEBUG 3

// Default log level (can be overridden at compile time)
#ifndef LOG_LEVEL
  #define LOG_LEVEL LOG_LEVEL_NONE
#endif

// Base macros for print and println at a given level
// Note: The `do { ... } while (0)` wrapper makes this multi-statement macro into a single
// statement, ensuring it behaves correctly in if/else blocks and avoids stray semicolons.
// Note: It's important to wrap Serial.print() when logging, because calls can be buffered 
// and eventually block waiting for a host connection to read them 
#define LOG_PRINT(level, msg)              \
  do {                                          \
    if ((level) <= LOG_LEVEL && Serial) {        \
      Serial.print(msg);                         \
    }                                            \
  } while (0)

#define LOG_PRLN(level, msg)               \
  do {                                          \
    if ((level) <= LOG_LEVEL && Serial) {        \
      Serial.println(msg);                       \
    }                                            \
  } while (0)

// ERROR
#define ERROR_PRINT(msg) LOG_PRINT(LOG_LEVEL_ERROR, msg)
#define ERROR_PRLN(msg)  LOG_PRLN(LOG_LEVEL_ERROR, msg)

// WARN
#define WARN_PRINT(msg) LOG_PRINT(LOG_LEVEL_WARN, msg)
#define WARN_PRLN(msg)  LOG_PRLN(LOG_LEVEL_WARN, msg)

// INFO
#define INFO_PRINT(msg) LOG_PRINT(LOG_LEVEL_INFO, msg)
#define INFO_PRLN(msg)  LOG_PRLN(LOG_LEVEL_INFO, msg)

// DEBUG
#define DEBUG_PRINT(msg) LOG_PRINT(LOG_LEVEL_DEBUG, msg)
#define DEBUG_PRLN(msg)  LOG_PRLN(LOG_LEVEL_DEBUG, msg)

// Assertions: log at ERROR level when the expression is false.
// Inherit Serial+level guards from ERROR_PRINT / ERROR_PRLN.
#define ASSERT_PRINT(expression, msg) \
  do {                                \
    if (!(expression)) {              \
      ERROR_PRINT(msg);               \
    }                                 \
  } while (0)

#define ASSERT_PRLN(expression, msg) \
  do {                                   \
    if (!(expression)) {                 \
      ERROR_PRLN(msg);                   \
    }                                    \
  } while (0)
  

String IP_UINT32_to_STRING(uint32_t ip) {
    ip = ((ip & 0xFF000000) >> 24) |
         ((ip & 0x00FF0000) >> 8)  |
         ((ip & 0x0000FF00) << 8)  |
         ((ip & 0x000000FF) << 24);
    char buf[16];
    sprintf(buf, "%u.%u.%u.%u",
            (ip >> 24) & 0xFF,
            (ip >> 16) & 0xFF,
            (ip >> 8) & 0xFF,
            ip & 0xFF);
    return String(buf);
}

// const String wl_status_to_string(uint8_t value) {
//   switch (value) {
//     case WL_NO_SHIELD:           return F("WL_NO_SHIELD");
//     case WL_IDLE_STATUS:         return F("WL_IDLE_STATUS");
//     case WL_NO_SSID_AVAIL:       return F("WL_NO_SSID_AVAIL");
//     case WL_SCAN_COMPLETED:      return F("WL_SCAN_COMPLETED");
//     case WL_CONNECTED:           return F("WL_CONNECTED");
//     case WL_CONNECT_FAILED:      return F("WL_CONNECT_FAILED");
//     case WL_CONNECTION_LOST:     return F("WL_CONNECTION_LOST");
//     case WL_DISCONNECTED:        return F("WL_DISCONNECTED");
//     case WL_AP_LISTENING:        return F("WL_AP_LISTENING");
//     case WL_AP_CONNECTED:        return F("WL_AP_CONNECTED");
//     case WL_AP_FAILED:           return F("WL_AP_FAILED");
//     case WL_PROVISIONING:        return F("WL_PROVISIONING");
//     case WL_PROVISIONING_FAILED: return F("WL_PROVISIONING_FAILED");
//     default:                     return F("UNKNOWN");
//   }
// };