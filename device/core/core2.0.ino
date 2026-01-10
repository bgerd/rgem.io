// Td. Fix VS Code Include Paths 

#define RGEMPAD_CORE_VERSION "core2.0"
#define RGEMPAD_CORE_MODEL "rgempad"

// #define RGEMPAD_DEBUG
#ifdef RGEMPAD_DEBUG
  #define LOG_LEVEL LOG_LEVEL_INFO
#endif

#include "debug.h"
#include "utils.hpp"

// samd21 lib
#include <FlashStorage_SAMD.h>
#include "Networking.hpp"
#include "Keypad.hpp"
#include "HttpConfigServer.hpp"
#include "WebSocketClient.hpp"

// bgerd
const int ledPin = 13; // LED pin for connectivity status indicator

// Configure State Machine
enum Mode { BOOT, PROVISIONING, WIFI_DISCONNECTED, WIFI_CONNECTED, WSOCKET_CONNECTED};
Mode last_state;
Mode next_state;

#include <ArduinoJson.h>
JsonDocument json_doc;

// Use fast and lightweight base64 library for decoding gemState updates from the server
// See: https://github.com/Densaugeo/base64_arduino
#include <base64.hpp>

///////////////////////////////
// Configure flash storage with samd-specific API
// Td. Reimplement with generic EEPROM API 
// Assert NULL initial values
struct GemCredentials {
  char gemID[32];  
};

bool credentials_equal(const GemCredentials& a, const GemCredentials& b) {
    return memcmp(a.gemID, b.gemID, sizeof(a.gemID)) == 0;
}

FlashStorage(gem_credentials, GemCredentials);
GemCredentials cred_stored;

const char* DEFAULT_GEMID = "default";

const unsigned long WIFI_TIMEOUT_MS = 5000;  // 5 seconds

const uint16_t CORNER_KEYS_MASK = (1<<0)|(1<<3)|(1<<12)|(1<<15);
const uint32_t CORNER_HOLD_MS = 5000;  // 5 seconds
uint16_t keys_pressed = 0x00;

TrellisCallback onKeyPress(keyEvent evt){

  // Check is the pad pressed?
  if (evt.bit.EDGE == SEESAW_KEYPAD_EDGE_RISING) {

    // INFO_PRINT(F("key pressed: "));
    // INFO_PRLN(evt.bit.NUM);

    // Td. Look into distinguishing single and double keypress events
    keys_pressed = keys_pressed | (1 << evt.bit.NUM);

    // Todo: Reconsider whether we need to evaluate next_state / last_satate here
    if (next_state == WSOCKET_CONNECTED && last_state == WSOCKET_CONNECTED) {

      ASSERT_PRLN(WebSocketConnection::websocket_client.isConnected(), F("ERROR: Invalid CONNECTED state. No websocket connection."));
      ASSERT_PRLN((WiFi.status() == WL_CONNECTED), F("ERROR: Invalid CONNECTED state. No wifi connection"));

      // Build json json_doc to emit toogle to rgempad-backend
      json_doc.clear();
      json_doc[F("type")] = F("toggle");
      json_doc[F("idx")] = evt.bit.NUM;
      
      // Note. Calculated 33-34 bytes to {"type": "toggle","buttonIndex":XX}
      String msg;
      msg.reserve(35);

      // Note. Tried and failed to wrap WebSocketClient in AduinoJson Custom Writer
      // per: https://arduinojson.org/v7/api/json/serializejson/#custom-writer
      serializeJson(json_doc, msg);

      INFO_PRINT(F("Sending: "));
      INFO_PRLN(msg);
      WebSocketConnection::websocket_client.sendTXT(msg);
    }

  } else if (evt.bit.EDGE == SEESAW_KEYPAD_EDGE_FALLING) {
    // or is the pad released?
    keys_pressed = keys_pressed & ! (1 << evt.bit.NUM);
  }
  return 0;
} 

// bool isResetButtonHold(std::function<void()> doResetCallback) {
bool isResetButtonHold() {
  
  // Detect Corner Hold
  if((keys_pressed & CORNER_KEYS_MASK) == CORNER_KEYS_MASK) {

    long cornerHoldStart = 0;
    INFO_PRLN(F("Corner Hold Detected"));
    do {
      if(0 == cornerHoldStart) {
        cornerHoldStart = millis();
      } else if((millis() - cornerHoldStart) > CORNER_HOLD_MS){

        // INFO_PRLN(F("Corner Hold Calledback Triggered"));
        // doResetCallback();
        return true;
      }
      // This loop() is needed to detect changes to keys_pressed
      Keypad::loop();
    } while((keys_pressed & CORNER_KEYS_MASK) == CORNER_KEYS_MASK);

    INFO_PRLN(F("Corner Hold Release Detected"));
    cornerHoldStart = 0;
  }
  return false;
}

