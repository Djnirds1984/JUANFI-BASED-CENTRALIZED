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
echo "[1/7] Updating package lists..."
apt-get update -qq

# Install dependencies
echo "[2/7] Installing dependencies..."
apt-get install -y -qq curl build-essential git sqlite3 > /dev/null 2>&1

# Install Node.js if not present or too old
install_node() {
    echo "[3/7] Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
}

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
        echo "Node.js version too old ($(node -v)), upgrading..."
        install_node
    else
        echo "[3/7] Node.js $(node -v) already installed - OK"
    fi
else
    install_node
fi

echo "  Node.js: $(node -v)"
echo "  npm: $(npm -v)"

# Create application user
echo "[4/7] Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -d /opt/$APP_NAME -s /usr/sbin/nologin "$APP_USER"
    echo "  Created user: $APP_USER"
else
    echo "  User $APP_USER already exists"
fi

# Create application directory
echo "[5/7] Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/data"

# Copy application files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -d "$SCRIPT_DIR/dist" ]; then
    echo "  Copying built application..."
    cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
    cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
    cp "$SCRIPT_DIR/package.json" "$APP_DIR/"
else
    echo "  No build found. Building application..."
    cd "$SCRIPT_DIR"
    npm install --production=false
    npm run build
    cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
    cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
    cp "$SCRIPT_DIR/package.json" "$APP_DIR/"
fi

# Install production dependencies
cd "$APP_DIR"
npm install --production

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
fi

# Set permissions
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# Install systemd service
echo "[6/7] Installing systemd service..."
cp "$SCRIPT_DIR/deploy/mikrotik-controller.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$APP_NAME"

# Start service
echo "[7/7] Starting service..."
systemctl start "$APP_NAME"

# Wait and check status
sleep 2
if systemctl is-active --quiet "$APP_NAME"; then
    echo ""
    echo "=========================================="
    echo "  Installation Complete!"
    echo "=========================================="
    echo ""
    echo "  Service: sudo systemctl status $APP_NAME"
    echo "  Logs:    sudo journalctl -u $APP_NAME -f"
    echo "  URL:     http://$(hostname -I | awk '{print $1}'):3000"
    echo ""
    echo "  Default login: admin / admin123"
    echo "  CHANGE PASSWORD ON FIRST LOGIN!"
    echo ""
    echo "  Configuration: $APP_DIR/.env"
    echo "  Database:      $APP_DIR/data/"
    echo "=========================================="
else
    echo ""
    echo "ERROR: Service failed to start. Check logs:"
    echo "  sudo journalctl -u $APP_NAME -n 50 --no-pager"
    exit 1
fi
