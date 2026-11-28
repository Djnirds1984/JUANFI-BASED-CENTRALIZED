/*
 * AirCoins sub-vendo - firmware core for ESP8266 (NodeMCU).
 *
 * Everything lives in this header so the sketch has a single translation unit:
 * the Arduino IDE's prototype generator would otherwise try to parse the HTML
 * and JavaScript of the pairing portal and fail.
 *
 * The board is a coin slot and nothing else: no display, no admin page, no
 * listening port. It sells HOTSPOT time - the box a customer walks up to and
 * feeds so their own phone gets online. It is not a pisonet seat timer; that is
 * a different firmware. Rates, pricing and the device that gets the time live
 * in the panel. Its only HTTP server is the Aircoins_setup pairing portal, and
 * only while the machine has no device key.
 *
 * Requires ArduinoJson (v6.21.5 or newer in the 6.x line).
 */

#ifndef AIRCOINS_CORE_H
#define AIRCOINS_CORE_H

#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <Ticker.h>

// ======================= config_store.h =======================

/*
 * The only thing this board keeps for itself. Everything else - rates, coin
 * value, screen text - is fetched from the panel, because an AirCoins vendo has
 * no web UI to change it on.
 *
 * `provisioned` stays 0 until the panel accepts the pairing request and sends a
 * device key back. A board that never got one keeps showing the setup access
 * point, which is also how a factory reset behaves.
 */

struct StoredConfig {
  uint16_t magic;
  uint8_t version;
  uint8_t provisioned;
  char ssid[33];
  char pass[65];
  char panelHost[64];
  uint16_t panelPort;
  char deviceKey[33];
  char deviceName[33];
};

static const uint16_t CONFIG_MAGIC = 0x4143;  // "AC"
static const uint8_t CONFIG_VERSION = 1;

inline void configDefaults(StoredConfig &cfg) {
  memset(&cfg, 0, sizeof(cfg));
  cfg.magic = CONFIG_MAGIC;
  cfg.version = CONFIG_VERSION;
  cfg.provisioned = 0;
  cfg.panelPort = 3000;
  strncpy(cfg.deviceName, "AirCoins Vendo", sizeof(cfg.deviceName) - 1);
}

inline void configTerminate(StoredConfig &cfg) {
  cfg.ssid[sizeof(cfg.ssid) - 1] = '\0';
  cfg.pass[sizeof(cfg.pass) - 1] = '\0';
  cfg.panelHost[sizeof(cfg.panelHost) - 1] = '\0';
  cfg.deviceKey[sizeof(cfg.deviceKey) - 1] = '\0';
  cfg.deviceName[sizeof(cfg.deviceName) - 1] = '\0';
}

inline bool configLoad(StoredConfig &cfg) {
  EEPROM.begin(sizeof(StoredConfig));
  EEPROM.get(0, cfg);
  if (cfg.magic != CONFIG_MAGIC || cfg.version != CONFIG_VERSION) {
    configDefaults(cfg);
    EEPROM.put(0, cfg);
    EEPROM.commit();
    return false;
  }
  configTerminate(cfg);
  return true;
}

inline void configSave(StoredConfig &cfg) {
  EEPROM.begin(sizeof(StoredConfig));
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

// Forget the pairing but keep the WiFi details, so re-pairing does not make the
// installer type the shop password again.
inline void configForgetPairing(StoredConfig &cfg) {
  cfg.provisioned = 0;
  cfg.deviceKey[0] = '\0';
  configSave(cfg);
}

// ======================= panel_client.h =======================

/*
 * Every call the machine makes goes through here. The vendo never opens a port
 * and never listens: it asks the panel, the panel answers.
 */

struct PanelReply {
  bool ok = false;
  int code = 0;
  String body;
};

// The installer may type "10.0.0.252", "10.0.0.252:3000" or paste a full URL;
// the port has its own field, so the scheme and any path are dropped here.
inline String panelHostOf(const StoredConfig &cfg) {
  String host = String(cfg.panelHost);
  host.trim();
  if (host.startsWith("http://")) host = host.substring(7);
  if (host.startsWith("https://")) host = host.substring(8);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  int colon = host.indexOf(':');
  if (colon > 0) host = host.substring(0, colon);
  return host;
}

inline PanelReply panelCall(const StoredConfig &cfg, const char *method, const String &path,
                            const String &payload = "", unsigned long timeoutMs = 8000) {
  PanelReply reply;
  if (WiFi.status() != WL_CONNECTED) return reply;

  String url = "http://" + panelHostOf(cfg) + ":" + String(cfg.panelPort) + "/api/nodemcu" + path;

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(timeoutMs);
  http.setReuse(false);
  if (!http.begin(client, url)) return reply;

  http.addHeader("Content-Type", "application/json");
  int code = strcmp(method, "POST") == 0 ? http.POST(payload) : http.GET();

  reply.code = code;
  if (code > 0) {
    reply.body = http.getString();
    reply.ok = code >= 200 && code < 300;
  }
  http.end();
  return reply;
}

inline String macNoColon() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toUpperCase();
  return mac;
}

// ======================= setup_portal.h =======================

/*
 * First-boot setup.
 *
 * A board that has no device key yet comes up as `Aircoins_setup`. The installer
 * joins it and gives the shop WiFi a name - picked from the scan list, or typed
 * by hand when the network is hidden or not listed. The name is saved the
 * moment it is submitted, and the board joins it straight away; a join that has
 * not succeeded in ten seconds puts the access point back on air, so the name
 * can be corrected without a power cycle. Once the network is up the board asks
 * the panel to accept it and keeps the access point up, showing "waiting for
 * admin", until someone presses Accept on the AirCoins subpage. Only then does
 * it receive its device key and reboot into normal mode.
 *
 * This is the ONLY HTTP server in the firmware, and it only exists while the
 * machine is unpaired.
 */

static const char *SETUP_AP_SSID = "Aircoins_setup";
// How long a typed network name gets before the setup AP is put back on air.
// A shop router answers well inside this; a wrong name must not strand the
// installer on a portal that no longer answers.
static const uint32_t SETUP_JOIN_TIMEOUT_MS = 10000;

static String setupState = "idle";
static String setupDetail = "Pick the shop WiFi below.";

static ESP8266WebServer setupServer(80);
static DNSServer setupDns;
static bool setupDnsStarted = false;

static String setupPendingSsid;
static String setupPendingPass;
static String setupPendingHost;
static String setupPendingName;
static uint16_t setupPendingPort = 3000;
static bool setupJoinRequested = false;

