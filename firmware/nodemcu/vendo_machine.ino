/*
  JuanFi Vendo Machine Firmware for NodeMCU ESP8266
  
  Hardware:
  - NodeMCU ESP8266 (ESP-12E)
  - Pulse coin acceptor (CH-926 or similar) - signal pin to D5 (GPIO14)
  - Optional: 0.96" I2C OLED (SSD1306) on SDA=D2, SCL=D1
  
  Arduino IDE Setup:
  - Board: NodeMCU 1.0 (ESP-12E Module)
  - Upload Speed: 115200
  - Flash Size: 4MB (FS:2MB OTA:~1019KB)
  
  Required Libraries (install via Library Manager):
  - ESP8266WiFi (built-in)
  - ESP8266WebServer (built-in)
  - ArduinoJson by Benoit Blanchon (v6.x)
  - LittleFS (built-in)
  - Wire (built-in, for OLED)
  - Adafruit_SSD1306 (optional, for OLED display)
  - Adafruit_GFX (optional, for OLED display)
*/

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

// ============================================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================================

// WiFi Settings
const char* WIFI_SSID = "JuanFi_Vendo";
const char* WIFI_PASSWORD = "vendo12345";

// Static IP for this vendo machine (must match config.js vendoIp)
IPAddress STATIC_IP(10, 1, 0, 41);
IPAddress GATEWAY(10, 1, 0, 1);
IPAddress SUBNET(255, 255, 255, 0);
IPAddress DNS(8, 8, 8, 8);

// MikroTik Router Settings (for creating hotspot users)
const char* MIKROTIK_HOST = "10.1.0.1";
const uint16_t MIKROTIK_PORT = 8728;
const char* MIKROTIK_USER = "admin";
const char* MIKROTIK_PASS = "";

// Hotspot settings
const char* HOTSPOT_PROFILE = "default";

// Coin Acceptor Settings
const uint8_t COIN_PULSE_PIN = 14;  // D5 = GPIO14
const uint8_t PULSES_PER_PESO = 1;  // How many pulses = 1 peso
const uint32_t COIN_TIMEOUT_MS = 500;  // Timeout to finalize coin count

// Session timeout (ms) - how long user has to insert coins
const uint32_t COIN_SLOT_TIMEOUT = 60000;  // 60 seconds

// Vendo name (shown in multi-vendo dropdown)
const char* VENDO_NAME = "JuanFi Vendo 1";

// Enable features
const bool CHARGING_ENABLED = false;
const bool ELOAD_ENABLED = false;

// ============================================================
// RATES CONFIGURATION
// Format: {price_pesos, validity_minutes, data_mb (0=unlimited)}
// ============================================================

struct Rate {
  int price;
  int validityMinutes;
  int dataMB;  // 0 = unlimited
};

// Internet rates (rateType=1)
Rate internetRates[] = {
  {1, 30, 0},     // 1 peso = 30 min unlimited
  {5, 180, 0},    // 5 pesos = 3 hours unlimited
  {10, 480, 0},   // 10 pesos = 8 hours unlimited
  {20, 1440, 0},  // 20 pesos = 24 hours unlimited
  {50, 4320, 0},  // 50 pesos = 3 days unlimited
};
const int NUM_INTERNET_RATES = sizeof(internetRates) / sizeof(internetRates[0]);

// Charging rates (rateType=2) - if charging enabled
Rate chargingRates[] = {
  {5, 180, 0},    // 5 pesos = 3 hours charging
  {10, 480, 0},   // 10 pesos = 8 hours charging
};
const int NUM_CHARGING_RATES = sizeof(chargingRates) / sizeof(chargingRates[0]);

// ============================================================
// GLOBAL STATE
// ============================================================

ESP8266WebServer server(80);

// Coin acceptor state
volatile uint32_t coinPulseCount = 0;
volatile uint32_t lastPulseTime = 0;
uint32_t sessionCoins = 0;
bool coinReading = false;

// Session state
struct Session {
  bool active;
  String voucher;
  String mac;
  String ipAddress;
  bool extendTime;
  String topupType;  // INTERNET, CHARGER, ELOAD
  int chargerPort;
  uint32_t startTime;
  uint32_t totalCoins;
  bool coinsInserted;
};

Session currentSession = {false, "", "", "", false, "INTERNET", -1, 0, 0, false};

