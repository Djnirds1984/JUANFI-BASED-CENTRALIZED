# AIRCOINS — MikroTik Controller

**One small box. Every router. Every coin. Every customer.**

AIRCOINS turns a Raspberry Pi, Orange Pi or any cheap Mini PC into the brain of a
MikroTik hotspot business — vouchers, coin machines, GCash payments, a built-in
RADIUS server, a customer-facing portal and a cash wallet your patrons load with
coins and spend on internet time. No cloud subscription. No per-AP fee. No
internet required for the shop to keep selling.

Built for Filipino *pisoWiFi* operators, barangay entrepreneurs, dormitories,
catechetical centers, coffee shops, school canteens and small ISPs running one
router or fifty.

> **Naming.** **AIRCOINS** is the controller — the software in this repository. The
> router-side configuration it writes and the coin machines it talks to still carry
> the **JuanFi PisoWiFi** name (the legacy `hotspot/` page set, the *Default (JuanFi)*
> portal theme and the `JuanFi-nodemcu/` firmware), because AIRCOINS is built on that
> system's MikroTik conventions. Same router setup, same coin-slot protocol — new
> brain running it.

```
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │  Router 1 │   │  Router 2 │   │  Router N │   MikroTik RouterOS
   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
         │  RADIUS / API / CoA           │
         └───────────────┬───────────────┘
                 ┌───────▼────────┐        ┌──────────────────┐
                 │    AIRCOINS    │◄───────┤ NodeMCU coin slot│  ESP8266 / ESP32
                 │ Node + SQLite  │        └──────────────────┘
                 └───────┬────────┘        ┌──────────────────┐
                         │                 │  GCash / PayMongo│
                    ┌────▼─────┐           └──────────────────┘
                    │ Admin UI │                 ┌──────────────┐
                    │ Portal   │─────────────────│ Customer WiFi│
                    └──────────┘                 └──────────────┘
```

---

## Why operators switch to AIRCOINS

| The daily headache | What AIRCOINS does instead |
|---|---|
| "I have to log in to every router separately." | One dashboard for every site, one connection list, one search box. |
| "The customer paid but has no internet." | Time is pushed into the **live** session with a RADIUS CoA — no re-login, no "reload your portal". |
| "I don't know how much I sold today." | **Sales Report** aggregates voucher redemptions, GCash payments and per-machine coin counters in one view. |
| "Monthly SaaS per access point kills my margin." | Self-hosted, one-time deploy. Your data stays in your building. |
| "My internet died, so my shop stopped selling." | RADIUS, portal, wallet and ledger all run locally. The LAN keeps working through an ISP outage. |
| "Coins get lost, complaints get denied." | Append-only ledger: every coin, every conversion, every admin adjustment — who, when, how much. |
| "Customers keep asking for their password." | Self-service account with 4-digit PIN; restore codes delivered right into the portal chat. |
| "I want my own brand, not a generic page." | Portal themes, your logo, your coin sounds, admin console themes — all editable from the browser. |

---

## Complete feature list

### 1. Admin console (web, `/admin`)

