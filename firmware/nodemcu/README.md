# JuanFi Vendo Machine - NodeMCU ESP8266 Firmware

## Hardware Required

| Component | Model | Notes |
|-----------|-------|-------|
| MCU | NodeMCU ESP8266 (ESP-12E) | Any NodeMCU board works |
| Coin Acceptor | CH-926 or similar pulse type | Must have pulse output |
| Power Supply | 5V 2A | USB or barrel jack |
| Enclosure | Any project box | With coin slot cutout |

### Optional
- 0.96" I2C OLED Display (SSD1306) - shows status
- Relay module - for charging station control
- RGB LED - status indication

## Wiring

### Coin Acceptor (CH-926)

```
Coin Acceptor     NodeMCU
─────────────     ───────
VCC (red)    →    5V (or VIN)
GND (black)  →    GND
PULSE (white) →   D5 (GPIO14)
```

**CH-926 DIP Switch Settings:**
- SW1 = ON (Accept coins)
- SW2-SW4 = per your coin values
- SW5-SW8 = signal output mode

Set the acceptor so that **1 coin = 1 pulse**.

### OLED Display (Optional)

```
OLED SSD1306      NodeMCU
─────────────     ───────
VCC          →    3.3V
GND          →    GND
SDA          →    D2 (GPIO4)
SCL          →    D1 (GPIO5)
```

## Arduino IDE Setup

### 1. Install ESP8266 Board Package
1. Open Arduino IDE → File → Preferences
2. Add to "Additional Board Manager URLs":
   ```
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Tools → Board → Boards Manager → Search "ESP8266" → Install

### 2. Install Required Libraries
Sketch → Include Library → Manage Libraries:
- **ArduinoJson** by Benoit Blanchon (v6.x)

### 3. Board Settings
- **Board:** NodeMCU 1.0 (ESP-12E Module)
- **Upload Speed:** 115200
- **CPU Frequency:** 80 MHz
- **Flash Size:** 4MB (FS:2MB OTA:~1019KB)
- **Debug port:** Disabled

### 4. Configure Firmware

Edit these values at the top of `vendo_machine.ino`:

```cpp
// WiFi - must match your network
const char* WIFI_SSID = "YourSSID";
const char* WIFI_PASSWORD = "YourPassword";

// Static IP - must match config.js vendoIp
IPAddress STATIC_IP(10, 1, 0, 41);
IPAddress GATEWAY(10, 1, 0, 1);

// MikroTik router
const char* MIKROTIK_HOST = "10.1.0.1";
const uint16_t MIKROTIK_PORT = 8728;
const char* MIKROTIK_USER = "admin";
const char* MIKROTIK_PASS = "your_password";

// Hotspot profile name (must exist on MikroTik)
const char* HOTSPOT_PROFILE = "default";
```

### 5. Upload
1. Connect NodeMCU via USB
2. Select correct COM port
3. Click Upload

## Configuration

### Rates
Edit the `internetRates[]` array to set your pricing:

```cpp
Rate internetRates[] = {
  {1, 30, 0},     // 1 peso = 30 min, unlimited data
  {5, 180, 0},    // 5 pesos = 3 hours, unlimited data
  {10, 480, 0},   // 10 pesos = 8 hours, unlimited data
  {20, 1440, 0},  // 20 pesos = 24 hours, unlimited data
  {50, 4320, 0},  // 50 pesos = 3 days, unlimited data
};
```

Format: `{price_pesos, validity_minutes, data_mb}`
- Set `data_mb` to 0 for unlimited
- Set `data_mb` to a number (e.g., 100) for data-limited plans

### Coin Acceptor
```cpp
const uint8_t COIN_PULSE_PIN = 14;   // D5 = GPIO14
const uint8_t PULSES_PER_PESO = 1;   // 1 pulse = 1 peso
const uint32_t COIN_TIMEOUT_MS = 500; // Debounce time
const uint32_t COIN_SLOT_TIMEOUT = 60000; // 60s to insert coins
```

### Multi-Vendo Setup
After flashing, update your `hotspot/assets/js/config.js`:

```javascript
var isMultiVendo = true;
var multiVendoOption = 1; // auto-select by hotspot address

var multiVendoAddresses = [
    {
        vendoName: "Vendo 1 - ESP8266",
        vendoIp: "10.1.0.41",        // must match STATIC_IP in firmware
        chargingEnable: false,
        eloadEnable: false,
        hotspotAddress: "10.1.0.1",   // MikroTik hotspot IP
        interfaceName: "vlan11-hotspot1"
    }
];
```

## MikroTik Setup

### 1. Enable API Access
```
/ip service
set api port=8728 disabled=no
```

### 2. Create Hotspot User Profile
```
/ip hotspot user profile add name=default
```

### 3. Create a Test User (to verify API works)
```
/ip hotspot user add name=testuser password=testuser profile=default
```

### 4. Verify API connectivity
From your PC, test the API port:
```
telnet 10.1.0.1 8728
```
If you see a response, the API is accessible.

## How It Works

1. User clicks "INSERT COIN" on the hotspot login page
2. Portal sends `POST /topUp` to this vendo machine
3. Vendo machine starts accepting coins, returns a voucher code
4. Portal polls `POST /checkCoin` every second
5. When coins are inserted, portal shows peso amount and time earned
6. User clicks "DONE" → portal sends `POST /useVoucher`
7. Vendo machine creates hotspot user on MikroTik via API
8. Vendo machine saves MAC-to-voucher mapping in LittleFS
9. Portal auto-logs in with the voucher code

### Auto-Login (Returning Users)
- When a user revisits the login page, the portal fetches `/data/<mac>.txt`
- If a voucher exists for that MAC, it auto-fills and connects

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Coin not detected | Check wiring, verify DIP switches, try different GPIO pin |
| Multiple pulses per coin | Adjust `PULSES_PER_PESO` or coin acceptor DIP switches |
| Can't connect to MikroTik | Verify API is enabled, check IP/credentials, ensure same network |
| Voucher created but can't login | Check hotspot profile exists, verify user was created in MikroTik |
| WiFi won't connect | Check SSID/password, move closer to router, check DHCP |
| Portal can't reach vendo | Verify static IP, check firewall on router, ensure CORS is enabled |

## Serial Monitor Debug

Connect at 115200 baud. You'll see:
```
[API] /topUp called
[API] Session started, voucher=ABC12345 mac=AA:BB:CC:DD:EE:FF
[COIN] Total: 5 pesos
[API] /useVoucher called, voucher=ABC12345
[MT] Login response: !done
[MT] Add user response: !done
[FS] Saved MAC data: /data/AABBCCDDEEFF.txt -> ABC12345#1728000000
```

## File Structure on NodeMCU

```
/data/
  AABBCCDDEEFF.txt    ← MAC-to-voucher mapping
  112233445566.txt    ← one file per client MAC
```

Each file contains: `<voucher_code>#<validity_timestamp>`
