# Quick Start Guide

## For Development (Windows/Linux/Mac)

1. **Install Node.js 18+** from https://nodejs.org/

2. **Clone and setup:**
   ```bash
   git clone <your-repo-url>
   cd JUANFI-BASED-CENTRALIZED
   npm install
   ```

3. **Create .env file:**
   ```bash
   cp .env.example .env
   ```

4. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

5. **Open browser:**
   ```
   http://localhost:3000
   ```

6. **Login:**
   - Username: `admin`
   - Password: `admin123`

## For Production (Ubuntu/Debian SBC or Mini PC)

1. **Copy files to your SBC/Mini PC:**
   ```bash
   scp -r ./* user@your-sbc:/path/to/mikrotik-controller/
   ```

2. **SSH into your device:**
   ```bash
   ssh user@your-sbc
   cd /path/to/mikrotik-controller
   ```

3. **Run installation script:**
   ```bash
   sudo bash deploy/install.sh
   ```

4. **Access the dashboard:**
   ```
   http://<your-sbc-ip>:3000
   ```

## First Steps After Installation

### 1. Add Your First Router

1. Open the web dashboard
2. Go to **Routers** page
3. Click **Add Router**
4. Enter your MikroTik details:
   - Name: "Main Router"
   - Host: 192.168.1.1 (your router IP)
   - Port: 8728
   - Username: admin
   - Password: (your router password)
5. Click **Add Router**
6. Click **Connect**

### 2. Create Hotspot Users

1. Go to **Hotspot Users** page
2. Select your router
3. Click **Add User**
4. Enter username, password, and profile
5. Click **Add User**

### 3. Generate Vouchers

1. Go to **Vouchers** page
2. Click **Generate Vouchers**
3. Set quantity and options
4. Click **Generate**
5. Print or distribute the voucher codes

### 4. Monitor Your Routers

1. Go to **Monitoring** page
2. View CPU, memory, and uptime
3. Check historical data

## Common Tasks

### Change Admin Password

1. Login to dashboard
2. Click your username (top right)
3. Select **Change Password**
4. Enter new password

### Backup Database

```bash
# On SBC/Mini PC
sudo cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup-$(date +%Y%m%d).db
```

### View Logs

```bash
# Service logs
sudo journalctl -u mikrotik-controller -f

# Last 50 lines
sudo journalctl -u mikrotik-controller -n 50
```

### Restart Service

```bash
sudo systemctl restart mikrotik-controller
```

### Update to New Version

```bash
cd /path/to/mikrotik-controller
sudo bash deploy/update.sh
```

## MikroTik Router Configuration

### Enable API Access

1. Open WinBox
2. Go to **IP > Services**
3. Find **api** service
4. Double-click to edit
5. Check the box to enable
6. Set port (default: 8728)
7. Set allowed addresses (optional, or leave blank for all)
8. Click **OK**

### Create Hotspot Profile

1. Go to **IP > Hotspot > User Profiles**
2. Click **Add** (+)
3. Set name (e.g., "default", "premium", "guest")
4. Configure rate limits, time limits, etc.
5. Click **OK**

### Test API Connection

From your SBC/Mini PC:

```bash
# Install telnet if needed
sudo apt install telnet

# Test connection
telnet <router-ip> 8728
```

If you see a connection, the API is accessible.

## Troubleshooting

### Cannot Connect to Router

**Problem:** "Connection failed" error

**Solutions:**
1. Verify router IP is correct
2. Check API is enabled (IP > Services > api)
3. Verify username/password
4. Check firewall on router allows API port
5. Test from SBC: `ping <router-ip>`
6. Test port: `telnet <router-ip> 8728`

### Service Won't Start

**Problem:** Service fails to start

**Solutions:**
```bash
# Check logs
sudo journalctl -u mikrotik-controller -n 50

# Check permissions
ls -la /opt/mikrotik-controller

# Verify Node.js version
node --version

# Reinstall if needed
sudo bash deploy/uninstall.sh
sudo bash deploy/install.sh
```

### Database Errors

**Problem:** Database locked or corrupt

**Solutions:**
```bash
# Stop service
sudo systemctl stop mikrotik-controller

# Backup current database
sudo cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db

# Check database integrity
sqlite3 /opt/mikrotik-controller/data/mikrotik-controller.db "PRAGMA integrity_check;"

# If corrupt, restore from backup or reset
sudo rm /opt/mikrotik-controller/data/mikrotik-controller.db
sudo systemctl start mikrotik-controller
```

### High Memory Usage

**Problem:** Service using too much RAM

**Solutions:**
1. Reduce monitoring interval (edit `.env`, add `MONITOR_INTERVAL=10`)
2. Clear old monitoring logs:
   ```bash
   sqlite3 /opt/mikrotik-controller/data/mikrotik-controller.db \
     "DELETE FROM monitoring_logs WHERE recorded_at < datetime('now', '-7 days');"
   ```
3. Restart service: `sudo systemctl restart mikrotik-controller`

## API Examples

### Using curl

```bash
# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# List routers
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/routers

# Get router status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/routers/1/status

# Create hotspot user
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"pass123","profile":"default"}' \
  http://localhost:3000/api/hotspot/router/1

# Generate vouchers
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count":10,"profile":"default","prefix":"WIFI"}' \
  http://localhost:3000/api/vouchers/router/1/generate
```

### Using Python

```python
import requests

BASE_URL = 'http://localhost:3000/api'

# Login
response = requests.post(f'{BASE_URL}/auth/login', json={
    'username': 'admin',
    'password': 'admin123'
})
token = response.json()['token']

headers = {'Authorization': f'Bearer {token}'}

# List routers
routers = requests.get(f'{BASE_URL}/routers', headers=headers).json()
print(routers)

# Get router status
status = requests.get(f'{BASE_URL}/routers/1/status', headers=headers).json()
print(status)
```

## Next Steps

- Set up HTTPS with Nginx and Let's Encrypt (see README.md)
- Configure automatic backups
- Set up monitoring alerts
- Create additional admin users
- Integrate with external systems via API

## Support

For more information, see the full [README.md](README.md).