| Page | What you get |
|---|---|
| **Overview** | Fleet-at-a-glance: total/connected/offline routers, a snapshot of the primary router, and the controller's own health — CPU, memory, disk and server uptime, so a full SD card never surprises you. |
| **Routers** | Add/edit/remove MikroTik peers, one-click connect/disconnect, per-router health, RouterOS API **and** REST-auth modes, per-router RADIUS secret regeneration, and a RADIUS reachability test that proves the router is actually talking to this server. |
| **Hotspot Users** | Create, edit, enable, disable and delete hotspot users; sync straight to the router; purge stale local MAC users left behind by old firmware. |
| **Hotspot Settings** | Full router-side control: hotspot servers, user profiles, IP pools, **walled garden** (pre-login allow list), cookie auth, **IP & MAC bindings**, ARP hosts, and a **one-click hotspot setup** wizard for a brand-new router. |
| **Device control** | Live device list per router with policy per device — **normal / blocked / bypassed** (free access), add-time on the spot, kick a device, block that survives re-login because it is enforced in the RADIUS decision *and* as a router binding. |
| **Interfaces** | Ethernet, VLANs, bridges, EOIP tunnels, IP tunnels, GRE, VRRP and bonding — managed centrally, so a new site can be wired without opening WinBox. |
| **PPP** | PPPoE customers and active sessions for the operators selling wired lines from the same box. |
| **Vouchers** | Batch generation (1–100) with prefix, profile, duration and data cap, lookup, redemption, print-ready output, **MAC-as-voucher** mode where the coin machine issues the code itself. |
| **RADIUS** | A real RADIUS server built in — authentication, accounting, **rate plans** with download/upload caps plus burst, session and idle timeouts, data quotas, validity period, price and shared-user limit, an assignable default plan per router, live sessions, per-router stats, **hitless session extension (CoA)** and **Disconnect-Request**, plus a queryable RADIUS log for support calls. |
| **Chat** | Customers talk to you from the portal; you answer from the admin inbox with an unread badge. Also the delivery channel for wallet restore codes. |
| **Portal** | The customer sign-in page is *yours*: theme switcher (Default (JuanFi) — the legacy PisoWiFi look — plus Gaming, Sunrise, Christmas and Adopisoft), branding/logo upload, coin sounds, a built-in portal file editor, reset-to-default, and **push portal files to any router** in one action. |
| **Online Payment** | GCash / PayMongo checkout with webhook confirmation, payment rate table (the price list used for both GCash and wallet→time conversion), manual credit, status lookup, and payment history. |
| **SubVendo** | Turn trusted resellers into sub-vendors with their own machine configuration, then push it to the router. |
| **Sales Report** | Vouchers + GCash + per-machine coin counters combined into one revenue picture. |
| **Customers / Wallet** | Customer registry with wallet balances, manual balance adjust (credited to the ledger with your reason), suspend/reactivate, forced password reset, pending coin top-up sessions with a cleanup action, and wallet limits (minimum conversion, enabled/disabled). |
| **Tools** | **ZeroTier** install/join/leave so a controller in town can reach a router in another province through the ISP's NAT, **database backup download and restore**, and optional **Turso cloud sync** — push a copy of the ledger off-box, test the link, sync on demand, restore from the cloud. |
| **Appearance** | Admin console themes driven from CSS variables — the dashboard you stare at all day can look like your business. |
| **System Settings** | Branding, sounds, global switches, admin credentials. |

### 2. Customer portal (what the paying public sees)

- **No-app sign-in** — captive portal opens, they insert coins or type a voucher, they are online.
- **Live session panel** — remaining time, upload/download bytes, IP and MAC, expiry state, and a session token that survives the phone locking its screen.
- **Pause / Resume** — a customer can freeze their remaining time instead of burning it.
- **Roaming** — the same paid account follows the device across SSIDs and access points on the same controller; re-authentication is kicked in parallel so the captive portal releases fast.
- **One-shot courtesy window** — an expired account gets just enough access to reach the portal and top up, never a repeatable free ride.
- **Wallet tab** — balance, load-wallet flow, buy-time packages, transaction history.
- **Account tab** — register, sign in with 4-digit PIN, change password/PIN, restore access.
- **Support chat** — right on the portal page, no messenger detour.
- **Works on phones first** — the portal is mobile-first and cache-hostile by design, because phone webviews love to serve a stale sign-in page after you fix one.

### 3. Cash wallet (coins in → internet time out)

- Register with **email + password + full name + mobile + 4-digit PIN**.
- **Load wallet with coins**: tap LOAD WALLET, insert pesos into the machine, tap DONE PAYING — the server reads the machine's own total, so the number is never typed by the customer.
- **Convert balance to time** priced from the same `payment_rates` table as GCash — one price list, no drift between channels.
- **Hitless**: the purchased hours land on the device *while it is connected*.
- Integer-centavos money model with an **append-only ledger** — balance is a derived fact, never a field someone edited.
- Debit + credit run in one transaction: no way to lose money and grant no time.
- **Forgot password** → restore code arrives in the portal chat (SMTP switch is configuration-only for later).
- Rate-limit and lockout on failed logins; token epoch so a reset kills every old session at once.
- Money stays **out** of the Turso cloud sync path by design; the ledger is local-first.

### 4. Coin machine firmware — `JuanFi-nodemcu` (ESP8266 / ESP32)

The PisoWiFi coin-slot firmware that AIRCOINS manages over the network. Firmware is
still published under its JuanFi name; the controller side is AIRCOINS.

Current firmware: **v4.5-SAFEOTA**.