static const char SETUP_PAGE[] PROGMEM = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AirCoins Setup</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#101418;color:#e9eef2}
header{padding:18px 16px;background:#0b2b3c;border-bottom:1px solid #1d3a4a}
h1{font-size:18px;margin:0}
p.sub{margin:4px 0 0;font-size:12px;color:#9fb3c0}
main{padding:16px;max-width:520px;margin:0 auto}
section{background:#161d23;border:1px solid #243039;border-radius:10px;padding:14px;margin-bottom:14px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8fb0c4;margin:0 0 10px}
input{width:100%;padding:10px;border-radius:8px;border:1px solid #2b3944;background:#0f1519;color:#e9eef2;font-size:15px;box-sizing:border-box}
label{display:block;font-size:12px;color:#9fb3c0;margin:8px 0 4px}
button{font:inherit}
.net{display:flex;justify-content:space-between;width:100%;text-align:left;padding:10px;margin:4px 0;border-radius:8px;border:1px solid #2b3944;background:#0f1519;color:#e9eef2}
.net.sel{border-color:#29b6f6;background:#0e2a36}
.net small{color:#8fb0c4}
.go{width:100%;padding:12px;border:0;border-radius:8px;background:#29b6f6;color:#04222e;font-weight:700;margin-top:12px}
#state{font-size:13px;color:#ffd166;margin-top:10px;min-height:18px}
.muted{font-size:12px;color:#8fb0c4}
</style></head>
<body>
<header><h1>AirCoins vendo setup</h1>
<p class="sub">Join the shop WiFi, then ask the panel to accept this machine.</p></header>
<main>
<section>
<h2>Shop WiFi</h2>
<div id="nets" class="muted">Scanning...</div>
<button type="button" class="net" onclick="scan()"><span>Rescan networks</span></button>
</section>
<section>
<form id="f" onsubmit="return join(event)">
<label>Network name</label><input id="ssid" name="ssid" autocomplete="off" placeholder="Type it or pick one above" required>
<div class="muted">Hidden network, or not in the list? Type the name exactly - it is saved as typed, no scan needed.</div>
<label>Password</label><input id="pass" name="pass" type="password" autocomplete="off">
<label>Panel address</label><input id="host" name="host" placeholder="10.0.0.252" required>
<label>Panel port</label><input id="port" name="port" type="number" value="3000" required>
<label>Vendo name</label><input id="name" name="name" placeholder="Vendo 2">
<button class="go" type="submit">Connect and request approval</button>
</form>
<div id="state"></div>
</section>
<section>
<h2>This machine</h2>
<div class="muted" id="mac">MAC: ...</div>
</section>
</main>
<script>
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
function pick(ssid){document.getElementById('ssid').value=ssid;document.querySelectorAll('.net').forEach(function(b){b.classList.toggle('sel',b.dataset.ssid===ssid);});}
async function scan(){
 var box=document.getElementById('nets');box.textContent='Scanning...';
 try{var r=await fetch('/scan');var d=await r.json();
  if(!d.networks.length){box.textContent='No networks found. Move closer to the router and rescan.';return;}
  box.innerHTML=d.networks.map(function(n){
   return '<button type="button" class="net" data-ssid="'+esc(n.ssid)+'" onclick="pick(this.dataset.ssid)"><span>'+esc(n.ssid)+'</span><small>'+(n.enc?'locked':'open')+' '+(n.rssi||0)+'dBm</small></button>';
  }).join('');
 }catch(e){box.textContent='Scan failed. Try again.';}
}
async function join(ev){
 ev.preventDefault();
 var fd=new FormData(document.getElementById('f'));
 var r=await fetch('/join',{method:'POST',body:new URLSearchParams(fd)});
 var d=await r.json();
 document.getElementById('state').textContent=d.ok?'Saved. Joining '+document.getElementById('ssid').value+' - if it fails in 10 s the setup network comes back here.':(d.error||'Could not save.');
 return false;
}
async function poll(){
 try{var r=await fetch('/status');var d=await r.json();
  document.getElementById('mac').textContent='MAC: '+(d.mac||'-');
  document.getElementById('state').textContent=d.detail||'';
 }catch(e){}
}
scan();poll();setInterval(poll,2000);
</script>
</body></html>)HTML";

inline void setupSendIndex() {
  setupServer.sendHeader("Cache-Control", "no-store");
  setupServer.send_P(200, "text/html", SETUP_PAGE);
}

inline void setupRedirectToPortal() {
  setupServer.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  setupServer.send(302, "text/plain", "");
}

inline void setupHandleScan() {
  int found = WiFi.scanNetworks(false, false);
  DynamicJsonDocument doc(2048);
  JsonArray networks = doc.createNestedArray("networks");
  for (int i = 0; i < found && i < 20; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    JsonObject entry = networks.createNestedObject();
    entry["ssid"] = ssid;
    entry["rssi"] = WiFi.RSSI(i);
    entry["enc"] = WiFi.encryptionType(i) != ENC_TYPE_NONE;
  }
  WiFi.scanDelete();
  String out;
  serializeJson(doc, out);
  setupServer.sendHeader("Cache-Control", "no-store");
  setupServer.send(200, "application/json", out);
}

inline void setupHandleJoin() {
  String ssid = setupServer.arg("ssid");
  String host = setupServer.arg("host");
  ssid.trim();
  host.trim();
  if (ssid.length() == 0 || host.length() == 0) {
    setupServer.send(400, "application/json", "{\"ok\":false,\"error\":\"Network name and panel address are required\"}");
    return;
  }
  // A typed name is stored exactly as typed, so it has to be one the radio can
  // carry: 32 bytes, and the password 64. Truncating silently would make the
  // board look for a network nobody asked for.
  if (ssid.length() > 32 || setupServer.arg("pass").length() > 64) {
    setupServer.send(400, "application/json", "{\"ok\":false,\"error\":\"Network name is at most 32 characters and the password at most 64\"}");
    return;
  }

  int port = setupServer.arg("port").toInt();
  setupPendingSsid = ssid;
  setupPendingPass = setupServer.arg("pass");
  setupPendingHost = host;
  setupPendingPort = (port > 0 && port < 65536) ? (uint16_t)port : 3000;
  setupPendingName = setupServer.arg("name");
  setupJoinRequested = true;

  setupState = "connecting";
  setupDetail = "Joining " + ssid + "...";
  setupServer.send(200, "application/json", "{\"ok\":true}");
}

inline void setupHandleStatus() {
  DynamicJsonDocument doc(512);
  doc["state"] = setupState;
  doc["detail"] = setupDetail;
  doc["mac"] = macNoColon();
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("");
  String out;
  serializeJson(doc, out);
  setupServer.sendHeader("Cache-Control", "no-store");
  setupServer.send(200, "application/json", out);
}

inline void setupRoutes() {
  setupServer.on("/", HTTP_GET, setupSendIndex);
  setupServer.on("/scan", HTTP_GET, setupHandleScan);
  setupServer.on("/join", HTTP_POST, setupHandleJoin);
  setupServer.on("/status", HTTP_GET, setupHandleStatus);

  // The probes phones use to decide whether they are behind a captive portal.
  // Answering them with the page turns the "no internet" warning into the
  // setup screen on both Android and iOS.
  const char *probes[] = {
    "/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
    "/connecttest.txt", "/ncsi.txt", "/canonical.html", "/success.txt", "/redirect",
  };
  for (size_t i = 0; i < sizeof(probes) / sizeof(probes[0]); i++) {
    setupServer.on(probes[i], HTTP_ANY, setupRedirectToPortal);
  }
  setupServer.onNotFound(setupRedirectToPortal);
}

/*
 * Puts the Aircoins_setup access point on air, and is called again whenever a
 * join attempt fails: re-asserting the AP makes the SSID broadcast again even
 * when the radio had moved to the shop's channel to look for it. The station
 * side is left idle, because a wrong name must not keep scanning in the
 * background while the installer re-reads the page.
 */
inline void startSetupAp() {
  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(SETUP_AP_SSID);
  WiFi.setAutoReconnect(false);  // setup tries on purpose, never in the background
  delay(200);
  if (!setupDnsStarted) {
    setupDns.start(53, "*", WiFi.softAPIP());
    setupDnsStarted = true;
  }
}

/*
 * Blocks until the panel approves this machine and a device key is stored.
 * The caller restarts the board afterwards.
 */
inline void runSetupPortal(StoredConfig &cfg) {
  WiFi.persistent(false);
  startSetupAp();

  setupRoutes();
  setupServer.begin();

  setupState = "waiting";
  setupDetail = "Pick the shop WiFi below.";

  enum Phase { WAIT_JOIN, WIFI_CONNECTING, CLAIMING, WAITING_ADMIN, FAILED };
  Phase phase = WAIT_JOIN;
  unsigned long phaseStarted = millis();
  unsigned long lastAttempt = 0;
  String claimToken;
  String lastDetail;

  for (;;) {
    setupDns.processNextRequest();
    setupServer.handleClient();

    // A fresh submission always wins over an attempt already in flight: the
    // installer re-typed the name, so drop the old try instead of waiting it out.
    if (setupJoinRequested && phase != WAIT_JOIN) {
      phase = WAIT_JOIN;
      phaseStarted = millis();
      claimToken = "";
      WiFi.disconnect(false, false);
    }

    if (phase == WAIT_JOIN && setupJoinRequested) {
      setupJoinRequested = false;

      // Keep the WiFi details even if pairing is refused: the installer should
      // never have to type the shop password twice.
      strncpy(cfg.ssid, setupPendingSsid.c_str(), sizeof(cfg.ssid) - 1);
      strncpy(cfg.pass, setupPendingPass.c_str(), sizeof(cfg.pass) - 1);
      strncpy(cfg.panelHost, setupPendingHost.c_str(), sizeof(cfg.panelHost) - 1);
      cfg.panelPort = setupPendingPort;
      if (setupPendingName.length() > 0) {
        strncpy(cfg.deviceName, setupPendingName.c_str(), sizeof(cfg.deviceName) - 1);
      }
      configTerminate(cfg);
      configSave(cfg);

      WiFi.begin(cfg.ssid, cfg.pass);
      phase = WIFI_CONNECTING;
      phaseStarted = millis();
    }

    if (phase == WIFI_CONNECTING) {
      if (WiFi.status() == WL_CONNECTED) {
        WiFi.setAutoReconnect(true);  // normal mode wants the reconnect loop back
        phase = CLAIMING;
        phaseStarted = millis();
        lastAttempt = 0;
        setupDetail = "WiFi joined. Asking the panel to accept this machine...";
      } else if (millis() - phaseStarted > SETUP_JOIN_TIMEOUT_MS) {
        setupState = "failed";
        setupDetail = String("Could not join ") + cfg.ssid +
          " in 10 s. Aircoins_setup is broadcasting again - retype the name (hidden networks are fine) or pick another one.";
        phase = FAILED;
        phaseStarted = millis();
        // The config stayed saved either way; only the radio goes back to setup.
        startSetupAp();
      }
    }

    if (phase == CLAIMING || phase == WAITING_ADMIN) {
      bool poll = phase == WAITING_ADMIN ? (millis() - lastAttempt > 3000) : true;
      if (poll && (lastAttempt == 0 || millis() - lastAttempt > (phase == CLAIMING ? 6000UL : 3000UL))) {
        lastAttempt = millis();

        if (claimToken.length() == 0) {
          DynamicJsonDocument request(384);
          request["mac"] = macNoColon();
          request["ip"] = WiFi.localIP().toString();
          request["name"] = cfg.deviceName;
          request["ssid"] = cfg.ssid;
          request["firmwareVersion"] = "1.0.0";
          String payload;
          serializeJson(request, payload);

          PanelReply reply = panelCall(cfg, "POST", "/aircoins/claim", payload, 10000);
          if (reply.ok) {
            DynamicJsonDocument doc(512);
            if (!deserializeJson(doc, reply.body)) {
              String status = doc["status"] | "";
              claimToken = doc["token"].as<String>();
              if (status == "approved" && doc.containsKey("deviceKey")) {
                strncpy(cfg.deviceKey, doc["deviceKey"].as<String>().c_str(), sizeof(cfg.deviceKey) - 1);
                cfg.provisioned = 1;
                configTerminate(cfg);
                configSave(cfg);
                return;
              }
              phase = WAITING_ADMIN;
              setupState = "waiting";
              setupDetail = "Request sent. Waiting for an admin to accept this vendo in the panel.";
            }
          } else if (reply.code > 0) {
            setupState = "failed";
            setupDetail = String("Panel refused the request (HTTP ") + reply.code + ").";
          } else {
            setupState = "failed";
            setupDetail = String("Cannot reach the panel at ") + panelHostOf(cfg) + ":" + cfg.panelPort + ".";
          }
        } else {
          PanelReply reply = panelCall(cfg, "GET", "/aircoins/claim/status?token=" + claimToken, "", 10000);
          if (reply.ok) {
            DynamicJsonDocument doc(512);
            if (!deserializeJson(doc, reply.body)) {
              String status = doc["status"] | "";
              if (status == "approved") {
                strncpy(cfg.deviceKey, doc["deviceKey"].as<String>().c_str(), sizeof(cfg.deviceKey) - 1);
                cfg.provisioned = 1;
                configTerminate(cfg);
                configSave(cfg);
                return;
              }
              if (status == "rejected") {
                setupState = "failed";
                setupDetail = "The panel rejected this machine. Press Connect to ask again.";
                claimToken = "";
                phase = FAILED;
              } else {
                setupState = "waiting";
                setupDetail = "Request is pending. An admin must press Accept on the AirCoins subpage.";
              }
            }
          } else {
            setupState = "waiting";
            setupDetail = String("Waiting for ") + panelHostOf(cfg) + ":" + cfg.panelPort + " to answer...";
          }
        }
      }
    }

    if (phase == FAILED && millis() - phaseStarted > 4000) {
      // Back to the form so the installer can retry without power-cycling.
      phase = WAIT_JOIN;
      phaseStarted = millis();
      lastAttempt = 0;
      claimToken = "";
    }

    delay(10);
  }
}

// ======================= main.cpp =======================

/*
 * AirCoins sub-vendo.
 *
 * A coin slot and nothing else: no display, no admin page, no listening port.
 * It sells hotspot time for the customer standing in front of it - a phone or a
 * tablet, not a pisonet seat, which is a separate firmware. Rates, pricing and
 * the device that gets the time all live in the panel. The board counts pulses,
 * asks the panel what the bank is worth and reports back, so the only HTTP
 * server it ever runs is the pairing portal in setup_portal.h - and only while
 * the machine has no device key.
 *
 * A sale is only forgotten once the panel confirms it. Anything the panel did
 * not answer stays in the bank and is offered again on the next poll.
 */


// Which GPIO does what comes from the panel, as plain GPIO numbers - never the
// D2/D5 style labels, which only exist for some board variants. The level that
// arms the slot is a setting too (`slotTriggerType`), because relay modules
// come active-high and active-low; the macros below only seed the value for a
// board the panel has never configured.
#ifndef AIRCOINS_SLOT_LOCK_ACTIVE_HIGH
#define AIRCOINS_SLOT_LOCK_ACTIVE_HIGH 1
#endif
#ifndef AIRCOINS_LED_ACTIVE_LOW
#define AIRCOINS_LED_ACTIVE_LOW 1     // the NodeMCU LED is wired to 3V3
#endif
#ifndef AIRCOINS_BUZZER_PASSIVE
#define AIRCOINS_BUZZER_PASSIVE 0     // 1 = piezo driven with tone(), 0 = active buzzer
#endif

#define AIRCOINS_VERSION "1.4.3"
// Acceptors send a burst per coin - five pulses for five pesos, often less than
// 25 ms apart. The gap only has to swallow contact bounce, and the panel can
// raise or lower it per machine.
#define PULSE_DEBOUNCE_DEFAULT_MS 6
#define PULSE_BANK_MAX 60000
#define BOOT_WIFI_TIMEOUT_MS 25000
#define WIFI_LOST_RESTART_MS 300000UL
#define AUTH_FAILURES_BEFORE_RESET 3

/*
 * Silence from the panel - not the WiFi status - is what an idle vendo actually
 * dies of. An ESP8266 can sit for hours "connected" on a lease or arp entry the
 * access point has already forgotten: WiFi.status() keeps answering
 * WL_CONNECTED while every HTTP call fails, and nothing here recovered from
 * that. Only a real status drop was handled, so a machine that stopped being
 * able to reach the panel stayed dark until someone unplugged it.
 *
 * After a minute of failed reports the board re-associates, because a fresh
 * DHCP lease and arp entry are what clear that state. If the panel is still
 * silent after eight minutes it restarts - the same cure the installer used to
 * apply by hand, now automatic. The thresholds are wall-clock on purpose: a
 * machine selling (polling every couple of seconds) and an idle one (once a
 * minute) wait the same real time before acting.
 */
#define LINK_RECONNECT_AFTER_MS 60000UL
#define LINK_RESTART_AFTER_MS 480000UL
#define LINK_RECONNECT_TRIES 3

/* What the panel tells this machine to do. Everything else is local. */
struct Settings {
  uint32_t version = 0;
  char clientMac[13] = "";
  int8_t coinPin = 4;        // GPIO4  = D2, acceptor pulse, pulled up
  int8_t buzzerPin = 14;     // GPIO14 = D5
  int8_t ledPin = 2;         // GPIO2  = D4, the onboard LED
  int8_t slotLockPin = -1;   // relay that powers the slot, off unless wired
  // 1 = the relay pin goes HIGH while coins are accepted, 0 = it goes LOW.
  uint8_t slotTriggerType = AIRCOINS_SLOT_LOCK_ACTIVE_HIGH ? 1 : 0;
  uint16_t coinValue = 1;
  uint16_t pulsesPerCoin = 1;
  // Pulses closer together than this are one bounce, not two coins.
  uint16_t pulseDebounceMs = PULSE_DEBOUNCE_DEFAULT_MS;
  uint16_t coinWaitSeconds = 10;
  uint16_t maxCoins = 0;
  uint16_t abuseCount = 20;
  uint16_t banMinutes = 5;
  uint16_t thankYouSeconds = 5;
  uint16_t pollSeconds = 30;
  bool buzzer = true;
  bool loaded = false;
};

static StoredConfig cfg;
static Settings settings;

static volatile uint16_t coinPulses = 0;
static volatile uint32_t lastPulseUs = 0;
static volatile uint32_t pulseGapUs = (uint32_t)PULSE_DEBOUNCE_DEFAULT_MS * 1000UL;

static uint16_t pulseBank = 0;        // pulses not sold yet, carries remainders
static uint32_t pulsesSeen = 0;       // everything the acceptor ever sent, for wiring checks
static uint32_t coinsTaken = 0;
static uint32_t customers = 0;
static uint32_t lastCoinMs = 0;
static uint32_t slotBlockedUntil = 0;
static bool banActive = false;
static uint16_t failedSales = 0;
static uint32_t retryAfterMs = 0;
static uint32_t ledOffMs = 0;

static uint32_t lastPollMs = 0;
static uint32_t lastCommandMs = 0;
static uint8_t authFailures = 0;
static bool routerReachable = true;
static bool wifiLost = false;
static uint32_t wifiLostAt = 0;
static uint32_t linkDownSince = 0;    // first unanswerable report of the current run
static uint8_t linkReconnects = 0;
static int lastReportCode = 0;        // HTTP status of the last report, 0 = no answer
static String lastError;
static String commandDone;
static String serverCommand;

/*
 * The coin session the panel is holding for this machine, if any.
 *
 * A JuanFi box keeps this itself: /topUp opens the slot, /checkCoin reads it
 * and /useVoucher commits it. An AirCoins board serves nothing, so the panel
 * owns that conversation with the phone and only needs two things from here:
 * how many pulses this customer's session has taken, and the promise not to
 * sell them on its own while the panel is paying for them.
 *
 * `sessionPaid` is the panel's watermark for those pulses - an absolute count,
 * never a delta, so a reply lost in the air is simply repeated.
 */
static String liveSessionId;
static uint16_t sessionPulses = 0;
static uint16_t sessionPaid = 0;
static uint32_t sessionEndsMs = 0;

/*
 * The key the bank is offered for sale under. It stays the same for as long as
 * those coins are still in the bank here, so when a POST times out and the same
 * amount is offered again the panel can answer the sale it already credited
 * instead of paying for those pesos twice. `bootTag` makes the key differ after
 * a restart, or the panel would replay a sale from the previous run and the
 * new coins would never be paid for.
 */
static String redeemKey;
static uint32_t redeemSeq = 0;
static String bootTag;

static void copyText(char *dst, size_t size, const char *src) {
  if (!size) return;
  strncpy(dst, src ? src : "", size - 1);
  dst[size - 1] = '\0';
}

// ---------------------------------------------------------------- feedback

static void led(bool on) {
  if (settings.ledPin < 0) return;
  digitalWrite((uint8_t)settings.ledPin, AIRCOINS_LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

static void blink() {
  led(true);
  ledOffMs = millis() + 40;
}

static void beep(uint16_t frequency, uint16_t ms) {
  if (!settings.buzzer || settings.buzzerPin < 0) return;
#if AIRCOINS_BUZZER_PASSIVE
  tone((uint8_t)settings.buzzerPin, frequency, ms);
  delay(ms);
  noTone((uint8_t)settings.buzzerPin);
#else
  digitalWrite((uint8_t)settings.buzzerPin, HIGH);
  delay(ms);
  digitalWrite((uint8_t)settings.buzzerPin, LOW);
#endif
}

static void beepSale() {
  beep(1800, 90);
  delay(70);
  beep(2400, 140);
}

static void beepError() {
  beep(600, 120);
  delay(90);
  beep(500, 200);
}

static void applySlotLock(bool open) {
  if (settings.slotLockPin < 0) return;
  bool level = settings.slotTriggerType == 1 ? open : !open;
  digitalWrite((uint8_t)settings.slotLockPin, level ? HIGH : LOW);
}

/*
 * What the relay should be doing right now.
 *
 * With a relay wired the acceptor is only powered while the panel holds a coin
 * session - a customer pressed INSERT COIN and is feeding coins. Between sales
 * the slot is dead, like JuanFi's coin-set line, so a coin dropped at random
 * cannot start a sale nobody asked for. Without a relay there is nothing to
 * gate and the bank model carries on as before.
 */
static bool slotRelayOn = false;

static bool slotRelayWanted() {
  if (settings.slotLockPin < 0) return false;
  return liveSessionId.length() > 0;
}

static void syncSlotLock(bool force = false) {
  bool wanted = slotRelayWanted();
  if (!force && wanted == slotRelayOn) return;
  slotRelayOn = wanted;
  applySlotLock(wanted);
  Serial.printf("aircoins: slot relay %s\n", wanted ? "on" : "off");
}

// ------------------------------------------------------------------- coins

static IRAM_ATTR void onCoinPulse() {
  // Microseconds, not millis(): a 5-peso coin fires five pulses in a burst and
  // a millisecond dead-time would round the last one away.
  uint32_t now = micros();
  if ((uint32_t)(now - lastPulseUs) < pulseGapUs) return;
  lastPulseUs = now;
  if (coinPulses < 1000) coinPulses++;
}

static uint16_t takePulses() {
  noInterrupts();
  uint16_t pulses = coinPulses;
  coinPulses = 0;
  interrupts();
  return pulses;
}

static bool slotOpen() {
  return slotBlockedUntil == 0 || (int32_t)(millis() - slotBlockedUntil) >= 0;
}

/*
 * GPIO16 - D0 on the board - is the one pin with no interrupt line, and it has
 * no internal pull-up either. It is still a normal input, so the coin pin is
 * sampled by a timer when it is wired there: same falling edge, same debounce,
 * and it keeps counting while the panel call blocks the main loop.
 */
static const uint8_t COIN_POLL_PIN = 16;
static const uint32_t COIN_POLL_MS = 2;

static Ticker coinPollTicker;
static bool coinPollRunning = false;
static bool coinPinLow = false;

static void onCoinPollTick() {
  bool low = digitalRead(COIN_POLL_PIN) == LOW;
  if (low && !coinPinLow) onCoinPulse();
  coinPinLow = low;
}

/*
 * Leaves the panel's session. The pulses it already paid for were taken out of
 * the bank as each answer arrived, so whatever is left is either unsold or too
 * small to be a whole coin - both are the normal sale path's business again.
 */
static void endCoinSession() {
  if (!liveSessionId.length()) return;
  uint16_t unpaid = sessionPulses > sessionPaid ? sessionPulses - sessionPaid : 0;
  Serial.printf("aircoins: coin session closed, %u pulse(s) still unpaid\n", (unsigned)unpaid);
  liveSessionId = "";
  sessionPulses = 0;
  sessionPaid = 0;
  sessionEndsMs = 0;
}

static void closeSlot(uint32_t ms, bool asBan) {
  slotBlockedUntil = millis() + ms;
  banActive = asBan;
  syncSlotLock();
}

static void openSlot() {
  slotBlockedUntil = 0;
  banActive = false;
  failedSales = 0;
  syncSlotLock();
}

static int8_t wiredCoinPin = -1;
static int8_t wiredBuzzerPin = -1;
static int8_t wiredLedPin = -1;
static int8_t wiredLockPin = -1;
static uint8_t wiredLockTrigger = 255;

/*
 * Moves the wiring to whatever the panel says, without a reflash. Runs once at
 * boot on the built-in defaults and again whenever a new config version lands.
 */
static void applyPins() {
  if (settings.coinPin != wiredCoinPin) {
    if (wiredCoinPin >= 0 && wiredCoinPin != COIN_POLL_PIN) {
      detachInterrupt(digitalPinToInterrupt((uint8_t)wiredCoinPin));
    }
    if (coinPollRunning) {
      coinPollTicker.detach();
      coinPollRunning = false;
    }
    wiredCoinPin = settings.coinPin;
    // 6-11 are the flash lines; D0 is handled on its own because GPIO16 has
    // no interrupt (sampled instead) and no pull-up to turn on.
    bool usable = wiredCoinPin >= 0 && wiredCoinPin <= 15 && wiredCoinPin != 6;
    if (wiredCoinPin == COIN_POLL_PIN) {
      pinMode(COIN_POLL_PIN, INPUT);
      coinPinLow = digitalRead(COIN_POLL_PIN) == LOW;
      coinPollTicker.attach_ms(COIN_POLL_MS, onCoinPollTick);
      coinPollRunning = true;
      Serial.println("aircoins: coin pin is D0 (GPIO16), sampled every 2 ms");
    } else if (usable) {
      pinMode((uint8_t)wiredCoinPin, INPUT_PULLUP);
      attachInterrupt(digitalPinToInterrupt((uint8_t)wiredCoinPin), onCoinPulse, FALLING);
    } else if (wiredCoinPin >= 0) {
      Serial.printf("aircoins: GPIO %d cannot take coin pulses\n", (int)wiredCoinPin);
    }
  }

  if (settings.buzzerPin != wiredBuzzerPin) {
    if (wiredBuzzerPin >= 0) pinMode((uint8_t)wiredBuzzerPin, INPUT);
    wiredBuzzerPin = settings.buzzerPin;
    if (wiredBuzzerPin >= 0) {
      pinMode((uint8_t)wiredBuzzerPin, OUTPUT);
      digitalWrite((uint8_t)wiredBuzzerPin, LOW);
    }
  }

  if (settings.ledPin != wiredLedPin) {
    if (wiredLedPin >= 0) pinMode((uint8_t)wiredLedPin, INPUT);
    wiredLedPin = settings.ledPin;
    if (wiredLedPin >= 0) pinMode((uint8_t)wiredLedPin, OUTPUT);
    led(false);
  }

  // A polarity change alone must also re-drive the relay, so the trigger type
  // is tracked beside the pin instead of only reacting to a re-wire.
  if (settings.slotLockPin != wiredLockPin || settings.slotTriggerType != wiredLockTrigger) {
    if (settings.slotLockPin != wiredLockPin) {
      if (wiredLockPin >= 0) pinMode((uint8_t)wiredLockPin, INPUT);
      wiredLockPin = settings.slotLockPin;
      if (wiredLockPin >= 0) pinMode((uint8_t)wiredLockPin, OUTPUT);
    }
    wiredLockTrigger = settings.slotTriggerType;
    syncSlotLock(true);
  }
}

// -------------------------------------------------------------- panel talk

static void handleAuthFailure() {
  authFailures++;
  lastError = "Device key refused by the panel";
  // Three refusals in a row means the key was replaced in the panel: the
  // operator cut this machine off, so go back to setup and wait to be accepted.
  if (authFailures >= AUTH_FAILURES_BEFORE_RESET) {
    Serial.println("aircoins: key refused, returning to setup mode");
    configForgetPairing(cfg);
    delay(300);
    ESP.restart();
  }
}

static bool fetchConfig() {
  PanelReply reply = panelCall(cfg, "GET", String("/aircoins/config?key=") + cfg.deviceKey, "", 12000);
  if (reply.code == 401) {
    handleAuthFailure();
    return false;
  }
  if (!reply.ok) {
    lastError = "Could not read the config from the panel";
    return false;
  }

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, reply.body)) {
    lastError = "The panel sent a config this board cannot read";
    return false;
  }

  JsonObject s = doc["settings"].as<JsonObject>();
  settings.version = doc["version"] | settings.version;
  copyText(settings.clientMac, sizeof(settings.clientMac), s["clientMac"] | "");
  settings.coinValue = s["coinValue"] | settings.coinValue;
  settings.pulsesPerCoin = s["pulsesPerCoin"] | settings.pulsesPerCoin;
  settings.pulseDebounceMs = s["pulseDebounceMs"] | settings.pulseDebounceMs;
  if (settings.pulseDebounceMs < 1) settings.pulseDebounceMs = 1;
  if (settings.pulseDebounceMs > 50) settings.pulseDebounceMs = 50;
  pulseGapUs = (uint32_t)settings.pulseDebounceMs * 1000UL;
  settings.coinWaitSeconds = s["coinWaitSeconds"] | settings.coinWaitSeconds;
  settings.maxCoins = s["maxCoins"] | settings.maxCoins;
  settings.abuseCount = s["abuseCount"] | settings.abuseCount;
  settings.banMinutes = s["banMinutes"] | settings.banMinutes;
  settings.thankYouSeconds = s["thankYouSeconds"] | settings.thankYouSeconds;
  settings.pollSeconds = s["pollSeconds"] | settings.pollSeconds;
  settings.buzzer = s["buzzer"] | settings.buzzer;
  settings.coinPin = (int8_t)(int)(s["coinPin"] | (int)settings.coinPin);
  settings.buzzerPin = (int8_t)(int)(s["buzzerPin"] | (int)settings.buzzerPin);
  settings.ledPin = (int8_t)(int)(s["ledPin"] | (int)settings.ledPin);
  settings.slotLockPin = (int8_t)(int)(s["slotLockPin"] | (int)settings.slotLockPin);
  settings.slotTriggerType = (uint8_t)(int)(s["slotTriggerType"] | (int)settings.slotTriggerType);
  if (settings.slotTriggerType > 1) settings.slotTriggerType = 1;
  if (settings.coinValue < 1) settings.coinValue = 1;
  if (settings.pulsesPerCoin < 1) settings.pulsesPerCoin = 1;
  if (settings.pollSeconds < 5) settings.pollSeconds = 5;
  settings.loaded = true;
  applyPins();
  authFailures = 0;
  lastError = "";
  Serial.printf("aircoins: config v%lu, %u pulses per %u peso coin, mac %s\n",
                (unsigned long)settings.version, (unsigned)settings.pulsesPerCoin,
                (unsigned)settings.coinValue, settings.clientMac);
  return true;
}

static bool sendStatus() {
  // 1536, not the 1024 this once was: the longest error the panel accepts is
  // 200 characters and it is carried on every report while it stands, which put
  // the payload within a handful of bytes of the old capacity. A document that
  // runs out serialises to a truncated body, and a body the panel cannot parse
  // looks exactly like an offline machine.
  DynamicJsonDocument doc(1536);
  // Cleared first: a call that never gets an answer must not leave the code of
  // the previous one behind, or a lost link would look like a delivered report.
  lastReportCode = 0;
  doc["key"] = cfg.deviceKey;
  doc["ip"] = WiFi.localIP().toString();
  doc["mac"] = macNoColon();
  doc["firmwareVersion"] = AIRCOINS_VERSION;
  doc["uptime"] = (uint32_t)(millis() / 1000);
  doc["coins"] = coinsTaken;
  doc["customers"] = customers;
  doc["pulses"] = pulsesSeen;
  doc["bank"] = pulseBank;
  // Which session this count belongs to. Only sent while the panel is holding
  // one, so coins banked before INSERT COIN are never credited to this customer.
  if (liveSessionId.length()) {
    doc["sessionId"] = liveSessionId;
    doc["sessionPulses"] = sessionPulses;
  }
  doc["routerConnected"] = routerReachable;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["configVersion"] = settings.version;
  doc["lastError"] = lastError;
  if (commandDone.length()) doc["commandDone"] = commandDone;

  String payload;
  serializeJson(doc, payload);

  PanelReply reply = panelCall(cfg, "POST", "/aircoins/status", payload, 10000);
  lastReportCode = reply.code;
  if (reply.code == 401) {
    handleAuthFailure();
    return false;
  }
  if (!reply.ok) {
    routerReachable = false;
    lastError = "The panel did not answer the report";
    return false;
  }

  routerReachable = true;
  commandDone = "";

  DynamicJsonDocument res(512);
  if (deserializeJson(res, reply.body)) return true;

  uint16_t poll = res["pollSeconds"] | settings.pollSeconds;
  // 2s is not a typo: while a customer is feeding the slot the panel asks for a
  // report every couple of seconds so the phone sees each coin.
  if (poll >= 2 && poll <= 3600) settings.pollSeconds = poll;

  uint32_t version = res["version"] | 0;
  if (version && version != settings.version) fetchConfig();

  /*
   * The panel's coin session. `paidPulses` is how many of sessionPulses it has
   * already turned into time: those leave the bank here, which is what keeps a
   * coin the phone paid for from being sold again by this board.
   */
  JsonObject session = res["session"].as<JsonObject>();
  if (session.isNull()) {
    endCoinSession();
  } else {
    String id = session["id"] | "";
    if (id.length() && id != liveSessionId) {
      endCoinSession();
      liveSessionId = id;
      Serial.printf("aircoins: coin session %s opened by the panel\n", id.c_str());
    }
    uint32_t paid = session["paidPulses"] | 0;
    if (paid > sessionPaid) {
      uint16_t cleared = (uint16_t)(paid - sessionPaid);
      pulseBank = pulseBank > cleared ? pulseBank - cleared : 0;
      sessionPaid = (uint16_t)paid;
    }
    uint32_t left = session["expiresInMs"] | 0;
    if (left == 0) {
      endCoinSession();
    } else {
      sessionEndsMs = millis() + left;
    }
  }

  String command = res["pendingCommand"] | "";
  if (command.length()) serverCommand = command;
  return true;
}

static void handleServerCommand(const String &command) {
  if ((uint32_t)(millis() - lastCommandMs) < 5000) return;
  lastCommandMs = millis();

  if (command == "restart") {
    Serial.println("aircoins: restart requested by the panel");
    commandDone = "restart";
    sendStatus();
    delay(400);
    ESP.restart();
  }
  if (command == "sync") {
    Serial.println("aircoins: config refresh requested by the panel");
    fetchConfig();
    commandDone = "sync";
    sendStatus();
  }
}

/*
 * Hands the bank to the panel. The panel decides the minutes - the machine only
 * knows how many pulses it counted - and answers with the amount it actually
 * spent, so nothing is charged unless the credit went through.
 */
static void sellBank(uint16_t coins) {
  // A machine with no fixed sale target still sells: with an empty MAC the
  // panel credits whoever opened the coin slot, or banks the coins as an
  // unassigned sale. Refusing here would keep money the shop already took and
  // leave the customer's coins stuck in the bank.
  if (settings.clientMac[0] == '\0') {
    Serial.println("aircoins: no fixed sale target, letting the panel route these coins");
  }

  if (!bootTag.length()) {
    bootTag = String((uint32_t)ESP.getChipId(), HEX) + String((uint32_t)random(0x10000000L, 0x7FFFFFFFL), HEX);
  }
  if (!redeemKey.length()) redeemKey = bootTag + "-" + String(++redeemSeq);

  DynamicJsonDocument doc(256);
  doc["key"] = cfg.deviceKey;
  doc["mac"] = settings.clientMac;
  doc["amount"] = coins;
  doc["redeemKey"] = redeemKey;
  String payload;
  serializeJson(doc, payload);

  Serial.printf("aircoins: offering %u coins for %s\n", (unsigned)coins, settings.clientMac);
  PanelReply reply = panelCall(cfg, "POST", "/aircoins/redeem", payload, 15000);

  if (reply.code == 401) {
    handleAuthFailure();
    return;
  }

  // Big enough for the applied-rate list: an unreadable answer must never look
  // like a failed sale, or the same coins would be offered a second time.
  DynamicJsonDocument res(4096);
  bool readable = reply.ok && !deserializeJson(res, reply.body);

  if (readable && String(res["status"] | "") == "ok") {
    uint16_t spent = res["spent"] | coins;
    if (spent < 1) spent = coins;
    uint16_t usedPulses = spent / settings.coinValue * settings.pulsesPerCoin;
    pulseBank = pulseBank > usedPulses ? pulseBank - usedPulses : 0;

    // Paid and done: the next bank is offered under a fresh key, so the panel
    // will credit those coins even though the amount may be the same.
    redeemKey = "";
    coinsTaken += coins;
    customers++;
    failedSales = 0;
    lastError = "";
    beepSale();
    closeSlot((uint32_t)settings.thankYouSeconds * 1000UL, false);
    Serial.printf("aircoins: sold %u coins -> %u min, %u left in bank\n",
                  (unsigned)coins, (unsigned)(int)(res["minutes"] | 0), (unsigned)pulseBank);
    return;
  }

  if (readable && String(res["status"] | "") == "no-rate") {
    lastError = String("No rate covers ") + coins + " pesos yet";
    retryAfterMs = millis() + 60000UL;
    beepError();
    return;
  }

  // Nothing was credited, so the coins stay in the bank and get another try.
  lastError = reply.ok ? "The panel could not credit this sale" : "Could not reach the panel to sell the coins";
  failedSales++;
  if (settings.abuseCount > 0 && failedSales >= settings.abuseCount && settings.banMinutes > 0) {
    Serial.printf("aircoins: %u failed sales, closing the slot for %u min\n",
                  (unsigned)failedSales, (unsigned)settings.banMinutes);
    closeSlot((uint32_t)settings.banMinutes * 60000UL, true);
    failedSales = 0;
  }
  beepError();
  retryAfterMs = millis() + 15000UL;
}

// The bank is worth money the moment the pulses land, so it is settled only
// after the acceptor has been quiet for coinWaitSeconds.
static void serviceCoins() {
  uint16_t pulses = takePulses();
  uint32_t now = millis();

  if (banActive && slotOpen()) {
    Serial.println("aircoins: ban over, taking coins again");
    openSlot();
  }

  if (pulses) {
    pulsesSeen += pulses;
    lastCoinMs = now;
    retryAfterMs = 0;
    if (banActive) {
      // Pulses during a ban are the abuse that caused it; they are not sold.
      Serial.printf("aircoins: dropped %u pulses, slot is banned\n", (unsigned)pulses);
      beepError();
    } else if (pulseBank + pulses > PULSE_BANK_MAX) {
      pulseBank = PULSE_BANK_MAX;
    } else {
      pulseBank += pulses;
      // Counted for the customer's session as well, so the panel can pay for
      // exactly these pulses and no others.
      if (liveSessionId.length()) sessionPulses += pulses;
      // A coin is the one moment the panel has news it does not have. Reporting
      // at once picks up a session the phone just opened, before the acceptor
      // goes quiet and this bank would settle on its own.
      lastPollMs = millis() - (uint32_t)settings.pollSeconds * 1000UL;
      blink();
      beep(2200, 40);
    }
  }

  if (liveSessionId.length() && sessionEndsMs && (int32_t)(now - sessionEndsMs) >= 0) {
    // The phone stopped and the window closed: the panel has already paid for
    // what it saw, and whatever is left is sold the normal way.
    endCoinSession();
  }

  // The relay follows the session: the moment it ends - paid, cancelled or
  // timed out - the acceptor loses power again.
  syncSlotLock();

  if (!settings.loaded) return;
  if (pulseBank < settings.pulsesPerCoin) return;

  // While the panel owns a session it is paying for these pulses itself, so
  // selling the bank here would hand out the same time twice.
  if (liveSessionId.length()) return;

  // A cooldown keeps the coins banked but holds the sale, so one customer's
  // coins are never sold into the next one's turn.
  if (!slotOpen()) return;
  if ((int32_t)(now - retryAfterMs) < 0) return;
  if ((uint32_t)(now - lastCoinMs) < (uint32_t)settings.coinWaitSeconds * 1000UL) return;
  if (WiFi.status() != WL_CONNECTED) return;  // an outage must not ban the slot

  uint16_t wholeCoins = pulseBank / settings.pulsesPerCoin;
  uint32_t amount = (uint32_t)wholeCoins * settings.coinValue;
  if (settings.maxCoins > 0 && amount > settings.maxCoins) {
    // The cap is a per-sale ceiling: the rest stays banked for the next sale.
    amount = settings.maxCoins;
    lastError = "Sale capped by the panel setting";
  }
  if (amount < 1) return;

  sellBank((uint16_t)amount);
}

// -------------------------------------------------------------------- wifi

static bool connectWifi(uint32_t timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  // Modem sleep parks the radio between beacons. On a shop AP that also ages
  // out quiet clients that is the usual reason an idle vendo stops answering:
  // it can miss the very beacon that would tell it it was dropped. The board is
  // mains powered, so the extra draw costs nothing.
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid, cfg.pass);

  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && (uint32_t)(millis() - started) < timeoutMs) {
    delay(200);
  }
  return WiFi.status() == WL_CONNECTED;
}

/*
 * Turns a report nobody answered into a recovery instead of a wait. `heard`
 * means the panel replied at all, whatever the status code: a 4xx/5xx is the
 * panel talking, and restarting the vendo would not fix it - that is left on
 * the error line for the operator to read.
 */
static void notePanelResult(bool heard) {
  uint32_t now = millis();
  if (heard) {
    if (linkDownSince) {
      Serial.printf("aircoins: panel link back after %lu s\n",
                    (unsigned long)((now - linkDownSince) / 1000UL));
    }
    linkDownSince = 0;
    linkReconnects = 0;
    // The error text itself is left alone: a failed sale or a missing rate is
    // the operator's business and must stay on the panel's error line until
    // the board fetches a config or sells again.
    return;
  }

  if (!linkDownSince) linkDownSince = now;
  uint32_t downMs = now - linkDownSince;
  if (downMs >= LINK_RESTART_AFTER_MS) {
    Serial.println("aircoins: panel silent for 8 min, restarting");
    ESP.restart();
  }
  if (downMs >= LINK_RECONNECT_AFTER_MS && linkReconnects < LINK_RECONNECT_TRIES) {
    linkReconnects++;
    Serial.printf("aircoins: panel silent for %lu s, re-associating (%u/%u)\n",
                  (unsigned long)(downMs / 1000UL), (unsigned)linkReconnects,
                  (unsigned)LINK_RECONNECT_TRIES);
    // begin() alone would keep the address the AP no longer knows; a real
    // disconnect throws the lease and arp entry away with it.
    WiFi.disconnect(false, false);
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
    WiFi.setAutoReconnect(true);
    WiFi.begin(cfg.ssid, cfg.pass);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("AirCoins vendo " AIRCOINS_VERSION);

  configLoad(cfg);
  applyPins();  // the built-in defaults until the panel sends its own wiring

  // No key yet means nobody accepted this machine: the board belongs on the
  // Aircoins_setup access point until an admin does.
  if (!cfg.provisioned || cfg.deviceKey[0] == '\0' || cfg.ssid[0] == '\0') {
    runSetupPortal(cfg);
    ESP.restart();
  }

  if (!connectWifi(BOOT_WIFI_TIMEOUT_MS)) {
    Serial.println("aircoins: no WiFi, opening setup");
    runSetupPortal(cfg);
    ESP.restart();
  }

  Serial.print("aircoins: joined ");
  Serial.print(cfg.ssid);
  Serial.print(", ip ");
  Serial.println(WiFi.localIP());

  // The interrupt on the coin pin is already attached by applyPins(). Nothing
  // is powered yet: the slot relay closes only once a session opens.

  if (!fetchConfig()) {
    Serial.println("aircoins: first config pull failed, will retry");
  }
  lastPollMs = millis() - (uint32_t)settings.pollSeconds * 1000UL;
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (!wifiLost) {
      wifiLost = true;
      wifiLostAt = millis();
      routerReachable = false;
    } else if ((uint32_t)(millis() - wifiLostAt) > WIFI_LOST_RESTART_MS) {
      // The shop password probably changed. A restart either reconnects or,
      // if it still cannot, drops the board back onto Aircoins_setup.
      Serial.println("aircoins: WiFi gone too long, restarting");
      ESP.restart();
    }
    if (ledOffMs && (int32_t)(millis() - ledOffMs) >= 0) {
      led(false);
      ledOffMs = 0;
    }
    serviceCoins();
    delay(50);
    return;
  }
  if (wifiLost) {
    // Back on the air: report at once instead of waiting out the interval, so
    // the panel sees this machine again the moment it can answer.
    wifiLost = false;
    lastPollMs = millis() - (uint32_t)settings.pollSeconds * 1000UL;
  }

  if (ledOffMs && (int32_t)(millis() - ledOffMs) >= 0) {
    led(false);
    ledOffMs = 0;
  }

  serviceCoins();

  if (serverCommand.length()) {
    String command = serverCommand;
    serverCommand = "";
    handleServerCommand(command);
  }

  if ((uint32_t)(millis() - lastPollMs) >= (uint32_t)settings.pollSeconds * 1000UL) {
    lastPollMs = millis();
    sendStatus();
    // A report with no HTTP code at all is the only one that means the link is
    // gone; anything the panel answered, even an error, is somebody home.
    notePanelResult(lastReportCode > 0);
  }

  delay(10);
}

#endif  // AIRCOINS_CORE_H
