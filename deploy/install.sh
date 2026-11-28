#!/bin/bash
set -e

# MikroTik Controller Installation Script
# For Ubuntu/Debian SBC (Raspberry Pi, Orange Pi, etc.) and Mini PCs

APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"
APP_USER="$APP_NAME"
NODE_MIN_VERSION="18"

echo "=========================================="
echo "  MikroTik Controller - Installation"
echo "  For Ubuntu/Debian SBC & Mini PC"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

# Detect architecture
ARCH=$(dpkg --print-architecture)
echo "Detected architecture: $ARCH"

# Update package lists
echo "[1/9] Updating package lists..."
apt-get update -qq

# Install dependencies
echo "[2/9] Installing dependencies..."
apt-get install -y -qq curl build-essential git sqlite3 acl python3 > /dev/null 2>&1

# Check Node.js installation
echo "[3/9] Checking Node.js installation..."

# Try to find node using which, then common locations, then any nvm install.
# (Deliberately not named NODE_PATH - that is a real Node.js environment
# variable and exporting it from here would break module resolution later.)
NODE_BIN=""
find_node() {
    if command -v node &>/dev/null; then
        NODE_BIN=$(which node)
        return 0
    fi
    for path in /usr/bin/node /usr/local/bin/node; do
        if [ -x "$path" ]; then
            NODE_BIN="$path"
            return 0
        fi
    done
    # nvm keeps real binaries under ~/.nvm/versions/node/*/bin even when it was
    # never loaded into this shell - which is always the case under sudo
    for home in /home/* /root; do
        for bin in "$home/.nvm/versions/node"/*/bin/node; do
            if [ -x "$bin" ]; then
                NODE_BIN="$bin"
                return 0
            fi
        done
    done
    return 1
}

find_node || true

# A freshly flashed SBC/mini PC has no Node at all - install it instead of
# dying here. Same source the ISO post-install uses, so every box lands on
# the v20 LTS the app is developed against.
if [ -z "$NODE_BIN" ]; then
    echo "  Node.js not found - installing Node.js 20.x from NodeSource..."
    if curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1 && \
       apt-get install -y -qq nodejs > /dev/null 2>&1; then
        hash -r 2>/dev/null || true
        find_node || true
    fi
    if [ -z "$NODE_BIN" ]; then
        echo "  ERROR: automatic Node.js install failed (no internet, or this"
        echo "  distro is not Debian/Ubuntu). Install Node.js v$NODE_MIN_VERSION+ manually,"
        echo "  then re-run this script:"
        echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
        echo "  Or with nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash && nvm install 20"
        exit 1
    fi
    echo "  Node.js installed automatically - OK"
fi