- Coin-pulse counting with **pause expiration** and **codeless** voucher issuance.
- Direct MikroTik integration (the machine can sell time on its own).
- Machine admin page: initial setup, RouterOS connection, SSID setup, coin/promo rate configuration, dashboard and sales report.
- LCD display support, night-light toggle, Wi-Fi SSID scan.
- **Safe OTA** firmware update with image magic-byte validation — a failed flash does not brick the machine.
- Controller-side fleet operations: provision, config push, per-machine rate table, remote restart (machine *and* its router), reset statistics, active-user list, kick a user, per-machine sales and logs, bulk voucher generation, connectivity ping.

### 5. Platform, deployment and operations

- **Runs on the hardware you already own** — Raspberry Pi 3B+ and up, Orange Pi, any x86 Mini PC, Ubuntu/Debian.
- **One-command install** (`deploy/install.sh`), **update** with automatic DB backup, and **clean uninstall**.
- **Docker image** and a **RouterOS container** build path for operators who prefer containers.
- **Custom Ubuntu ISO** tooling (`deploy/iso/`) for shipping pre-flashed installations to a client site.
- **Nginx + Let's Encrypt** setup script for HTTPS-served portals.
- **systemd** service with crash-restart and full journald logging.
- **REST API** covering every feature — build your own app, kiosk or reporting on top.
- **Socket.IO** channel wired into the same HTTP server — the realtime surface is in
  place, dashboards currently refresh on intervals.
- SQLite single-file database: back it up by copying one file, or let Turso keep a rolling cloud copy.
- Lightweight: roughly <100 MB RAM idle and <5 % idle CPU; comfortably handles 50+ routers and 1000+ hotspot users.

### 6. Security posture

- JWT-authenticated API with role separation, admin token for staff and a **separate token scope for customer accounts**.
- bcrypt password **and** wallet-PIN hashing; login throttling with temporary lockout.
- Helmet hardening, path allow-lists on every portal-file endpoint (an unknown path is rejected, not guessed).
- Router credentials scoped per router row; per-router RADIUS secrets with one-click rotation.
- Money is only ever moved through an append-only ledger with the acting admin recorded.
- Every release candidate goes through a deep (L3) security review before it is pushed.

---

## Roadmap — upcoming features

### Building next

| Feature | What it means for you |
|---|---|
| **Email/SMS delivery of restore codes** | The chat delivery works today; the SMTP transport is already interface-shaped and only needs configuration plus an SMS gateway so a customer who cannot open the portal still recovers their account. |
| **RADIUS interim-update accounting backstop** | Enabling `radius-interim-update` on the hotspot profile gives the controller a second, router-initiated path to keep live session time honest — belt and braces beside CoA. |
| **Staff roles and permissions** | Cashier, technician and manager logins with page-level restrictions, so you can hand the shop to an employee without handing them the whole controller. |
| **Data-quota packages in the wallet** | RADIUS plans already carry download/upload quotas and validity periods; the next step is letting customers spend wallet balance on those plans, not only on minutes. |
| **Reseller payouts and commission** | SubVendo today configures sub-vendors; the next step is automatic revenue splitting and a payout statement per reseller. |

### In design

| Feature | What it means for you |
|---|---|
| **Voucher → wallet top-up** | Paused by owner decision while coin funding was proven; the ledger already supports another funding source. |
| **Offline coin-machine queue** | Machines buffer insertions during a controller blip and settle them in order when the link returns — no more "I inserted but nothing happened". |
| **Printed receipt / thermal-printer layout** | Standardized slip per sale and per wallet load. |
| **Usage analytics** | Peak hours per machine, customer churn, package mix, revenue per SSID — the numbers that decide where the next access point goes. |
| **Push notifications for expiring time** | Warn the customer before the countdown dies, so the renewal happens in your portal instead of at a competitor's. |
| **Socket.IO event push** | Move session, device and sales panels from interval polling to server-pushed events — instant counters, less load on a Pi. |

### On the horizon

- Mobile app (or installable PWA) for the owner's pocket view of sales and alerts.
- Multi-tenant hosting so one server can run several separate brands.
- Additional payment rails and QRPh PH-stable QR for non-GCash payers.
- Mesh / CAPsMAN fleet provisioning from the same console.
- Public API key management with scoped tokens for third-party integrators.
- Optional paid support and remote-onboarding service.

### Current limitations (stated plainly)

- A coin **wallet load** still needs a person at the machine to tap DONE PAYING — the total is read from the machine, never typed.
- Routers that send no RADIUS interim updates rely entirely on the CoA path for live time (works today; the accounting backstop is on the list above).
- Wallet restore codes are delivered in the portal chat until the email/SMS transport is switched on.