///////////////////////////////
void setup() {

#ifdef RGEMPAD_DEBUG
  Serial.begin(115200); while(!Serial) {}
#endif

  INFO_PRLN(F("-----------------"));
  INFO_PRINT(F("rgempad.core v"));
  INFO_PRLN(RGEMPAD_CORE_VERSION);

  Networking::init();
  Keypad::init(&onKeyPress);
  HttpConfigServer::init();

  WebSocketConnection::init([](const char* payload ) -> void {
    // Implements ReceiveMsgCallback
    // Note. This is a non-capturing lambda that will convert to a function pointer
    json_doc.clear();
    if (next_state == WSOCKET_CONNECTED && last_state == WSOCKET_CONNECTED) {

      // Consider how this should actually be impossible ...
      ASSERT_PRLN(WebSocketConnection::websocket_client.isConnected(), F("ERROR: Invalid CONNECTED state"));

      deserializeJson(json_doc, payload);
      if (F("hb") == json_doc[F("type")]) {
        // do nothing ..
      } else {
        
        ASSERT_PRLN((json_doc[F("type")] == "update"), F("ERROR: Invalid message from server"));

        // Convert base64 encoded gemState to uint8_t array and update
        // 1. Point directly to the string in the JsonDocument (No copy)
        const char* encoded = json_doc[F("gemState")]; 
        if (!encoded) return;

        // 2. Efficiently calculate required space
        size_t inputLen = strlen(encoded);
        size_t expectedLen = decode_base64_length((unsigned char*)encoded);

        // 3. Use a stack-allocated buffer for speed and safety
        // TODO: Try statically allocating decodeBuffer. Given fixed 48-byte payload we need 64 bytes of base64 encoding.
        uint8_t decodedBuffer[expectedLen]; 

        // 4. Perform the decode
        int actualLen = decode_base64((unsigned char*)encoded, decodedBuffer);

        // 5. Convert the decoded RGB byte array to uint32_t array expected by updateRGB
        uint32_t rgb_state[16];
        for (int i = 0; i < 16; i++) {
          rgb_state[i] = (decodedBuffer[3*i] << 16) | (decodedBuffer[3*i + 1] << 8) | decodedBuffer[3*i + 2];
        }

        Keypad::updateRGB(rgb_state);
      }
    }
  });

  // Load stored credentials & remote gem ID
  gem_credentials.read(cred_stored);
  if(cred_stored.gemID[0] == '\0') {
    INFO_PRLN(F("No stored remote gem ID found. Using `default`."));
    strncpy(cred_stored.gemID, DEFAULT_GEMID, sizeof(cred_stored.gemID) - 1);
    gem_credentials.write(cred_stored);
  }
  strncpy(HttpConfigServer::gemID, cred_stored.gemID, sizeof(HttpConfigServer::gemID) - 1);

  INFO_PRINT(F("Stored remote gem ID: "));
  if(strlen(cred_stored.gemID) == 0) {
    INFO_PRLN(F("NULL"));
  } else {
    INFO_PRINT('\"');
    INFO_PRINT(cred_stored.gemID);
    INFO_PRLN('\"');
  }

  last_state = BOOT;
  next_state = WIFI_DISCONNECTED;
}

void loop() {
  switch(next_state) {
    case BOOT:
      // Should never be here
      ERROR_PRLN(F("Error. In BOOT state in loop()"));
      while(true);
      break;
    case PROVISIONING:
      if (last_state != next_state) {
        init_provisioning();
        last_state = next_state;
      }
      do_provisioning();
      break;
    case WIFI_DISCONNECTED:
      if (last_state != next_state) {
        init_wifi_disconnected();
        last_state = next_state;
      }
      do_wifi_disconnected();
      break;
    case WIFI_CONNECTED:
      if (last_state != next_state) {
        init_wifi_connected();
        last_state = next_state;
      }
      do_wifi_connected();
      break;
    case WSOCKET_CONNECTED:
      if (last_state != next_state) {
        init_wsocket_connected();
        last_state = next_state;
      }
      do_wsocket_connected();
      break; 
    default:
      // Should never be here
      ERROR_PRLN(F("Error. Invalid state in loop()"));
      while(true);
      break;
  }
}

