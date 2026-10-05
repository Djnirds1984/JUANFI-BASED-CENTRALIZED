# MikroTik Controller Server

A lightweight, centralized controller for managing MikroTik routers from SBC boards (Raspberry Pi, Orange Pi, etc.) or Mini PCs running Ubuntu/Debian.

## Features

- **Multi-Router Management** - Control multiple MikroTik routers from a single interface
- **Hotspot User Management** - Create, edit, enable/disable hotspot users
- **Bandwidth Control** - Manage queues and bandwidth profiles per router
- **Voucher System** - Generate and manage hotspot vouchers with codes
- **Real-time Monitoring** - CPU, memory, uptime tracking with historical data
- **REST API** - Full API for automation and integration
- **Web Dashboard** - Responsive admin interface
- **SBC Optimized** - Lightweight, runs on Raspberry Pi and other ARM boards

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite (via better-sqlite3)
- **MikroTik API**: RouterOS API protocol (port 8728)
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build step needed)
- **Real-time**: Socket.IO

## Quick Start

### Prerequisites

- Ubuntu/Debian Linux (SBC or Mini PC)
- Node.js 18+ (installed automatically by setup script)
- MikroTik router with API enabled (default port 8728)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd JUANFI-BASED-CENTRALIZED

# Run the installation script
sudo bash deploy/install.sh
```

The installer will:
1. Install Node.js 20.x if needed
2. Build the application
3. Create a dedicated system user
4. Install as a systemd service
5. Start the server

### Access the Dashboard

After installation, open your browser:

```
http://<your-sbc-ip>:3000
```

**Default Login:**
- Username: `admin`
- Password: `admin123`

**IMPORTANT:** Change the default password on first login!

## Configuration

Edit `/opt/mikrotik-controller/.env`:

```bash
# Server
PORT=3000
HOST=0.0.0.0

# JWT Secret (auto-generated during install)
JWT_SECRET=your-secret-key

# Database
DB_PATH=/opt/mikrotik-controller/data/mikrotik-controller.db

# Logging
LOG_LEVEL=info

# Admin Credentials (used on first run only)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

After editing, restart the service:

```bash
sudo systemctl restart mikrotik-controller
```

## MikroTik Router Setup

Enable API access on your MikroTik router:

1. Open WinBox or WebFig
2. Go to **IP > Services**
3. Find **api** (port 8728)
4. Enable it and set allowed addresses (or leave open for testing)
5. Note the username/password (default: admin)

### Adding a Router

1. Open the web dashboard
2. Go to **Routers** page
3. Click **Add Router**
4. Enter:
   - Name: Friendly name (e.g., "Main Router")
   - Host: IP address (e.g., 192.168.1.1)
   - Port: 8728 (default)
   - Username: Router API username
   - Password: Router API password
5. Click **Add Router**
6. Click **Connect** to establish connection

## Usage Guide

### Hotspot Users

Manage hotspot users on connected routers:

1. Go to **Hotspot Users** page
2. Select a router from the dropdown
3. Click **Add User** to create a new hotspot user
4. Assign a profile (must exist on the router)
5. Users are synced to the router immediately

### Bandwidth Management

Control bandwidth per user or subnet:

1. Go to **Bandwidth** page
2. Select a router
3. Click **Add Queue**
4. Set:
   - Name: Queue name
   - Target: IP/subnet (e.g., 192.168.1.100 or 192.168.1.0/24)
   - Max Limit: e.g., 10M/10M (10 Mbps up/down)
   - Priority: 1-8 (1 = highest)

### Voucher System

Generate hotspot vouchers for users:

1. Go to **Vouchers** page
2. Select a router
3. Click **Generate Vouchers**
4. Set:
   - Number of vouchers (1-100)
   - Profile: Hotspot profile name
   - Duration: Days valid (optional)
   - Data Limit: MB limit (optional)
   - Prefix: Code prefix (e.g., "WIFI")
5. Vouchers are created and synced to the router

### Monitoring

View router health and performance:

1. Go to **Monitoring** page
2. See CPU load, memory usage, uptime
3. Progress bars show resource utilization
4. Data is collected every 5 minutes automatically

## REST API

All endpoints require authentication via Bearer token.

### Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Response: {"token":"eyJhbGc..."}

# Use token in subsequent requests
curl http://localhost:3000/api/routers \
  -H "Authorization: Bearer eyJhbGc..."
```

### Routers

```bash
# List all routers
GET /api/routers

# Get router details
GET /api/routers/:id

