# Installation Guide - MikroTik Controller

Complete installation instructions for Ubuntu/Debian SBC (Raspberry Pi, Orange Pi, etc.) and Mini PCs.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Hardware Requirements](#hardware-requirements)
- [Installation Methods](#installation-methods)
  - [Method 1: Automated Installation (Recommended)](#method-1-automated-installation-recommended)
  - [Method 2: Manual Installation](#method-2-manual-installation)
- [Post-Installation Setup](#post-installation-setup)
- [MikroTik Router Configuration](#mikrotik-router-configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Updating](#updating)
- [Uninstallation](#uninstallation)

---

## Prerequisites

Before starting, ensure you have:

1. **Ubuntu/Debian Linux** installed on your SBC or Mini PC
   - Ubuntu 20.04 LTS or later (recommended: 22.04 LTS)
   - Debian 11 (Bullseye) or later (recommended: 12 Bookworm)
   
2. **Internet connection** for downloading dependencies

3. **Sudo privileges** on the target system

4. **MikroTik router** with API access enabled (see [MikroTik Router Configuration](#mikrotik-router-configuration))

5. **Basic command line knowledge**

---

## Hardware Requirements

### Minimum (SBC)
- **CPU**: ARM64 or x86_64 processor
- **RAM**: 1GB (2GB recommended)
- **Storage**: 8GB SD card/eMMC (16GB recommended)
- **Network**: Ethernet or WiFi
- **Examples**: 
  - Raspberry Pi 3B+ (1GB RAM)
  - Raspberry Pi 4 (2GB+ RAM recommended)
  - Orange Pi Zero 2
  - Banana Pi M2 Zero

### Recommended (Mini PC)
- **CPU**: Dual-core x86_64 processor
- **RAM**: 2GB or more
- **Storage**: 16GB or more
- **Network**: Gigabit Ethernet
- **Examples**:
  - Intel NUC
  - Gigabyte BRIX
  - Any x86 Mini PC

### Performance Expectations
- **Memory Usage**: ~100MB idle, ~200MB under load
- **CPU Usage**: <5% idle, ~20% under load
- **Storage**: ~50MB installation + database growth
- **Concurrent Routers**: 50+ supported
- **Hotspot Users**: 1000+ supported

---

## Installation Methods

### Method 1: Automated Installation (Recommended)

This method automatically installs all dependencies, builds the application, and sets up the systemd service.

#### Step 1: Update System

```bash
sudo apt update
sudo apt upgrade -y
```

#### Step 2: Install Git (if not already installed)

```bash
sudo apt install git -y
```

#### Step 3: Clone the Repository

```bash
# Choose your installation directory
cd /opt

# Clone from GitHub
sudo git clone https://github.com/Djnirds1984/JUANFI-BASED-CENTRALIZED.git mikrotik-controller

# Navigate to the directory
cd mikrotik-controller
```

**Alternative**: Clone to home directory first, then move:

```bash
# Clone to home directory
cd ~
git clone https://github.com/Djnirds1984/JUANFI-BASED-CENTRALIZED.git
cd JUANFI-BASED-CENTRALIZED

# Move to /opt
sudo mv . /opt/mikrotik-controller
cd /opt/mikrotik-controller
```

#### Step 4: Make Installation Script Executable

```bash
sudo chmod +x deploy/install.sh
```

#### Step 5: Run Installation Script

```bash
sudo bash deploy/install.sh
```

The script will:
- Install Node.js 20.x if not present
- Install required system dependencies
- Create a dedicated system user
- Install npm packages
- Build the TypeScript application
- Set up the database
- Configure environment variables
- Install systemd service
- Start the service

**Expected output:**
```
==========================================
  MikroTik Controller - Installation
  For Ubuntu/Debian SBC & Mini PC
==========================================

Detected architecture: arm64
[1/7] Updating package lists...
[2/7] Installing dependencies...
[3/7] Installing Node.js 20.x...
  Node.js: v20.x.x
  npm: 10.x.x
[4/7] Creating application user...
  Created user: mikrotik-controller
[5/7] Setting up application directory...
  Created .env file with random JWT secret

  *** DEFAULT LOGIN: admin / admin123 ***
  *** CHANGE PASSWORD ON FIRST LOGIN! ***

[6/7] Installing systemd service...
[7/7] Starting service...

==========================================
  Installation Complete!
==========================================

  Service: sudo systemctl status mikrotik-controller
  Logs:    sudo journalctl -u mikrotik-controller -f
  URL:     http://192.168.x.x:3000

  Default login: admin / admin123
  CHANGE PASSWORD ON FIRST LOGIN!

  Configuration: /opt/mikrotik-controller/.env
  Database:      /opt/mikrotik-controller/data/
==========================================
```

#### Step 6: Note the URL

The installation script will display the URL to access the dashboard. Note this URL:

```
http://<your-device-ip>:3000
```

To find your device IP:

```bash
hostname -I
```

---

### Method 2: Manual Installation

Use this method if you prefer manual control over the installation process.

#### Step 1: Update System

```bash
sudo apt update
sudo apt upgrade -y
```

#### Step 2: Install Dependencies

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install other dependencies
sudo apt install -y git build-essential sqlite3
```

Verify installation:

```bash
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
git --version    # Should show git version 2.x.x
```

#### Step 3: Clone the Repository

```bash
cd /opt
sudo git clone https://github.com/Djnirds1984/JUANFI-BASED-CENTRALIZED.git mikrotik-controller
cd mikrotik-controller
```

#### Step 4: Create System User

```bash
sudo useradd -r -m -d /opt/mikrotik-controller -s /usr/sbin/nologin mikrotik-controller
```

#### Step 5: Install NPM Dependencies

```bash
sudo npm install
```

#### Step 6: Build the Application

```bash
sudo npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

#### Step 7: Create Data Directory

```bash
sudo mkdir -p data
```

#### Step 8: Configure Environment

```bash
# Copy example environment file
sudo cp .env.example .env

# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Edit the .env file
sudo nano .env
```

Update the `.env` file:

```bash
# Server Configuration
PORT=3000
HOST=0.0.0.0

# JWT Secret (use the generated value)
JWT_SECRET=<paste-your-generated-secret-here>

# Database
DB_PATH=/opt/mikrotik-controller/data/mikrotik-controller.db

# Logging
LOG_LEVEL=info

# Default Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

Save and exit (Ctrl+X, Y, Enter).

Set proper permissions:

```bash
sudo chmod 600 .env
```

#### Step 9: Set Permissions

```bash
sudo chown -R mikrotik-controller:mikrotik-controller /opt/mikrotik-controller
```

#### Step 10: Install Systemd Service

```bash
# Copy service file
sudo cp deploy/mikrotik-controller.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable mikrotik-controller

# Start the service
sudo systemctl start mikrotik-controller
```

#### Step 11: Verify Service Status

```bash
sudo systemctl status mikrotik-controller
```

Expected output:

```
● mikrotik-controller.service - MikroTik Controller Server
   Loaded: loaded (/etc/systemd/system/mikrotik-controller.service; enabled; vendor preset: enabled)
   Active: active (running) since ...
```

---

## Post-Installation Setup

### Step 1: Access the Web Dashboard

Open your web browser and navigate to:

```
http://<your-device-ip>:3000
```

Replace `<your-device-ip>` with your device's IP address (e.g., `192.168.1.100`).

To find your IP:

```bash
hostname -I
```

### Step 2: Login

Use the default credentials:

- **Username**: `admin`
- **Password**: `admin123`

### Step 3: Change Default Password (CRITICAL)

**IMPORTANT**: Change the default password immediately!

1. After logging in, look for your username in the top-right corner
2. Click on it and select "Change Password"
3. Enter a strong password (minimum 6 characters)
4. Save the new password

**Alternative**: Edit the `.env` file to change the default admin password:

```bash
sudo nano /opt/mikrotik-controller/.env
```

Change:

```bash
ADMIN_PASSWORD=your-new-secure-password
```

Then restart the service:

```bash
sudo systemctl restart mikrotik-controller
```

**Note**: This only affects the initial admin user creation. If the user already exists, use the web interface to change the password.

### Step 4: Configure Firewall (Optional)

If you have UFW firewall enabled:

```bash
# Allow SSH (if not already allowed)
sudo ufw allow ssh

# Allow web interface
sudo ufw allow 3000/tcp

# Enable firewall (if not already enabled)
sudo ufw enable

# Check status
sudo ufw status
```

**For production**: Consider restricting access to specific IPs:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

---

## MikroTik Router Configuration

Before adding routers to the controller, you need to enable API access on each MikroTik router.

### Step 1: Enable API Service

**Using WinBox:**

1. Connect to your MikroTik router using WinBox
2. Go to **IP** → **Services**
3. Find the **api** service (port 8728)
4. Double-click to edit
5. Check the box to enable the service
6. Set **Available From** (optional):
   - Leave blank for all IPs
   - Or set to your controller's IP (e.g., `192.168.1.100/32`)
7. Click **OK**

**Using WebFig:**

1. Open your router's web interface (http://router-ip)
2. Go to **IP** → **Services**
3. Find **api** and click the edit icon
4. Enable the service
5. Set allowed addresses (optional)
6. Click **Apply**

**Using Terminal:**

```bash
# Connect via SSH or terminal
/ip service enable api
/ip service set api address=192.168.1.100/32  # Optional: restrict to controller IP
```

### Step 2: Verify API Port

Test connectivity from your controller:

```bash
# Install telnet if needed
sudo apt install telnet -y

# Test connection to router API port
telnet <router-ip> 8728
```

If successful, you'll see a connection message. Press Ctrl+] and type 'quit' to exit.

### Step 3: Create API User (Optional but Recommended)

For better security, create a dedicated API user:

**Using WinBox:**

1. Go to **System** → **Users**
2. Click **Add** (+)
3. Set **Name**: `api-user`
4. Set **Password**: (strong password)
5. Set **Address**: (optional - restrict to controller IP)
6. Go to **Groups** tab
7. Add to **full** group (or create custom group with specific permissions)
8. Click **OK**

**Required Permissions:**
- `read` - View configuration
- `write` - Modify configuration
- `api` - API access
- `hotspot` - Hotspot management (if managing hotspot users)
- `policy` - Policy management (if managing queues)

### Step 4: Note Router Credentials

You'll need:
- Router IP address
- API port (default: 8728)
- Username (admin or api-user)
- Password

---

## Verification

### Step 1: Check Service Status

```bash
sudo systemctl status mikrotik-controller
```

Should show: `active (running)`

### Step 2: Check Logs

```bash
# View recent logs
sudo journalctl -u mikrotik-controller -n 50 --no-pager

# Follow logs in real-time
sudo journalctl -u mikrotik-controller -f
```

Look for:
```
Initializing database...
Initializing admin user...
Starting monitoring scheduler...
MikroTik Controller Server
URL: http://0.0.0.0:3000
```

### Step 3: Test Web Interface

1. Open browser: `http://<device-ip>:3000`
2. Login with admin credentials
3. Verify dashboard loads correctly

### Step 4: Test API

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response:
# {"status":"ok","uptime":123.45,"timestamp":"2024-01-01T12:00:00.000Z"}
```

### Step 5: Add Your First Router

1. Login to web dashboard
2. Go to **Routers** page
3. Click **Add Router**
4. Enter router details:
   - **Name**: Main Router
   - **Host**: 192.168.1.1 (your router IP)
   - **Port**: 8728
   - **Username**: admin (or api-user)
   - **Password**: (router password)
5. Click **Add Router**
6. Click **Connect** button
7. Verify status shows "Online"

### Step 6: Test Features

**Test Hotspot Management:**
1. Go to **Hotspot Users** page
2. Select your router
3. Verify user list loads (may be empty)

**Test Monitoring:**
1. Go to **Monitoring** page
2. Verify CPU/memory data displays
3. Wait 5 minutes and refresh to see new data

**Test Voucher Generation:**
1. Go to **Vouchers** page
2. Click **Generate Vouchers**
3. Generate 5 test vouchers
4. Verify they appear in the list

---

## Troubleshooting

### Service Won't Start

**Check logs:**

```bash
sudo journalctl -u mikrotik-controller -n 100 --no-pager
```

**Common issues:**

1. **Port already in use:**
   ```bash
   # Check what's using port 3000
   sudo lsof -i :3000
   
   # Stop the conflicting service or change port in .env
   sudo nano /opt/mikrotik-controller/.env
   # Change PORT=3000 to PORT=3001
   
   sudo systemctl restart mikrotik-controller
   ```

2. **Permission denied:**
   ```bash
   # Fix permissions
   sudo chown -R mikrotik-controller:mikrotik-controller /opt/mikrotik-controller
   sudo systemctl restart mikrotik-controller
   ```

3. **Database errors:**
   ```bash
   # Check database file permissions
   ls -la /opt/mikrotik-controller/data/
   
   # If corrupt, backup and reset
   sudo cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db
   sudo rm /opt/mikrotik-controller/data/mikrotik-controller.db
   sudo systemctl restart mikrotik-controller
   ```

### Cannot Access Web Interface

**Check if service is running:**

```bash
sudo systemctl status mikrotik-controller
```

**Check if port is listening:**

```bash
sudo netstat -tlnp | grep 3000
```

**Test locally:**

```bash
curl http://localhost:3000
```

**Check firewall:**

```bash
sudo ufw status
sudo ufw allow 3000/tcp
```

**Check from another device:**

```bash
# From another computer on same network
ping <device-ip>
telnet <device-ip> 3000
```

### Cannot Connect to MikroTik Router

**Error: "Connection failed"**

1. **Verify API is enabled on router:**
   ```bash
   # From controller
   telnet <router-ip> 8728
   ```

2. **Check router IP is correct:**
   ```bash
   ping <router-ip>
   ```

3. **Verify credentials:**
   - Username is correct
   - Password is correct
   - User has API permissions

4. **Check firewall on router:**
   ```bash
   # On MikroTik
   /ip firewall filter print
   # Ensure API port is not blocked
   ```

5. **Check allowed addresses:**
   ```bash
   # On MikroTik
   /ip service print
   # Verify controller IP is allowed
   ```

### High Memory Usage

**Check current usage:**

```bash
sudo systemctl status mikrotik-controller
# Look for Memory: line
```

**Reduce monitoring frequency:**

```bash
sudo nano /opt/mikrotik-controller/.env
# Add: MONITOR_INTERVAL=10  (change from 5 to 10 minutes)

sudo systemctl restart mikrotik-controller
```

**Clear old monitoring data:**

```bash
sqlite3 /opt/mikrotik-controller/data/mikrotik-controller.db \
  "DELETE FROM monitoring_logs WHERE recorded_at < datetime('now', '-7 days');"
```

### Database Locked Errors

**Stop service:**

```bash
sudo systemctl stop mikrotik-controller
```

**Check database integrity:**

```bash
sqlite3 /opt/mikrotik-controller/data/mikrotik-controller.db "PRAGMA integrity_check;"
```

**If corrupt, restore from backup:**

```bash
sudo cp ~/backup.db /opt/mikrotik-controller/data/mikrotik-controller.db
sudo chown mikrotik-controller:mikrotik-controller /opt/mikrotik-controller/data/mikrotik-controller.db
sudo systemctl start mikrotik-controller
```

### Node.js Version Issues

**Check version:**

```bash
node --version
```

**If version < 18, upgrade:**

```bash
# Remove old version
sudo apt remove nodejs -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version
```

---

## Updating

### Automated Update

```bash
# Navigate to installation directory
cd /opt/mikrotik-controller

# Pull latest changes
sudo git pull origin main

# Run update script
sudo bash deploy/update.sh
```

The update script will:
1. Stop the service
2. Backup the database
3. Install new dependencies
4. Rebuild the application
5. Restart the service

### Manual Update

```bash
# Stop service
sudo systemctl stop mikrotik-controller

# Backup database
sudo cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup-$(date +%Y%m%d).db

# Pull changes
cd /opt/mikrotik-controller
sudo git pull origin main

# Install dependencies
sudo npm install

# Rebuild
sudo npm run build

# Fix permissions
sudo chown -R mikrotik-controller:mikrotik-controller /opt/mikrotik-controller

# Start service
sudo systemctl start mikrotik-controller

# Check status
sudo systemctl status mikrotik-controller
```

---

## Uninstallation

### Automated Uninstallation

```bash
cd /opt/mikrotik-controller
sudo bash deploy/uninstall.sh
```

This will:
- Stop the service
- Remove systemd service
- Delete application files
- Remove system user
- Delete all data

**WARNING**: This cannot be undone!

### Manual Uninstallation

```bash
# Stop service
sudo systemctl stop mikrotik-controller

# Disable service
sudo systemctl disable mikrotik-controller

# Remove service file
sudo rm /etc/systemd/system/mikrotik-controller.service
sudo systemctl daemon-reload

# Remove application directory
sudo rm -rf /opt/mikrotik-controller

# Remove system user
sudo userdel -r mikrotik-controller

# Remove firewall rules (if added)
sudo ufw delete allow 3000/tcp
```

---

## Next Steps

After successful installation:

1. **Add Your Routers**
   - Go to Routers page
   - Add all your MikroTik routers
   - Test connections

2. **Set Up HTTPS (Recommended for Production)**
   - Install Nginx as reverse proxy
   - Get Let's Encrypt SSL certificate
   - See README.md for detailed guide

3. **Configure Backups**
   - Set up automated database backups
   - Store backups off-site
   - Test restore procedure

4. **Create Additional Admin Users**
   - Add users via API or database
   - Assign appropriate roles

5. **Set Up Monitoring Alerts**
   - Configure email/webhook notifications
   - Set thresholds for CPU/memory

6. **Review Security**
   - Change all default passwords
   - Restrict API access by IP
   - Enable HTTPS
   - Review firewall rules

---

## Support

For issues, questions, or contributions:

- **GitHub Issues**: https://github.com/Djnirds1984/JUANFI-BASED-CENTRALIZED/issues
- **Documentation**: See README.md and QUICKSTART.md
- **Architecture**: See ARCHITECTURE.md

---

## Quick Reference Commands

```bash
# Service management
sudo systemctl start mikrotik-controller
sudo systemctl stop mikrotik-controller
sudo systemctl restart mikrotik-controller
sudo systemctl status mikrotik-controller

# View logs
sudo journalctl -u mikrotik-controller -f
sudo journalctl -u mikrotik-controller -n 100 --no-pager

# Check service
sudo systemctl is-active mikrotik-controller
sudo systemctl is-enabled mikrotik-controller

# Edit configuration
sudo nano /opt/mikrotik-controller/.env

# Restart after config change
sudo systemctl restart mikrotik-controller

# Backup database
sudo cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db

# Check disk space
df -h /opt/mikrotik-controller

# Check memory usage
free -h

# Check service resource usage
sudo systemctl status mikrotik-controller
```

---

**Installation complete! Your MikroTik Controller is ready to use.**

Access the dashboard at: `http://<your-device-ip>:3000`
