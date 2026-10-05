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
apt-get install -y -qq curl build-essential git sqlite3 > /dev/null 2>&1

# Check Node.js installation
echo "[3/9] Checking Node.js installation..."

# Try to find node in common locations
NODE_PATH=""
for path in /usr/bin/node /usr/local/bin/node /opt/node*/bin/node; do
    if [ -x "$path" ]; then
        NODE_PATH="$path"
        break
    fi
done

if [ -n "$NODE_PATH" ]; then
    NODE_VERSION=$("$NODE_PATH" -v | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
        echo "  WARNING: Node.js version too old ($("$NODE_PATH" -v)). Need v$NODE_MIN_VERSION or higher."
        echo "  Please install Node.js manually and re-run this script."
    else
        echo "  Node.js $("$NODE_PATH" -v) found at $NODE_PATH - OK"
        # Add to PATH for this script
        export PATH="$(dirname $NODE_PATH):$PATH"
    fi
else
    echo "  WARNING: Node.js not found. Please install Node.js v$NODE_MIN_VERSION+ manually."
    echo "  Common installation methods:"
    echo "    - Using NodeSource: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
    echo "    - Using nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash && nvm install 20"
fi

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
echo "[6/9] Installing systemd service..."
cp "$SCRIPT_DIR/deploy/mikrotik-controller.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$APP_NAME"

# Start service
echo "[7/9] Starting service..."
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
