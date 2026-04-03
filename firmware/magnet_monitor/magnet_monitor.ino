#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ========== ΡΥΘΜΙΣΕΙΣ — συμπλήρωσε πριν το φλάσαρισμα ==========
const char* wsHost = "YOUR_DOMAIN";   // π.χ. example.com
const int   wsPort = 443;

struct WiFiNetwork { const char* ssid; const char* password; };
WiFiNetwork networks[] = {
  { "YOUR_WIFI_SSID_1",  "YOUR_WIFI_PASSWORD_1" },
  { "YOUR_WIFI_SSID_2",  "YOUR_WIFI_PASSWORD_2" }
};
const int networkCount = sizeof(networks) / sizeof(networks[0]);
// =================================================================

WebSocketsClient webSocket;
String serialBuffer = "";
bool wsConnected = false;

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      wsConnected = true;
      String hello = "{\"type\":\"esp_hello\",\"mac\":\"" + WiFi.macAddress() + "\"}";
      webSocket.sendTXT(hello);
      break;
    }
    case WStype_DISCONNECTED: {
      wsConnected = false;
      break;
    }
    case WStype_TEXT: {
      StaticJsonDocument<128> doc;
      deserializeJson(doc, payload, length);
      if (doc["type"] == "command") {
        String cmd = doc["cmd"].as<String>();
        Serial.print(cmd);
      }
      break;
    }
  }
}

void connectWiFi() {
  WiFi.disconnect();
  while (true) {
    for (int i = 0; i < networkCount; i++) {
      WiFi.begin(networks[i].ssid, networks[i].password);
      for (int t = 0; t < 20; t++) {   // 10s per network
        if (WiFi.status() == WL_CONNECTED) return;
        delay(500);
      }
      WiFi.disconnect();
      delay(500);
    }
  }
}

void setup() {
  Serial.begin(9600);
  WiFi.mode(WIFI_STA);
  connectWiFi();
  webSocket.beginSSL(wsHost, wsPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(25000, 5000, 2);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    wsConnected = false;
    connectWiFi();
  }
  webSocket.loop();

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (serialBuffer.length() > 0 && wsConnected) {
        String json = "{\"type\":\"serial_data\",\"mac\":\"" + WiFi.macAddress() + "\",\"data\":\"" + serialBuffer + "\"}";
        webSocket.sendTXT(json);
        serialBuffer = "";
      }
    } else if (c != '\r') {
      serialBuffer += c;
    }
  }
}