// Voucher generation
const char VOUCHER_CHARS[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const int VOUCHER_LENGTH = 8;

// ============================================================
// INTERRUPT HANDLER - Coin Acceptor
// ============================================================

void ICACHE_RAM_ATTR coinPulseISR() {
  uint32_t now = millis();
  if (now - lastPulseTime > 50) {  // Debounce 50ms
    coinPulseCount++;
    lastPulseTime = now;
  }
}

// ============================================================
// MIKROTIK API CLIENT
// ============================================================

class MikroTikAPI {
public:
  bool connect() {
    if (client.connected()) client.stop();
    if (!client.connect(MIKROTIK_HOST, MIKROTIK_PORT)) {
      Serial.println("[MT] Connection failed");
      return false;
    }
    client.setTimeout(10000);
    return true;
  }

  void disconnect() {
    if (client.connected()) client.stop();
  }

  bool login() {
    if (!connect()) return false;
    
    sendSentence("/login");
    sendSentence("=name=" + String(MIKROTIK_USER));
    sendSentence("=password=" + String(MIKROTIK_PASS));
    
    String response = readResponse();
    Serial.println("[MT] Login response: " + response);
    return response.indexOf("!done") >= 0 && response.indexOf("!trap") < 0;
  }

  bool addHotspotUser(const String& username, const String& profile, int validityMinutes, int dataMB) {
    if (!login()) return false;
    
    sendSentence("/ip/hotspot/user/add");
    sendSentence("=name=" + username);
    sendSentence("=password=" + username);
    sendSentence("=profile=" + profile);
    
    if (dataMB > 0) {
      uint32_t bytes = (uint32_t)dataMB * 1024 * 1024;
      sendSentence("=limit-bytes-out=" + String(bytes));
      sendSentence("=limit-bytes-in=" + String(bytes));
    }
    
    if (validityMinutes > 0) {
      // RouterOS uses seconds for uptime/timeout
      uint32_t seconds = (uint32_t)validityMinutes * 60;
      sendSentence("=uptime=" + formatUptime(seconds));
    }
    
    String response = readResponse();
    Serial.println("[MT] Add user response: " + response);
    
    disconnect();
    return response.indexOf("!done") >= 0 && response.indexOf("!trap") < 0;
  }

private:
  WiFiClient client;
  
  void sendSentence(const String& sentence) {
    uint8_t len = sentence.length();
    if (len < 0x80) {
      client.write(len);
    } else if (len < 0x4000) {
      len |= 0x8000;
      client.write((len >> 8) & 0xff);
      client.write(len & 0xff);
    }
    client.print(sentence);
  }
  
  String readResponse() {
    String response = "";
    uint32_t timeout = millis() + 5000;
    
    while (millis() < timeout) {
      if (client.available()) {
        int len = readApiLength();
        if (len == 0) break;  // End of reply (zero-length word)
        
        char buf[512];
        int read = 0;
        while (read < len && client.available()) {
          buf[read++] = client.read();
        }
        buf[read] = '\0';
        response += buf;
        response += "\n";
      }
      delay(1);
    }
    return response;
  }
  
  int readApiLength() {
    if (!client.available()) return 0;
    uint8_t first = client.read();
    if (first < 0x80) return first;
    if (first < 0xC0) {
      uint8_t second = client.read();
      return ((first & 0x3F) << 8) | second;
    }
    return 0;
  }
  
  String formatUptime(uint32_t seconds) {
    uint32_t d = seconds / 86400;
    uint32_t h = (seconds % 86400) / 3600;
    uint32_t m = (seconds % 3600) / 60;
    uint32_t s = seconds % 60;
    
    String result = "";
    if (d > 0) result += String(d) + "d";
    if (h > 0) result += String(h) + "h";
    if (m > 0) result += String(m) + "m";
    if (s > 0 || result == "") result += String(s) + "s";
    return result;
  }
};

MikroTikAPI mtAPI;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

String generateVoucher() {
  String voucher = "";
  for (int i = 0; i < VOUCHER_LENGTH; i++) {
    voucher += VOUCHER_CHARS[random(0, sizeof(VOUCHER_CHARS) - 1)];
  }
  return voucher;
}

Rate findRate(int pesos) {
  // Find the best rate for the given peso amount
  Rate best = {0, 0, 0};
  for (int i = 0; i < NUM_INTERNET_RATES; i++) {
    if (pesos >= internetRates[i].price && internetRates[i].price > best.price) {
      best = internetRates[i];
    }
  }
  return best;
}

String getMacDataPath(const String& mac) {
  String macClean = mac;
  macClean.replace(":", "");
  return "/data/" + macClean + ".txt";
}

bool saveMacData(const String& mac, const String& voucher, uint32_t validityMinutes) {
  String path = getMacDataPath(mac);
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  
  // Format: voucher#validity_timestamp
  uint32_t validityTimestamp = 0;
  if (validityMinutes > 0) {
    time_t now = time(nullptr);
    validityTimestamp = now + (validityMinutes * 60);
  }
  
  String content = voucher + "#" + String(validityTimestamp);
  f.print(content);
  f.close();
  Serial.println("[FS] Saved MAC data: " + path + " -> " + content);
  return true;
}

String loadMacData(const String& mac) {
  String path = getMacDataPath(mac);
  File f = LittleFS.open(path, "r");
  if (!f) return "";
  String content = f.readString();
  f.close();
  return content;
}

// ============================================================
// HTTP HANDLERS
// ============================================================

void handleTopUp() {
  Serial.println("[API] /topUp called");
  
  if (currentSession.active) {
    DynamicJsonDocument doc(256);
    doc["status"] = "false";
    doc["errorCode"] = "coinslot.busy";
    String resp;
    serializeJson(doc, resp);
    server.send(200, "application/json", resp);
    return;
  }
  
  String voucher = server.arg("voucher");
  String mac = server.arg("mac");
  String ipAddress = server.arg("ipAddress");
  String extendTime = server.arg("extendTime");
  String topupType = server.arg("topupType");
  String chargerPort = server.arg("chargerPort");
  
  if (topupType == "") topupType = "INTERNET";
  
  // Generate new voucher if empty
  if (voucher == "") {
    voucher = generateVoucher();
  }
  
  // Start session
  currentSession.active = true;
  currentSession.voucher = voucher;
  currentSession.mac = mac;
  currentSession.ipAddress = ipAddress;
  currentSession.extendTime = (extendTime == "1");
  currentSession.topupType = topupType;
  currentSession.chargerPort = chargerPort.toInt();
  currentSession.startTime = millis();
  currentSession.totalCoins = 0;
  currentSession.coinsInserted = false;
  
  // Reset coin counter
  coinPulseCount = 0;
  coinReading = true;
  
  Serial.println("[API] Session started, voucher=" + voucher + " mac=" + mac);
  
  DynamicJsonDocument doc(256);
  doc["status"] = "true";
  doc["voucher"] = voucher;
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json", resp);
}

void handleCheckCoin() {
  String voucher = server.arg("voucher");
  
  if (!currentSession.active || currentSession.voucher != voucher) {
    DynamicJsonDocument doc(256);
    doc["status"] = "false";
    doc["errorCode"] = "coin.not.inserted";
    String resp;
    serializeJson(doc, resp);
    server.send(200, "application/json", resp);
    return;
  }
  
  // Check for timeout
  uint32_t elapsed = millis() - currentSession.startTime;
  if (elapsed > COIN_SLOT_TIMEOUT && currentSession.totalCoins == 0) {
    coinReading = false;
    currentSession.active = false;
    
    DynamicJsonDocument doc(256);
    doc["status"] = "false";
    doc["errorCode"] = "coins.wait.expired";
    doc["totalCoin"] = "0";
    doc["remainTime"] = "0";
    doc["waitTime"] = String(COIN_SLOT_TIMEOUT);
    String resp;
    serializeJson(doc, resp);
    server.send(200, "application/json", resp);
    return;
  }
  
  // Check if new coins were inserted (with debounce timeout)
  uint32_t currentPulses = coinPulseCount;
  uint32_t pesos = currentPulses / PULSES_PER_PESO;
  
  if (currentPulses > 0 && (millis() - lastPulseTime > COIN_TIMEOUT_MS)) {
    // Coins settled
    uint32_t newCoins = pesos - currentSession.totalCoins;
    if (newCoins > 0) {
      currentSession.totalCoins = pesos;
      currentSession.coinsInserted = true;
      Serial.println("[COIN] Total: " + String(pesos) + " pesos");
    }
  }
  
  // Calculate remaining time
  uint32_t remainTime = 0;
  if (currentSession.totalCoins == 0) {
    remainTime = COIN_SLOT_TIMEOUT - elapsed;
  }
  
  // Find rate for current coins
  Rate rate = findRate(currentSession.totalCoins);
  uint32_t timeAdded = rate.validityMinutes * 60;  // seconds
  int dataMB = rate.dataMB;
  uint32_t validityMinutes = rate.validityMinutes;
  
  DynamicJsonDocument doc(512);
  
  if (currentSession.totalCoins > 0) {
    doc["status"] = "true";
    doc["totalCoin"] = String(currentSession.totalCoins);
    doc["timeAdded"] = String(timeAdded);
    doc["data"] = dataMB > 0 ? String(dataMB) : "";
    doc["validity"] = String(validityMinutes);
    doc["newCoin"] = String(currentSession.totalCoins);
    doc["remainTime"] = "0";
    doc["waitTime"] = String(COIN_SLOT_TIMEOUT);
  } else {
    doc["status"] = "false";
    doc["errorCode"] = "coin.not.inserted";
    doc["totalCoin"] = "0";
    doc["timeAdded"] = "0";
    doc["data"] = "";
    doc["validity"] = "0";
    doc["newCoin"] = "0";
    doc["remainTime"] = String(remainTime);
    doc["waitTime"] = String(COIN_SLOT_TIMEOUT);
  }
  
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json", resp);
}

void handleUseVoucher() {
  String voucher = server.arg("voucher");
  Serial.println("[API] /useVoucher called, voucher=" + voucher);
  
  if (!currentSession.active || currentSession.voucher != voucher) {
    DynamicJsonDocument doc(256);
    doc["status"] = "false";
    doc["errorCode"] = "coin.not.inserted";
    String resp;
    serializeJson(doc, resp);
    server.send(200, "application/json", resp);
    return;
  }
  
  coinReading = false;
  
  if (currentSession.totalCoins == 0) {
    currentSession.active = false;
    DynamicJsonDocument doc(256);
    doc["status"] = "false";
    doc["errorCode"] = "coin.not.inserted";
    String resp;
    serializeJson(doc, resp);
    server.send(200, "application/json", resp);
    return;
  }
  
  // Find rate for the coins
  Rate rate = findRate(currentSession.totalCoins);
  
  // Create hotspot user on MikroTik
  bool success = false;
  if (currentSession.topupType == "INTERNET") {
    success = mtAPI.addHotspotUser(
      voucher,
      HOTSPOT_PROFILE,
      rate.validityMinutes,
      rate.dataMB
    );
  } else {
    // For charging or other types, just mark as success
    success = true;
  }
  
  if (success) {
    // Save MAC data for auto-login
    if (currentSession.mac != "") {
      saveMacData(currentSession.mac, voucher, rate.validityMinutes);
    }
  }
  
  currentSession.active = false;
  
  DynamicJsonDocument doc(256);
  doc["status"] = success ? "true" : "false";
  doc["validity"] = String(rate.validityMinutes);
  if (!success) {
    doc["errorCode"] = "no.internet.detected";
  }
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json", resp);
}

void handleCancelTopUp() {
  String voucher = server.arg("voucher");
  Serial.println("[API] /cancelTopUp called");
  
  if (currentSession.active && currentSession.voucher == voucher) {
    currentSession.active = false;
    coinReading = false;
  }
  
  DynamicJsonDocument doc(256);
  doc["status"] = "true";
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json", resp);
}

void handleGetRates() {
  String rateType = server.arg("rateType");
  Serial.println("[API] /getRates called, type=" + rateType);
  
  String response = "";
  
  if (rateType == "2" && CHARGING_ENABLED) {
    for (int i = 0; i < NUM_CHARGING_RATES; i++) {
      if (i > 0) response += "|";
      response += String(chargingRates[i].price);
      response += "#";
      response += String(chargingRates[i].price);
      response += "#0#";
      response += String(chargingRates[i].validityMinutes);
      response += "#";
      if (chargingRates[i].dataMB > 0) {
        response += String(chargingRates[i].dataMB);
      }
    }
  } else {
    for (int i = 0; i < NUM_INTERNET_RATES; i++) {
      if (i > 0) response += "|";
      response += String(internetRates[i].price);
      response += "#";
      response += String(internetRates[i].price);
      response += "#0#";
      response += String(internetRates[i].validityMinutes);
      response += "#";
      if (internetRates[i].dataMB > 0) {
        response += String(internetRates[i].dataMB);
      }
    }
  }
  
  server.send(200, "text/plain", response);
}

void handleGetChargingStation() {
  Serial.println("[API] /getChargingStation called");
  
  if (!CHARGING_ENABLED) {
    server.send(200, "text/plain", "");
    return;
  }
  
  // Format: name#pinSetting#col2#targetTimestamp|...
  // pinSetting = -1 means hidden
  String response = "Charging Port 1#-1#0#0|Charging Port 2#-1#0#0";
  server.send(200, "text/plain", response);
}

void handleConvertVoucher() {
  String voucher = server.arg("voucher");
  String convertVoucher = server.arg("convertVoucher");
  Serial.println("[API] /convertVoucher called");
  
  DynamicJsonDocument doc(256);
  doc["status"] = "false";
  doc["errorCode"] = "convertVoucher.invalid";
  String resp;
  serializeJson(doc, resp);
  server.send(200, "application/json", resp);
}

void handleMacData() {
  String uri = server.uri();
  // URI format: /data/<mac>.txt
  String macFile = uri.substring(6);  // Remove "/data/"
  String mac = macFile.substring(0, macFile.indexOf('.'));
  
  // Add colons back to MAC
  String macFormatted = "";
  for (int i = 0; i < mac.length(); i += 2) {
    if (i > 0) macFormatted += ":";
    macFormatted += mac.substring(i, i + 2);
  }
  macFormatted.toUpperCase();
  
  String data = loadMacData(macFormatted);
  if (data == "") {
    // Try without colons
    data = loadMacData(mac);
  }
  
  if (data != "") {
    server.send(200, "text/plain", data);
  } else {
    server.send(404, "text/plain", "Not found");
  }
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

void handleRoot() {
  String html = "<html><body>";
  html += "<h2>JuanFi Vendo Machine</h2>";
  html += "<p>Name: " + String(VENDO_NAME) + "</p>";
  html += "<p>IP: " + WiFi.localIP().toString() + "</p>";
  html += "<p>Session Active: " + String(currentSession.active ? "Yes" : "No") + "</p>";
  html += "<p>Coins This Session: " + String(currentSession.totalCoins) + "</p>";
  html += "<p>Uptime: " + String(millis() / 1000) + "s</p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(100);
  
  Serial.println();
  Serial.println("=================================");
  Serial.println("JuanFi Vendo Machine Starting...");
  Serial.println("=================================");
  
  // Initialize LittleFS
  if (!LittleFS.begin()) {
    Serial.println("[FS] LittleFS mount failed, formatting...");
    LittleFS.format();
    LittleFS.begin();
  }
  
  // Create data directory if not exists
  if (!LittleFS.exists("/data")) {
    LittleFS.mkdir("/data");
  }
  
  // Setup coin acceptor pin
  pinMode(COIN_PULSE_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(COIN_PULSE_PIN), coinPulseISR, FALLING);
  
  // Connect to WiFi
  Serial.println("[WiFi] Connecting to " + String(WIFI_SSID));
  WiFi.mode(WIFI_STA);
  WiFi.config(STATIC_IP, GATEWAY, SUBNET, DNS);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  uint32_t wifiTimeout = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < wifiTimeout) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("[WiFi] Connected!");
    Serial.println("[WiFi] IP: " + WiFi.localIP().toString());
  } else {
    Serial.println();
    Serial.println("[WiFi] Connection failed, using AP mode");
    WiFi.mode(WIFI_AP);
    WiFi.softAP("JuanFi_Vendo_AP", "12345678");
    WiFi.softAPConfig(STATIC_IP, STATIC_IP, SUBNET);
    Serial.println("[WiFi] AP IP: " + WiFi.softAPIP().toString());
  }
  
  // Setup HTTP server routes
  server.on("/", handleRoot);
  server.on("/topUp", HTTP_POST, handleTopUp);
  server.on("/checkCoin", HTTP_POST, handleCheckCoin);
  server.on("/useVoucher", HTTP_POST, handleUseVoucher);
  server.on("/cancelTopUp", HTTP_POST, handleCancelTopUp);
  server.on("/getRates", HTTP_GET, handleGetRates);
  server.on("/getChargingStation", HTTP_GET, handleGetChargingStation);
  server.on("/convertVoucher", HTTP_POST, handleConvertVoucher);
  server.onNotFound([]() {
    String uri = server.uri();
    if (uri.startsWith("/data/") && uri.endsWith(".txt")) {
      handleMacData();
    } else {
      handleNotFound();
    }
  });
  
  // Enable CORS
  server.enableCORS(true);
  
  server.begin();
  Serial.println("[HTTP] Server started on port 80");
  
  // Seed random for voucher generation
  randomSeed(analogRead(0) ^ millis());
  
  Serial.println("=================================");
  Serial.println("Vendo Machine Ready!");
  Serial.println("Vendo IP: " + STATIC_IP.toString());
  Serial.println("MikroTik: " + String(MIKROTIK_HOST));
  Serial.println("=================================");
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  server.handleClient();
  
  // Check for session timeout
  if (currentSession.active) {
    uint32_t elapsed = millis() - currentSession.startTime;
    if (elapsed > COIN_SLOT_TIMEOUT + 5000) {
      // Auto-cancel session after timeout + grace period
      Serial.println("[SESSION] Auto-cancelling timed out session");
      currentSession.active = false;
      coinReading = false;
    }
  }
  
  delay(1);
}
