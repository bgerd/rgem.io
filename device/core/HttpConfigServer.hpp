// Arduino web server library
#include <aWOT.h>

// Configure http server
namespace HttpConfigServer {

  const uint16_t port = 80;
  WiFiServer server(port);
  Application app;

  char gemID[32];

  // NOTE: Escapes &, <, >, " to prevent stored XSS when rendering
  // user-supplied gemID into HTML attributes and body content.
  void printHtmlEscaped(Response &res, const char* str) {
    while (*str) {
      switch (*str) {
        case '&':  res.print(F("&amp;"));  break;
        case '<':  res.print(F("&lt;"));   break;
        case '>':  res.print(F("&gt;"));   break;
        case '"':  res.print(F("&quot;")); break;
        default:   res.write(*str);        break;
      }
      str++;
    }
  }

  void handleGetConfig(Request &req, Response &res) {

    // Serve a minimal, mobile-friendly HTML form
    res.set("Content-Type", "text/html");

    res.print(F(
      "<!DOCTYPE html>"
      "<html>"
      "<head>"
        "<meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
        "<style>"
          "body { font-family: sans-serif; padding: 1em; }"
          "input, button { width: 100%; padding: 0.5em; margin: 0.5em 0; font-size: 1em; }"
          "label { font-weight: bold; display: block; margin-top: 1em; }"
        "</style>"
      "</head>"
      "<body>"
        "<div style='max-width:400px;margin:auto;'>"
        "<h2>RGEM Pad Config</h2>"
        "<form method='POST' action='/'>"
          "<p style='display: none;'>"
    ));
    res.print(Networking::macAddrString);
    res.print(F("</p><p style='display: none;'>"));
    res.print(Networking::device_id);
    res.print(F("</p><p style='display: none;'>"));
    res.print(F(RGEMPAD_CORE_VERSION));
    res.print(F("</p><p style='display: none;'></p>"));
    res.print(F(
          "<label for=\"gemID\">Gem ID:</label>"
          "<input id=\"gemID\" name=\"gemID\" type=\"text\" value=\""
    ));
    printHtmlEscaped(res, gemID);
    res.print(F(
          "\" placeholder=\"GEM ID required\" required maxlength=\"31\" "
          "style='width:100%;box-sizing:border-box;'>"
          "<button type=\"submit\" style='width:100%;box-sizing:border-box;'>Connect</button>"

      "</form>"
      "</div>"      
      "</body>"
      "</html>"
    ));
  }
  
  void handlePostConfig(Request &req, Response &res) {

    // TODO: Look into why we cannot pass in F() PROGMEM strings
    res.set("Content-Type", "text/html");

    // NOTE: Our longest form key is "gemID" with 5 characters
    char key[10];
    char value[64];

    // see: https://github.com/lasselukkari/aWOT/tree/master?tab=readme-ov-file#post-parameters
    while (req.left()) {
      req.form(key, 10, value, 64);
      switch (key[0]) {
        case 'g': // gemID
          DEBUG_PRINT(F("GEM ID: "));
          DEBUG_PRLN(value);
          strncpy(gemID, value, sizeof(gemID) - 1);
          gemID[sizeof(gemID) - 1] = '\0'; // Ensure null termination
          break;
        default:
          ERROR_PRINT(F("Unknown key: "));
          ERROR_PRLN(key);
      }
    }
    Keypad::blinkConfirmation();

    res.print(F(
      "<!DOCTYPE html>"
      "<html>"
      "<head>"
        "<meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
        "<title>Connecting...</title>"
        "<style>"
          "body { font-family: sans-serif; padding: 2em; text-align: center; }"
          ".spinner {"
            "margin: 2em auto;"
            "width: 48px;"
            "height: 48px;"
            "border: 6px solid #eee;"
            "border-top: 6px solid #2196f3;"
            "border-radius: 50%;"
            "animation: spin 1s linear infinite;"
            "display: inline-block;"
          "}"
          "@keyframes spin {"
            "0% { transform: rotate(0deg); }"
            "100% { transform: rotate(360deg); }"
          "}"
          ".msg { font-size: 1.2em; margin-top: 1em; }"
        "</style>"
        "<script>"
          "setTimeout(function() { window.location.href = '/'; }, 2500);"
        "</script>"
      "</head>"
      "<body>"
        "<div class='spinner'></div>"
        "<div class='msg'>Connecting to Gem ID: <b>"
    ));
    printHtmlEscaped(res, gemID);
    res.print(F(
        "</b></div>"
      "</body>"
      "</html>"
    ));
  }

  void init() {
    app.get("/", &handleGetConfig);
    app.post("/", &handlePostConfig);
  }
}
