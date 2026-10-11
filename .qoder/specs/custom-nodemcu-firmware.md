# Custom NodeMCU Firmware with Safe OTA

## Overview

Fork JuanFi firmware to replace MikroTik telnet commands with HTTP POST to the panel API. Add robust OTA safety mechanisms so a bad flash can never brick a device.

---

## Phase 1: Safe OTA Infrastructure (CRITICAL — do first)

### 1.1 Boot-Loop Watchdog

Add a boot counter in EEPROM that detects repeated crash-on-boot:

- On `setup()` start: increment boot counter in EEPROM
- After 15 seconds of正常运行 (past the network connect + first poll): reset counter to 0
- If counter reaches **3 consecutive bad boots**: enter **Safe Mode**
  - Skip all normal operation
  - Start SoftAP `"JuanFi-SAFE"` at `172.217.28.1` (ESP8266) or static Ethernet IP (ESP32)
  - Serve only the admin page with a prominent "FIRMWARE SAFE MODE" banner
  - Allow OTA upload to re-flash
  - Show LCD message: "SAFE MODE - Re-flash firmware"
  - Auto-clear counter after successful safe-mode OTA

**EEPROM layout** (add to existing):
```
Address 50: boot counter (1 byte, max 255)
Address 51: safe mode flag (1 byte, 0=normal, 1=safe)
```

### 1.2 Pre-Flight Binary Validation

Before calling `Update.begin()`:

1. **Check ESP image header magic byte**: First byte must be `0xE9` (ESP8266) or valid ESP32 image header
2. **Validate binary size**: Must not exceed `ESP.getFreeSketchSpace()`
3. **Checksum**: Compute MD5 of received data, compare with `Update.md5()` after write
4. **Reject invalid binaries** with clear error message, do NOT flash

### 1.3 ArduinoOTA as Secondary Channel

Add `ArduinoOTA` library support alongside the web UI OTA:

- Listens on port 3232 (ESP8266) / 3232 (ESP32)
- Allows wireless firmware update from Arduino IDE / PlatformIO without touching the web UI
- Password-protected (use admin password from config)
- Works even if the web server crashes (runs in separate task on ESP32, or in loop on ESP8266)
- **This is the recovery path** — if the web UI OTA fails, PlatformIO OTA can still reach the device

### 1.4 Config Preservation

Already exists (`backupSystemConfig()` to EEPROM before filesystem update). Keep it. Add:

- After safe-mode OTA succeeds: clear boot counter + safe mode flag
- On normal boot: if config backup exists but current config is empty/corrupt, auto-restore

---

## Phase 2: Firmware Fork — Replace MikroTik with Panel API

### 2.1 New Config Fields

Append to `system.data` pipe-delimited format (after existing 30 fields):

| Index | Field | Example |
|-------|-------|---------|
| 30 | `panelUrl` | `http://10.0.0.252:3000` |
| 31 | `routerId` | `1` |
| 32 | `panelApiKey` | `abc123` (for future auth) |

Keep existing MikroTik fields (indexes 3-5) in the data format for backward compatibility, but hide them from admin UI when panel mode is active.

### 2.2 Replace 4 MikroTik Functions

| Original | Replacement | What changes |
|----------|-------------|--------------|
| `loginMirotik()` | `connectToPanel()` | HTTP GET `{panelUrl}/api/nodemcu/devices/{routerId}/ping` — verifies panel is reachable. Sets `mikrotekConnectionSuccess` based on HTTP response, not telnet. |
| `registerNewVoucher(voucher)` | Merged into `reportSessionToPanel()` | No longer needed as separate function |
| `addTimeToVoucher(voucher, seconds)` | Merged into `reportSessionToPanel()` | No longer needed as separate function |
| `sendCommand(script)` | **Removed** | No telnet needed |

**New function: `reportSessionToPanel(voucher, totalCoin, timeToAdd, validity, dataLimit, profile)`**
- HTTP POST to `{panelUrl}/api/nodemcu/coin-insert`
- JSON body: `{ router_id, username, mac, ip, session_timeout, amount_paid, validity_minutes, data_limit_mb, profile_name }`
- Returns success/failure — firmware shows appropriate LCD message
- **Timeout**: 5 seconds. If panel unreachable, retry once after 2 seconds. If still failing, fall back to direct MikroTik telnet (existing code path) as safety net.

### 2.3 Fallback to Direct MikroTik

If panel API is unreachable after retries:
- Fall back to the original telnet-based `registerNewVoucher()` + `addTimeToVoucher()`
- Show "Panel offline — direct mode" on LCD
- Log the fallback event
- This ensures coins always work even if the panel is down

### 2.4 Call Sites to Update

