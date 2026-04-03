#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ========== ΡΥΘΜΙΣΕΙΣ ==========
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* wsHost   = "magnets.karnagio.org";
const int   wsPort   = 443;
// ================================

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

void setup() {
  Serial.begin(9600);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  webSocket.beginSSL(wsHost, wsPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
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