NODE_VERSION=$("$NODE_BIN" -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
    echo "  ERROR: Node.js version too old ($("$NODE_BIN" -v)). Need v$NODE_MIN_VERSION or higher."
    echo "  Install Node.js manually and re-run this script."
    exit 1
fi
echo "  Node.js $("$NODE_BIN" -v) found at $NODE_BIN - OK"
# Add to PATH for this script
export PATH="$(dirname "$NODE_BIN"):$PATH"

echo "  Node.js: $(node -v 2>/dev/null || echo 'not installed')"
echo "  npm: $(npm -v 2>/dev/null || echo 'not installed')"

# Create application user
echo "[4/9] Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -d /opt/$APP_NAME -s /usr/sbin/nologin "$APP_USER"
    echo "  Created user: $APP_USER"
else
    echo "  User $APP_USER already exists"
fi

# Create application directory
echo "[5/9] Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/data"

# Copy application files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check if running from the install directory itself
if [ "$(cd "$SCRIPT_DIR" && pwd)" = "$(cd "$APP_DIR" && pwd 2>/dev/null)" ]; then
    SAME_DIR=true
    echo "  Running from installation directory, skipping file copy..."
else
    SAME_DIR=false
fi

if [ "$SAME_DIR" = false ]; then
    if [ -d "$SCRIPT_DIR/dist" ]; then
        echo "  Copying built application..."
        rm -rf "$APP_DIR/dist"
        cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
        rm -rf "$APP_DIR/public"
        cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
        cp -f "$SCRIPT_DIR/package.json" "$APP_DIR/"
    else
        echo "  No build found. Building application..."
        cd "$SCRIPT_DIR"
        npm install --production=false
        npm run build
        rm -rf "$APP_DIR/dist"
        cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
        rm -rf "$APP_DIR/public"
        cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
        cp -f "$SCRIPT_DIR/package.json" "$APP_DIR/"
    fi
fi

# Firmware images offered by Tools > SubVendo Flasher. They are committed next to
# the source releases, so mirror them into firmware/ where the tools API looks.
if [ "$SAME_DIR" = false ] && [ -d "$SCRIPT_DIR/aircoins-nodemcu" ]; then
    mkdir -p "$APP_DIR/firmware"
    cp "$SCRIPT_DIR"/aircoins-nodemcu/AirCoins-v*.bin "$APP_DIR/firmware/" 2>/dev/null || true
fi

# dist/ is gitignored, so a fresh clone into APP_DIR has no build output and the
# SAME_DIR path above copies nothing. Build here or the unit starts without a server.
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "  No build found in $APP_DIR, compiling TypeScript..."
    cd "$APP_DIR"
    npm install --production=false
    npm run build
fi

# Install production dependencies
echo "  Installing production dependencies..."
cd "$APP_DIR"
npm install --production 2>/dev/null || npm install --production --ignore-scripts 2>/dev/null || true

# --ignore-scripts and some ARM prebuild failures leave better-sqlite3 without its
# native binding, which crashes the service on boot with "Could not locate the
# bindings file". The constructor loads the binding lazily, so require() alone
# proves nothing - open a real database to test it.
SQLITE_CHECK="const D=require('$APP_DIR/node_modules/better-sqlite3');new D(':memory:').close()"
if ! node -e "$SQLITE_CHECK" &>/dev/null; then
    echo "  better-sqlite3 binding missing, compiling from source (takes a few minutes on ARM)..."
    npm rebuild better-sqlite3 --build-from-source
fi

# Create .env file if not exists
if [ ! -f "$APP_DIR/.env" ]; then
    JWT_SECRET=$(openssl rand -hex 32)
    cat > "$APP_DIR/.env" << EOF
PORT=3000
HOST=0.0.0.0
JWT_SECRET=$JWT_SECRET
DB_PATH=$APP_DIR/data/mikrotik-controller.db
LOG_LEVEL=info
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF
    echo "  Created .env file with random JWT secret"
    echo ""
    echo "  *** DEFAULT LOGIN: admin / admin123 ***"
    echo "  *** CHANGE PASSWORD ON FIRST LOGIN! ***"
else
    echo "  .env file already exists, keeping it"
fi

# Ensure data directory exists
mkdir -p "$APP_DIR/data"

# Set permissions
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# Set default ACLs on hotspot dir so files copied as root are still writable by service user
mkdir -p "$APP_DIR/hotspot"
setfacl -R -m u:"$APP_USER":rwx "$APP_DIR/hotspot"
setfacl -R -d -m u:"$APP_USER":rwx "$APP_DIR/hotspot"

# Install systemd service
echo "[6/9] Installing systemd service..."
cp "$SCRIPT_DIR/deploy/mikrotik-controller.service" /etc/systemd/system/
# The unit ships with /usr/bin/node; hosts using nvm or a non-standard prefix
# would fail at EXEC with status=203, so point it at the binary we detected.
sed -i "s|^ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" /etc/systemd/system/$APP_NAME.service
systemctl daemon-reload
systemctl enable "$APP_NAME"

# Start service
echo "[7/9] Starting service..."
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "ERROR: $APP_DIR/dist/server.js is missing; refusing to start a service that will crash-loop."
    echo "  Build it manually: cd $APP_DIR && npm install --production=false && npm run build"
    exit 1
fi
if ! node -e "const D=require('$APP_DIR/node_modules/better-sqlite3');new D(':memory:').close()" &>/dev/null; then
    echo "ERROR: better-sqlite3 has no usable native binding; refusing to start the service."
    echo "  Retry manually: cd $APP_DIR && npm rebuild better-sqlite3 --build-from-source"
    exit 1
fi
systemctl start "$APP_NAME"

# Wait and check status
sleep 2
if systemctl is-active --quiet "$APP_NAME"; then
    echo "  Service started successfully"
else
    echo ""
    echo "ERROR: Service failed to start. Check logs:"
    echo "  sudo journalctl -u $APP_NAME -n 50 --no-pager"
    exit 1
fi

# Install and configure Nginx
echo "[8/9] Installing Nginx reverse proxy..."
apt-get install -y -qq nginx > /dev/null 2>&1

# Copy Nginx configuration
cp "$SCRIPT_DIR/deploy/nginx.conf" /etc/nginx/sites-available/mikrotik-controller

# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default

# Enable the site
ln -sf /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/

# Test Nginx configuration
nginx -t
if [ $? -ne 0 ]; then
    echo "  WARNING: Nginx configuration test failed"
    echo "  You may need to manually configure Nginx"
else
    # Reload Nginx
    systemctl reload nginx
    systemctl enable nginx
    echo "  Nginx configured and started"
fi

# Configure firewall if UFW is active
echo "[9/9] Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 'Nginx Full' > /dev/null 2>&1 || true
    ufw allow ssh > /dev/null 2>&1 || true
    echo "  Firewall rules added for Nginx"
else
    echo "  UFW not installed, skipping firewall configuration"
fi

# Final status check
if systemctl is-active --quiet "$APP_NAME" && systemctl is-active --quiet nginx; then
    echo ""
    echo "=========================================="
    echo "  Installation Complete!"
    echo "=========================================="
    echo ""
    echo "  Service: sudo systemctl status $APP_NAME"
    echo "  Logs:    sudo journalctl -u $APP_NAME -f"
    echo ""
    echo "  Access URLs:"
    echo "    Direct:    http://$(hostname -I | awk '{print $1}'):3000"
    echo "    Via Nginx: http://$(hostname -I | awk '{print $1}')"
    echo ""
    echo "  Default login: admin / admin123"
    echo "  CHANGE PASSWORD ON FIRST LOGIN!"
    echo ""
    echo "  Configuration: $APP_DIR/.env"
    echo "  Database:      $APP_DIR/data/"
    echo "  Nginx config:  /etc/nginx/sites-available/mikrotik-controller"
    echo ""
    echo "  Optional: Set up SSL with Let's Encrypt"
    echo "    sudo bash $SCRIPT_DIR/deploy/setup-ssl.sh your-domain.com"
    echo ""
    echo "=========================================="
else
    echo ""
    echo "ERROR: Service failed to start. Check logs:"
    echo "  sudo journalctl -u $APP_NAME -n 50 --no-pager"
    exit 1
fi