void init_provisioning() {
  INFO_PRLN(F("\nSTATE: PROVISIONING"));

  // Note important WINC1500 workaround!
  // (1) WiFi101_Generic MUST be patched to make startProvision() a public function
  // (2) The HttpConfigServerDomainName must be set to "192.168.1.1"
  // Because the winc1500's http server is strict about the http req "host:" header value
  // when m2m_wifi_start_provision_mode() is called with http redirection
  WiFi.startProvision(Networking::device_id.c_str(), "192.168.1.1", 1);

  INFO_PRINT(F("Starting AP: "));
  INFO_PRLN(Networking::device_id.c_str());
  INFO_PRLN(F("Connect open http://192.168.1.1/ to configure WiFi settings."));
}

void do_provisioning() {

  // Note that WiFi.status() internally calls winc1500 event loop
  switch(WiFi.status()){
    case WL_CONNECTED:
      INFO_PRLN(F("Provisioning Success. Connected to WiFi."));

      Keypad::blinkConfirmation();

      last_state = PROVISIONING;
      next_state = WIFI_CONNECTED;
      return;
    
    case WL_DISCONNECTED:

      // OBSERVED: when provisioning fails that WiFi.status() returns WL_DISCONNECTED
      INFO_PRLN(F("Bad Credentials. Soft reboot..."));  

      Keypad::blinkError();

      // Effectively force init_provisioning()
      last_state = BOOT;
      next_state = PROVISIONING;
      return;
    
    case WL_PROVISIONING:

      // Blink slow to indicate provisioning mode active
      ledLoopPattern(ledPin, (const long[]){100, 600}, 2);
      
      Keypad::loopSpiral(200);
      Keypad::loop();

      last_state = PROVISIONING;
      next_state = PROVISIONING;
      return;
    
    default:
      // Should never be here
      ERROR_PRLN(F("Error. Invalid state in do_provisioning()"));
      while(true);
      return;
  }
}

void init_wifi_disconnected() {
  INFO_PRLN(F("\nSTATE: WIFI_DISCONNECTED"));
}

void do_wifi_disconnected() {

  // Try and retry connecting to wifi every WIFI_TIMEOUT_MS 
  static unsigned long s_retry_timer = 0;
  if (s_retry_timer == 0) {
    s_retry_timer = millis();
  } else if ((millis() - s_retry_timer) < WIFI_TIMEOUT_MS) {
    // Do nothing
  } else {
    // Wait first WIFI_TIMEOUT_MS to give user change to reset
    INFO_PRLN(F("Attempting to reconnect to last known WiFi ..."));
    WiFi.begin();
    s_retry_timer = 0;
  }

  // Double blink to indicate disconnected state
  const long ledPattern[] = {100, 100, 100, 400};
  ledLoopPattern(ledPin, ledPattern, 4);

  Keypad::loopSpinner(150);
  Keypad::loop();

  // Check if connected
  if (WiFi.status() == WL_CONNECTED) {
    INFO_PRLN(F("Reconnected to WiFi."));
    last_state = WIFI_DISCONNECTED;
    next_state = WIFI_CONNECTED;
    return;
  }

  // Detect Reset Button Hold to force provisioning mode
  if (isResetButtonHold()) {
    INFO_PRLN(F("Reset to provisioning mode detected."));

    Keypad::blinkConfirmation();

    last_state = WIFI_DISCONNECTED;
    next_state = PROVISIONING;      
    return;
  }
} 

void init_wifi_connected() {
  INFO_PRLN(F("\nSTATE: WIFI_CONNECTED"));

  // // Connected, make the LED stay on
  digitalWrite(ledPin, HIGH);

  // Print out the status
  INFO_PRINT(F("SSID: "));
  INFO_PRLN(WiFi.SSID());

  INFO_PRINT(F("IP Address: "));
  INFO_PRLN(IP_UINT32_to_STRING(WiFi.localIP()));

  INFO_PRINT(F("Signal Strength (RSSI):"));
  INFO_PRINT(WiFi.RSSI());
  INFO_PRLN(F(" dBm"));

  // Try connecting websocket client every WSOCKET_TIMEOUT_MS
  INFO_PRINT(F("Connecting to rgempad websocket backend: "));
  INFO_PRLN(WEBSOCKET_HOST);
  WebSocketConnection::websocket_client.beginSSL(WEBSOCKET_HOST, WEBSOCKET_PORT, WEBSOCKET_URL);
}