---

## Tech stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite via better-sqlite3 (optional Turso cloud sync)
- **RADIUS**: purpose-built server (auth 1812 / acct 1813) with CoA 3799 and Disconnect
- **MikroTik**: RouterOS API (8728) and REST
- **Frontend**: vanilla HTML/CSS/JS SPA — no framework, no build step for the UI
- **Realtime**: Socket.IO (connected; interval polling still drives the dashboards — see roadmap)
- **Firmware**: Arduino (ESP8266 / ESP32) with Safe OTA
- **Tests**: Node's built-in test runner with `ts-node/transpile-only`, stubbed router and DB

---

## Quick start

### Prerequisites

- Ubuntu/Debian on an SBC or Mini PC
- Node.js 18+ (installed by the setup script)
- MikroTik router with API enabled (port 8728) or REST/API auth mode

### Install

```bash
git clone <your-repo-url>          # repository: JUANFI-BASED-CENTRALIZED (AIRCOINS controller)
cd JUANFI-BASED-CENTRALIZED
sudo bash deploy/install.sh
```

The installer installs Node.js 20.x if needed, builds the app, creates a
dedicated system user, installs a systemd service and starts the server.

### Open the dashboard

```
http://<your-sbc-ip>:3000          # customer portal
http://<your-sbc-ip>:3000/admin    # admin console
```

Default login `admin` / `admin123` — **change it on first login**.

### Configuration

`/opt/mikrotik-controller/.env`

```bash
PORT=3000
HOST=0.0.0.0
JWT_SECRET=auto-generated-at-install
DB_PATH=/opt/mikrotik-controller/data/mikrotik-controller.db
LOG_LEVEL=info
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123     # first run only
```

```bash
sudo systemctl restart mikrotik-controller
```

### Enable the RouterOS API

WinBox → **IP > Services** → enable **api** (8728) → restrict allowed addresses →
note the username/password. Then **Routers > Add Router**, fill name, host, port,
credentials, and click **Connect**.

### Point the router at the controller's RADIUS

The **Routers** page shows the per-router RADIUS secret. On the router:

```
/radius add address=<controller-ip> secret=<that secret> service=hotspot
/ip hotspot profile set <profile> login-by=http-chap radius
```

AIRCOINS writes the walled-garden entries for you, so the captive portal still
opens while the customer is not yet authenticated.

---

## Usage guides

### Vouchers

**Vouchers** → select router → **Generate Vouchers** → count (1–100), profile,
validity days, data limit in MB, code prefix. Codes are created and synced to the
router; use the print view for a batch of slips.

### Bandwidth

Queues and profiles are managed from **Hotspot Settings** (user profiles, pools)
and RADIUS profiles push `Session-Timeout`, bandwidth and queue attributes at
login — so a package change applies on the next authentication without touching
the router.

### Monitoring

**Overview** and **Routers** report CPU, memory, uptime and interfaces per router
and on the controller itself; history is sampled on a timer and queryable per
router for the last N hours (`GET /api/monitoring/router/:id/history?hours=24`).

### Selling time from coins

Customer taps **LOAD WALLET** on the portal → inserts coins → **DONE PAYING** →
balance appears → chooses a package → **CONVERT TO TIME**. The device is online
with the new countdown immediately.

---

## REST API

Every endpoint except login and the public portal/wallet customer routes needs
`Authorization: Bearer <token>`.

