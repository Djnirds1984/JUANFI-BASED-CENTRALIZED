#!/bin/bash
set -e

# JuanFi Panel — Post-Install Script
# Runs inside the target chroot during Debian Installer's late_command phase.
# At this point the base system is installed to disk and this script
# configures the JuanFi panel on top of it.

APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"
APP_USER="$APP_NAME"

echo ">>> JuanFi Panel: post-install starting..."

# Create service user
useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER" 2>/dev/null || true

# Install Node.js 20.x from NodeSource (Debian bookworm ships v18, but 20.x is LTS)
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
    echo ">>> Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install production npm dependencies
echo ">>> Installing npm dependencies..."
cd "$APP_DIR"
npm install --production --ignore-scripts 2>/dev/null || npm install --production

# Create data directory
mkdir -p "$APP_DIR/data"

# Generate .env with random JWT secret
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
chmod 600 "$APP_DIR/.env"

# Set ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Set ACLs on hotspot directory
mkdir -p "$APP_DIR/hotspot"
setfacl -R -m u:"$APP_USER":rwx "$APP_DIR/hotspot" 2>/dev/null || true
setfacl -R -d -m u:"$APP_USER":rwx "$APP_DIR/hotspot" 2>/dev/null || true

# Install systemd service
cp "$APP_DIR/mikrotik-controller.service" /etc/systemd/system/ 2>/dev/null || true
systemctl enable "$APP_NAME" 2>/dev/null || \
    ln -sf /etc/systemd/system/${APP_NAME}.service \
           /etc/systemd/system/multi-user.target.wants/${APP_NAME}.service

# Configure nginx
cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/mikrotik-controller 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/mikrotik-controller
systemctl enable nginx 2>/dev/null || \
    ln -sf /lib/systemd/system/nginx.service \
           /etc/systemd/system/multi-user.target.wants/nginx.service

# Enable SSH
systemctl enable ssh 2>/dev/null || \
    ln -sf /lib/systemd/system/ssh.service \
           /etc/systemd/system/multi-user.target.wants/ssh.service

# Configure firewall
ufw allow 'Nginx Full' 2>/dev/null || true
ufw allow ssh 2>/dev/null || true
ufw allow 1812/udp 2>/dev/null || true
ufw allow 1813/udp 2>/dev/null || true
echo "y" | ufw enable 2>/dev/null || true

# Set hostname
echo "juanfi-panel" > /etc/hostname

# Login banner
cat > /etc/profile.d/juanfi-banner.sh << 'BANNER'
if [ "$(tty)" = "/dev/tty1" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "  ============================================"
    echo "    JuanFi Centralized Panel"
    echo "  ============================================"
    echo ""
    echo "    Panel:  http://${IP:-<not-yet-assigned>}"
    echo "    Login:  admin / admin123"
    echo ""
    echo "    Change password on first login!"
    echo "  ============================================"
    echo ""
fi
BANNER

# Clean up deploy artifacts from app directory and remove staging dir
rm -f "$APP_DIR/mikrotik-controller.service" "$APP_DIR/nginx.conf"
rm -rf /opt/juanfi-installer
apt-get clean

echo ">>> JuanFi Panel: post-install complete!"