# Add router
POST /api/routers
{
  "name": "Main Router",
  "host": "192.168.1.1",
  "port": 8728,
  "username": "admin",
  "password": "password",
  "description": "Office router"
}

# Connect to router
POST /api/routers/:id/connect

# Disconnect
POST /api/routers/:id/disconnect

# Get system info
GET /api/routers/:id/status
```

### Hotspot Users

```bash
# List hotspot users (from router)
GET /api/hotspot/router/:routerId

# Create user
POST /api/hotspot/router/:routerId
{
  "username": "user1",
  "password": "pass123",
  "profile": "default",
  "comment": "Guest user"
}

# Delete user
DELETE /api/hotspot/router/:routerId/:mikrotikUserId

# Get active connections
GET /api/hotspot/router/:routerId/active

# Get profiles
GET /api/hotspot/router/:routerId/profiles
```

### Bandwidth

```bash
# List queues
GET /api/bandwidth/router/:routerId/queues

# Create queue
POST /api/bandwidth/router/:routerId/queues
{
  "name": "Guest WiFi",
  "target": "192.168.1.0/24",
  "maxLimit": "5M/5M",
  "priority": 8
}

# Delete queue
DELETE /api/bandwidth/router/:routerId/queues/:queueId
```

### Vouchers

```bash
# List vouchers
GET /api/vouchers/router/:routerId

# Generate vouchers
POST /api/vouchers/router/:routerId/generate
{
  "count": 10,
  "profile": "default",
  "durationMinutes": 43200,
  "dataLimitMb": 1024,
  "prefix": "WIFI"
}

# Delete voucher
DELETE /api/vouchers/router/:routerId/:voucherId
```

### Monitoring

```bash
# Get summary of all routers
GET /api/monitoring/summary

# Get router system info
GET /api/monitoring/router/:routerId/system

# Get interfaces
GET /api/monitoring/router/:routerId/interfaces

# Get monitoring history
GET /api/monitoring/router/:routerId/history?hours=24
```

## Service Management

```bash
# Check status
sudo systemctl status mikrotik-controller

# Start
sudo systemctl start mikrotik-controller

# Stop
sudo systemctl stop mikrotik-controller

# Restart
sudo systemctl restart mikrotik-controller

# View logs
sudo journalctl -u mikrotik-controller -f

# View last 50 log lines
sudo journalctl -u mikrotik-controller -n 50 --no-pager
```

## Updating

```bash
cd /path/to/JUANFI-BASED-CENTRALIZED
sudo bash deploy/update.sh
```

The update script:
1. Stops the service
2. Backs up the database
3. Pulls latest code
4. Rebuilds the application
5. Restarts the service

## Uninstalling

```bash
sudo bash deploy/uninstall.sh
```

This removes:
- Systemd service
- Application files
- Database and all data
- System user

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Troubleshooting

### Cannot connect to router

1. Verify API is enabled on MikroTik (IP > Services > api)
2. Check firewall rules on both devices
3. Verify username/password
4. Test connectivity: `ping <router-ip>`
5. Check API port: `telnet <router-ip> 8728`

### Service won't start

```bash
# Check logs
sudo journalctl -u mikrotik-controller -n 50

# Check permissions
ls -la /opt/mikrotik-controller

# Verify .env file
cat /opt/mikrotik-controller/.env
```

### Database errors

```bash
# Backup current database
cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db

# Reset database (WARNING: deletes all data)
sudo rm /opt/mikrotik-controller/data/mikrotik-controller.db
sudo systemctl restart mikrotik-controller
```

## System Requirements

### Minimum (SBC)
- Raspberry Pi 3B+ or equivalent
- 1GB RAM
- 8GB SD card / eMMC
- Ubuntu 20.04+ / Debian 11+

### Recommended (Mini PC)
- Dual-core CPU
- 2GB RAM
- 16GB storage
- Ubuntu 22.04 LTS / Debian 12

### Performance
- Supports 50+ concurrent routers
- Handles 1000+ hotspot users
- <100MB RAM usage (idle)
- <5% CPU usage (idle)

## Security Notes

1. **Change default password** immediately after first login
2. **Use HTTPS** in production (configure reverse proxy with Let's Encrypt)
3. **Restrict API access** using firewall rules
4. **Regular backups** of the database
5. **Keep system updated** with security patches

### Setting up HTTPS (Recommended)

Use Nginx as reverse proxy:

```bash
sudo apt install nginx certbot python3-certbot-nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/mikrotik-controller
```

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
# Enable site
sudo ln -s /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d controller.yourdomain.com
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or pull request.

## Support

For issues, questions, or contributions, please open an issue on GitHub.