```bash
# login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# use it
curl http://localhost:3000/api/routers -H "Authorization: Bearer <token>"
```

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/change-password`, `GET /api/auth/me` |
| Routers | `GET/POST /api/routers`, `GET/PUT/DELETE /api/routers/:id`, `POST /api/routers/:id/connect|disconnect`, `GET /api/routers/:id/status`, `GET /api/routers/radius/status`, `GET /api/routers/radius/logs`, `POST /api/routers/:id/radius/test`, `POST /api/routers/:id/radius/regenerate-secret` |
| Hotspot | `GET/POST /api/hotspot/router/:routerId`, `PUT /api/hotspot/router/:routerId/:userId`, `DELETE /api/hotspot/router/:routerId/:mikrotikUserId`, `POST .../:mikrotikUserId/enable|disable`, `GET .../active`, `DELETE .../active/:activeId` |
| Devices & sessions | `GET/POST /api/hotspot/router/:routerId/devices`, `PUT .../devices/:deviceId/access`, `POST .../devices/:deviceId/extend`, `GET .../sessions` |
| Hotspot config | `.../profiles`, `.../user-profiles`, `.../pools`, `.../servers`, `.../hosts`, `.../walled-garden`, `.../cookie(s)`, `POST .../setup` |
| Interfaces | `.../interfaces`, `.../interface-lists`, `.../ethernet`, `.../vlans`, `.../bridges`, `.../eoip`, `.../ip-tunnels`, `.../gre`, `.../vrrp`, `.../bonding` |
| PPP | `GET .../active`, `GET/POST .../customers`, `PUT/DELETE .../customers/:customerId`, `POST .../customers/:customerId/enable|disable` |
| Vouchers | `GET .../router/:routerId`, `POST .../generate`, `POST .../:voucherId/use`, `GET .../:code/lookup`, `POST .../print`, `POST /api/vouchers/redeem`, `POST /api/vouchers/coin-auth` |
| RADIUS | `GET /api/radius-profiles/router/:routerId` (+ CRUD), `GET /api/radius-sessions/router/:routerId`, `GET .../active`, `POST .../:sessionId/extend|apply-voucher|terminate`, `GET .../stats` |
| Portal | `GET /api/portal/`, `GET/PUT /api/portal/file/*`, `POST /api/portal/reset/*`, `POST /api/portal/push/:routerId`, `GET /api/portal/check-session`, `POST /api/portal/pause|resume|logout`, `GET /api/portal/vendo-config` |
| Session | `POST /api/session/init|restore|bind|state`, `GET /api/session/token-frame`, `GET /api/session/validity` |
| Wallet (customer) | `GET /api/wallet/config|machines`, `POST /api/wallet/register|login|forgot|reset`, `GET /api/wallet/me|transactions`, `POST /api/wallet/topup/start|claim`, `POST /api/wallet/convert`, `POST /api/wallet/password|pin` |
| Wallet (admin) | `GET /api/wallet/admin/accounts`, `GET /api/wallet/admin/accounts/:id`, `POST .../adjust|status|password`, `GET /api/wallet/admin/summary|topups`, `POST /api/wallet/admin/topups/:id/cleanup`, `GET/PUT /api/wallet/admin/settings` |
| Payments | `GET/PUT /api/payments/settings`, `GET /api/payments/config`, `POST /api/payments/checkout`, `GET /api/payments/status/:reference`, `POST /api/payments/verify`, `POST /api/payments/paymongo/webhook`, `GET/POST/PUT/DELETE /api/payments/rates`, `GET /api/payments/list`, `POST /api/payments/:reference/credit` |
| Coin machines | `GET/POST /api/nodemcu/devices`, `POST /api/nodemcu/devices/:id/provision|restart|restart-mikrotik|reset-stats|generate-vouchers|scan-ssid|kick-user|toggle-night-light`, `GET/PUT .../config`, `GET/PUT .../rates`, `GET .../dashboard|active-users|sales|logs|ping`, `POST /api/nodemcu/coin-insert` |
| SubVendo | `GET/PUT /api/subvendo/config`, `POST /api/subvendo/push/:routerId` |
| Chat | `GET /api/chat/thread`, `POST /api/chat/messages`, `POST /api/chat/read`, `GET /api/chat/threads`, `GET/POST /api/chat/threads/:id/messages`, `POST /api/chat/threads/:id/read`, `GET /api/chat/unread`, `DELETE /api/chat/threads/:id` |
| Monitoring | `GET /api/monitoring/summary`, `GET /api/monitoring/system`, `GET /api/monitoring/router/:routerId/system|interfaces|traffic|history` |
| Sales | `GET /api/sales/report` |
| Settings | `GET /api/settings`, `PUT /api/settings`, `GET /api/settings/branding`, `GET /api/settings/sounds`, `POST/DELETE /api/settings/logo`, `POST/DELETE /api/settings/banner`, `POST /api/settings/sounds/:kind`, `DELETE /api/settings/sounds/:kind` |
| Tools | `GET /api/tools/zerotier/status`, `POST /api/tools/zerotier/install|join|leave`, `GET /api/tools/database/backup`, `POST /api/tools/database/restore`, `GET/POST /api/tools/turso/config`, `POST /api/tools/turso/test|sync|restore` |

---

## Service management

```bash
sudo systemctl status mikrotik-controller
sudo systemctl restart mikrotik-controller
sudo journalctl -u mikrotik-controller -f
sudo journalctl -u mikrotik-controller -n 50 --no-pager
```

### Updating

```bash
cd /path/to/JUANFI-BASED-CENTRALIZED
sudo bash deploy/update.sh      # stops service, backs up DB, pulls, rebuilds, restarts
```

### Uninstalling

```bash
sudo bash deploy/uninstall.sh   # removes service, app files, database and system user
```

### Development

```bash
npm install
npm run dev      # ts-node
npm run build    # tsc -> dist/
npm start

# tests (no `npm test` script — run the runner directly)
node -r ts-node/register/transpile-only --test tests/wallet.test.js
node -r ts-node/register/transpile-only --test tests/radius-devices.test.js
node -r ts-node/register/transpile-only --test tests/portal-themes.test.js
```

---

## Troubleshooting

### Cannot connect to a router

1. **IP > Services > api** enabled on the router.
2. Firewall allows 8728 (or 80/443 for REST mode) from the controller.
3. Username/password verified; check IP restrictions on the user.
4. `ping <router-ip>` and `nc -zv <router-ip> 8728`.

### Customers log in but get no time

1. **RADIUS** page → confirm the router is authenticating against this server and read `radius_logs`.
2. If the device is already connected, time arrives via CoA — the router must be reachable on UDP 3799 with the configured secret.
3. Check the device's access policy: a **blocked** device is intentionally refused.
4. MikroTik `login-by` containing `trial` or leftover local users win over RADIUS — use **Hotspot Settings** purge and one-click setup to clean it.

### Portal shows a stale page after an update

The portal paths are served with `no-cache`, but phone webviews cache hard —
forget the Wi-Fi network and reconnect, then reload.

### Service will not start

```bash
sudo journalctl -u mikrotik-controller -n 50
ls -la /opt/mikrotik-controller
cat /opt/mikrotik-controller/.env
```

### Database

```bash
# backup by copying one file (or use Tools → database backup)
cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db
```

---

## System requirements

| | Minimum | Recommended |
|---|---|---|
| Board | Raspberry Pi 3B+ / Orange Pi | x86 Mini PC |
| RAM | 1 GB | 2 GB |
| Storage | 8 GB SD/eMMC | 16 GB SSD |
| OS | Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 LTS / Debian 12 |

Expected envelope: 50+ concurrent routers, 1000+ hotspot users, <100 MB idle RAM,
<5 % idle CPU.

---

## Production security checklist

1. Change the default admin password immediately.
2. Serve the portal over HTTPS: `deploy/setup-ssl.sh` (Nginx + Let's Encrypt), see `NGINX_SETUP.md`.
3. Restrict API and RADIUS access to your LAN with firewall rules.
4. Rotate each router's RADIUS secret from the Routers page after a staff change.
5. Turn on Turso sync **or** cron the database backup off-box.
6. Keep the OS patched.

Manual Nginx reverse proxy:

```nginx
server {
    listen 80;
    server_name controller.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo ln -s /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d controller.yourdomain.com
```

---

## Repository layout

```
src/                TypeScript backend
  api/              one router per feature (routers, hotspot, wallet, payments, ...)
  services/         RADIUS server, MikroTik client, time-credit, wallet ledger,
                    device sessions, active devices, monitoring, Turso, ZeroTier
  middleware/auth   JWT + role gate
  database.ts       schema, migrations, seed
  server.ts         Express app, mounts, portal/admin serving, realtime
public/             admin SPA (index.html, js/app.js) + customer portal (portal.html)
hotspot/            legacy JuanFi PisoWiFi RouterOS page assets (served as /hotspot-assets)
JuanFi-nodemcu/     ESP8266/ESP32 coin-machine firmware + SPIFFS web files
deploy/             install/update/uninstall, systemd unit, Nginx, SSL, ISO tooling
tests/              node:test suites (router and DB stubbed where needed)
```

More detail lives in `ARCHITECTURE.md`, `PROJECT_SUMMARY.md`, `INSTALLATION.md`,
`QUICKSTART.md`, `NGINX_SETUP.md`, `deploy/ROUTEROS-CONTAINER-GUIDE.md` and
`deploy/CHECKLIST.md`.

---

## License

MIT

## Contributing

Contributions welcome — open an issue or a pull request first, so a feature
direction (see the roadmap above) can be agreed before you write it.

## Support

For issues, questions or deployment help, open an issue on GitHub.
