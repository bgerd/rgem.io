#include <ArduinoJson.h>

// winc1500-specific header
#include <driver/source/nmasic.h>

// NETWORK_WIFI101 and _WEBSOCKETS_LOGLEVEL_ needs to be defined before including WebSocketsClient_Generic.h
#define WEBSOCKETS_NETWORK_TYPE   NETWORK_WIFI101
// #define _WEBSOCKETS_LOGLEVEL_     3
#include <WebSocketsClient_Generic.h>

// Configure WebSocket client

// TODO: Relocate this variables to global config file
// TODO: Revisit WEBSOCKET_URL. What is it for? 

#warning SSL Certificates for WEBSOCKET_HOST MUST be pre-loaded onto winc1500 firmware
#define WEBSOCKET_HOST "ws-stage.rgem.io"
#define WEBSOCKET_PORT 443
#define WEBSOCKET_URL "/"
// Note that WebSocketsClient_Generic effectively blocks when trying to connect
// WEBSOCKET_RECONNECT_INTERVAL_MS consequently determines duration of WAIT_FOR_WEBSOCKET 
// animations sequence.  Lib default is 0.5s (500), should be greater than 5s (5000)
const unsigned long WEBSOCKET_RECONNECT_INTERVAL_MS = 10000; 

using ReceiveMsgCallback = void (*)(const char*);

namespace WebSocketConnection {

  ReceiveMsgCallback do_receive_msg_callback = nullptr;
  WebSocketsClient websocket_client;

  void onWebSocketEvent(const WStype_t& type, uint8_t * payload, const size_t& length) {
    switch (type) {
      case WStype_DISCONNECTED:
        INFO_PRLN(F("[WSc] Disconnected!"));
        break;

      case WStype_CONNECTED:
        INFO_PRINT(F("[WSc] Connected to url: "));
        INFO_PRLN((char *) payload);
        break;

      case WStype_TEXT: 
        {
          INFO_PRINT(F("[WSc] get text: "));
          INFO_PRLN((char *) payload);
          
          do_receive_msg_callback((char *)payload);
        } 
        break;

      case WStype_BIN:
        INFO_PRINT(F("[WSc] get binary length: "));
        INFO_PRLN(length);
        break;

      case WStype_PING:
        // pong will be send automatically
        INFO_PRLN("[WSc] get ping");
        break;

      case WStype_PONG:
        // answer to a ping we send
        // INFO_PRLN("[WSc] get pong");
        break;

      default:
        break;
    }
  }

  void init(ReceiveMsgCallback doReceiveMsgCallback) {

    do_receive_msg_callback = doReceiveMsgCallback;

    // Note. Connecting and reconnecting a websocket client is effectively 
    //       an async blocking operation ... 
    websocket_client.setReconnectInterval(WEBSOCKET_RECONNECT_INTERVAL_MS);

    // Configure heartbeat
    // ping server every 5000 ms 
    // expect pong from server within 1000 ms 
    // consider connection disconnected if pong is not received 2 times 
    // TODO: Evaluate parameters of websocket hearbeat wrt battery vs responsiveness 
    websocket_client.enableHeartbeat(5000, 1000, 2); 
    websocket_client.onEvent(onWebSocketEvent);
  }
}