1. **`useVoucher()`** (line ~1021): Replace `registerNewVoucher()` + `addTimeToVoucher()` with `reportSessionToPanel()`
2. **Auto-expire in `loop()`** (line ~1575): Same replacement
3. **`handleGenerateVouchers()`** (line ~1824): Bulk generate via panel API loop

---

## Phase 3: Panel API Extension

### 3.1 Extend `POST /api/nodemcu/coin-insert`

Current endpoint creates `radius_sessions` record. Extend it to also create the MikroTik hotspot user:

**New request body:**
```json
{
  "router_id": 1,
  "username": "P1234",
  "mac": "AA:BB:CC:DD:EE:FF",
  "ip": "10.0.0.5",
  "session_timeout": 28800,
  "amount_paid": 5,
  "validity_minutes": 60,
  "data_limit_mb": 0,
  "profile_name": "default"
}
```

**New behavior:**
1. Create `radius_sessions` record (existing)
2. Call MikroTik API to create hotspot user with correct `limit-uptime`, `comment`, `profile` (same as what the firmware used to do directly)
3. Return `{ success: true, session_id: "coin_xxx" }` or error

This means the panel becomes the single point of MikroTik user management — firmware just reports coin inserts.

---

## Phase 4: Build System

### 4.1 PlatformIO Configuration

Create `JuanFi-nodemcu/platformio.ini`:

```ini
[env:esp8266_wifi]
platform = espressif8266
board = nodemcuv2
framework = arduino
monitor_speed = 115200
board_build.filesystem = spiffs
lib_deps =
  marcoschwartz/LiquidCrystal_I2C@^1.1.4
build_flags = -DESP8266

[env:esp32_lan]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
board_build.filesystem = spiffs
lib_deps =
  marcoschwartz/LiquidCrystal_I2C@^1.1.4
  arduino-libraries/Ethernet@^2.0.0
build_flags = -DESP32
```

### 4.2 Build Scripts

Create `JuanFi-nodemcu/build.sh` (and `.bat` for Windows):
- `build-esp8266` — compiles ESP8266 WiFi firmware, outputs `.bin`
- `build-esp32` — compiles ESP32 LAN firmware, outputs `.bin`
- `build-spiffs` — builds SPIFFS filesystem image (admin HTML, JS, config templates)

---

## Phase 5: Admin UI Updates

In `system-config.html`:

1. Add "Panel Connection" section:
   - Panel URL input
   - Router ID input (dropdown populated from panel API)
   - Panel API Key input
   - "Test Connection" button (pings panel, shows result)

2. Keep MikroTik settings but collapse under "Advanced / Fallback Settings"
   - Only shown when "Enable direct MikroTik fallback" checkbox is checked

3. Update Dashboard:
   - Replace "Mikrotik Status" with "Panel Status" (connected/disconnected)
   - Keep showing connection details

4. Firmware Update tab: **Keep exactly as-is** — it works at hardware level

---

## Files to Create/Modify

### New files:
- `JuanFi-nodemcu/platformio.ini` — build config
- `JuanFi-nodemcu/build.sh` / `build.bat` — build scripts
- `JuanFi-nodemcu/src/safe_ota.h` — boot watchdog + safe mode logic
- `JuanFi-nodemcu/src/panel_client.h` — HTTP client for panel API calls

### Modified files:
- `JuanFi-nodemcu/JuanFi-nodemcu.ino` — replace MikroTik functions, add safe OTA, add panel client
- `JuanFi-nodemcu/data/admin/system-config.html` — add panel connection UI
- `src/api/nodemcu.ts` — extend `coin-insert` endpoint with MikroTik user creation
- `src/services/nodemcu.ts` — update config field mapping for new fields

---

## Safety Summary

| Risk | Mitigation |
|------|------------|
| Bad firmware bricks device | Boot-loop watchdog: 3 crashes → safe mode AP |
| Wrong .bin uploaded | Pre-flight: check magic byte `0xE9`, validate size |
| Flash write corrupts | MD5 checksum verification after write |
| Can't reach device after bad flash | ArduinoOTA on port 3232 as secondary recovery channel |
| Config lost during filesystem OTA | EEPROM backup (already exists), auto-restore on boot |
| Panel down = coins don't work | Fallback to direct MikroTik telnet if panel unreachable |
| Safe mode stuck | Auto-clear after successful re-flash; counter resets after 15s normal operation |

---

## Implementation Order

1. **Phase 1** — Safe OTA (boot watchdog, bin validation, ArduinoOTA) — do first, test thoroughly
2. **Phase 4** — Build system (PlatformIO) — needed before we can iterate on firmware
3. **Phase 2** — Fork: replace MikroTik with panel API + fallback
4. **Phase 3** — Panel API extension (coin-insert creates MikroTik user)
5. **Phase 5** — Admin UI updates

Phase 1+2 can be tested independently — flash the safe-OTA firmware to a device, verify boot watchdog works, then proceed to Phase 2 changes.
