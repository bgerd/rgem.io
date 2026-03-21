// winc1500 lib
// NOTE: WiFi101_Generic MUST be patched to make startProvision() a public function
#include <WiFi101_Generic.h>

// UDP lib (for MDNS)
#include <WiFiUdp.h>
#include <MDNS.h> 

// feather m0 wifi specific pin mappings
#define WIFI_CS   8
#define WIFI_IRQ  7
#define WIFI_RST  4
#define WIFI_EN   2

namespace Networking {
  
  WiFiUDP udp;  // Needed for MDNS
  MDNS mdns(udp);

  uint8_t macAddress[6];
  char macAddrString[13]; // 12 hex chars + null

  // TODO: Review and clean-up all using of String objects for concatenation ...
  String device_id;
  const char* device_model = RGEMPAD_CORE_MODEL;
  char* firmware_version;

  // Only needs to be done once ...
  void init() {
    
    WiFi.setPins(WIFI_CS, WIFI_IRQ, WIFI_RST, WIFI_EN);

    // Important. Forces the initialization of the winc1500 firmware! 
    WiFi.init();

    const char* fwVersion = WiFi.firmwareVersion();
    if(fwVersion != NULL) {
      size_t len = strlen(fwVersion) + 1;
      if(firmware_version != NULL) {
        free(firmware_version);
      }
      firmware_version = (char*)malloc(len);
      strcpy(firmware_version, fwVersion); 
    } else {
      ERROR_PRLN(F("ERROR: Could not get winc1500 firmware version"));
    }

    // TODO: Look into setting winc1500 client name as evident in ssid's DHCP client list
    INFO_PRINT(F("winc1500 firmware version: "));
    INFO_PRLN(Networking::firmware_version);

    // Requires winc1500 firmware to be initialized!! 
    WiFi.macAddress(macAddress);

    // init mac address string
    snprintf(macAddrString, sizeof(macAddrString), "%02x%02x%02x%02x%02x%02x",
              macAddress[5], macAddress[4], macAddress[3], macAddress[2], macAddress[1], macAddress[0]);

    INFO_PRINT(F("MAC address: "));
    INFO_PRLN(macAddrString);

    // Init device ID
    // TODO: Review and clean-up all using of String objects for concatenation ...
    char suffix[8];  // '-' + 6 hex chars + null
    snprintf(suffix, sizeof(suffix), "-%02x%02x%02x",
            macAddress[2], macAddress[1], macAddress[0]);
    device_id = String(RGEMPAD_CORE_MODEL) + suffix;

    INFO_PRINT(F("device_id: "));
    INFO_PRLN(Networking::device_id);
  }

  // Start mDNS responder service after WiFI.begin() or WiFi.beginAP() ...
  bool advertiseService(const IPAddress& ip) {

    if(mdns.begin(ip, Networking::device_id.c_str())){
      INFO_PRLN(F("mDNS responder started"));

      // Register webserver service
      mdns.addServiceRecord((device_id + " Webserver._http").c_str(), 80, MDNSServiceTCP);

      // TODO: Look into registering service records (e.g. TXT records) for discovery
      // see: https://github.com/arduino-libraries/ArduinoMDNS/blob/master/examples/WiFi/WiFiRegisteringServicesWithTxtRecord/WiFiRegisteringServicesWithTxtRecord.ino
      return true;
    }
    ERROR_PRLN(F("mDNS responder failed!!"));
    return false;
  }

}