// Note that 
void do_wifi_connected() {

  // Check if WIFI disconnected 
  if (WiFi.status() != WL_CONNECTED) {
    INFO_PRLN(F("Disconnected from WiFi."));

    // Clean-up
    WebSocketConnection::websocket_client.disconnect();

    last_state = WIFI_CONNECTED;
    next_state = WIFI_DISCONNECTED;
    return;
  }

  // Check if websocket connected
  WebSocketConnection::websocket_client.loop();
  if (WebSocketConnection::websocket_client.isConnected()) {
    INFO_PRLN(F("Connected to rgempad backend!"));

    // DECISION: For Performance and Simplicity, while we could 
    // operate an WiFiServer when WIFI_CONNECTED, we don't because 
    // of how a websocket client asynchornously connecting and 
    // reconnecting effectively stalls the do_wifi_connected() event loop
    // every WEBSOCKET_RECONNECT_INTERVAL_MS

    // Start webserver
    INFO_PRLN(F("Starting Web server ..."));
    HttpConfigServer::server.begin();

    // Setup the MDNS responder to listen to the configured name.
    // NOTE: You _must_ call this _after_ connecting to the WiFi network and
    // being assigned an IP address.
    INFO_PRLN(F("Starting MDNS responder ..."));
    if (!Networking::advertiseService(WiFi.localIP())) {
      ERROR_PRLN(F("Failed to start MDNS responder!"));
    }

    INFO_PRINT(F("Server listening at http://"));
    INFO_PRINT(Networking::device_id.c_str());
    INFO_PRLN(F(".local/"));

    last_state = WIFI_CONNECTED;
    next_state = WSOCKET_CONNECTED;
    return;
  }
  
  // Handle Keypad animation and events ... 
  Keypad::loopSeek(100);
  Keypad::loop();

  // Detect Reset Button Hold to force provisioning mode
  if (isResetButtonHold()) {
    INFO_PRLN(F("Reset to provisioning mode detected."));
    
    Keypad::blinkConfirmation();

    last_state = WIFI_CONNECTED;
    next_state = PROVISIONING;      
    return;
  }
}

void init_wsocket_connected() {
  INFO_PRLN(F("\nSTATE: WSOCKET_CONNECTED"));

  Keypad::showCascade();

  INFO_PRINT(F("Registering: "));

  String handshake = F("{\"type\":\"hello\", \"gemId\":\"");
  handshake += cred_stored.gemID;
  handshake += F("\"}");
  INFO_PRLN(handshake);

  WebSocketConnection::websocket_client.sendTXT(handshake);
}

void do_wsocket_connected() {

  // Check if WIFI disconnected 
  if (WiFi.status() != WL_CONNECTED) {
    INFO_PRLN(F("Disconnected from WiFi."));

    WebSocketConnection::websocket_client.disconnect();
    // No methods to cleanly stop the server or mdnsResponder ...
    // No methods to cleanly stop HttpConfigServer ...

    Keypad::blinkError();

    last_state = WSOCKET_CONNECTED;
    next_state = WIFI_DISCONNECTED;
    return;
  }

  // Check if websocket disconnected
  WebSocketConnection::websocket_client.loop();
  if (!WebSocketConnection::websocket_client.isConnected()) {
    INFO_PRLN(F("Disconnected from rgempad backend."));

    WebSocketConnection::websocket_client.disconnect();
    // No methods to cleanly stop the server or mdnsResponder ...
    // No methods to cleanly stop HttpConfigServer ...

    Keypad::blinkError();

    last_state = WSOCKET_CONNECTED;
    next_state = WIFI_CONNECTED;
    return;
  }

  // Handle key presses ...
  Keypad::loop();

  // Respond to mDNS requests ... 
  Networking::mdns.run();
  
  // Serve config page
  if (WiFiClient client = HttpConfigServer::server.available()) {
    HttpConfigServer::app.process(&client);
    client.stop();
  }  

  // Detect configuration change
  if (!memcmp(cred_stored.gemID, HttpConfigServer::gemID, sizeof(cred_stored.gemID)) == 0) {
    INFO_PRLN(F("Credentials changed. Updating stored credentials and refreshing rgem connection."));
    strncpy(cred_stored.gemID, HttpConfigServer::gemID, sizeof(cred_stored.gemID)-1);
    gem_credentials.write(cred_stored);

    init_wsocket_connected();
    return;
  }
} 
