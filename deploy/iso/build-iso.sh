#!/bin/bash
set -e

# JuanFi Centralized Panel — Bootable ISO Builder
# Produces a Debian-based live ISO with the panel pre-installed.
# Must run on a Debian/Ubuntu x86_64 host (or WSL2 with Ubuntu).
#
# Usage:
#   sudo bash deploy/iso/build-iso.sh
#
# Output: live-image-amd64.hybrid.iso (in deploy/iso/build/)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"

echo "=========================================="
echo "  JuanFi Panel — ISO Builder"
echo "=========================================="

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Must run as root (sudo)"
    exit 1
fi

ARCH=$(dpkg --print-architecture)
if [ "$ARCH" != "amd64" ]; then
    echo "ERROR: This builds x86_64 ISOs only. Current arch: $ARCH"
    exit 1
fi

# Install live-build if missing
if ! command -v lb &>/dev/null; then
    echo "[1/5] Installing live-build..."
    apt-get update -qq
    apt-get install -y -qq live-build debootstrap > /dev/null 2>&1
else
    echo "[1/5] live-build already installed"
fi

# Clean previous build
if [ -d "$BUILD_DIR" ]; then
    echo "  Cleaning previous build..."
    cd "$BUILD_DIR"
    lb clean --purge 2>/dev/null || true
    cd "$SCRIPT_DIR"
    rm -rf "$BUILD_DIR"
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo "[2/5] Configuring live-build..."

lb config \
    --distribution bookworm \
    --arch amd64 \
    --bootloader grub \
    --binary-images iso-hybrid \
    --debian-installer live \
    --debian-installer-gui false \
    --debian-installer-distribution bookworm \
    --apt-recommends false \
    --security true \
    --updates true \
    --backports false \
    --archive-areas "main contrib" \
    --kernel-flavours linux-image-amd64 \
    --bootappend-live "boot=live components quiet splash hostname=juanfi-panel username=juanfi" \
    --bootappend-live-failsafe "boot=live components memtest noapic noapm nodma nomce nolapic nosmp vga=normal" \
    --iso-application "JuanFi Panel" \
    --iso-volume "JuanFi Panel" \
    --iso-publisher "JuanFi"

# Package list — nodejs from Debian bookworm is v18 (meets minimum)
mkdir -p config/package-lists
cat > config/package-lists/juanfi.list.chroot << 'PKGLIST'
curl
wget
git
build-essential
acl
sqlite3
nginx
openssh-server
ufw
ca-certificates
gnupg
nodejs
npm
PKGLIST

# Copy application files into the chroot
echo "[3/5] Copying application files..."
mkdir -p "config/includes.chroot${APP_DIR}"

if [ -d "$PROJECT_ROOT/dist" ]; then
    cp -r "$PROJECT_ROOT/dist" "config/includes.chroot${APP_DIR}/"
else
    echo "  No dist/ found — building first..."
    cd "$PROJECT_ROOT"
    npm install
    npm run build
    cd "$BUILD_DIR"
    cp -r "$PROJECT_ROOT/dist" "config/includes.chroot${APP_DIR}/"
fi

cp -r "$PROJECT_ROOT/public" "config/includes.chroot${APP_DIR}/"
cp "$PROJECT_ROOT/package.json" "config/includes.chroot${APP_DIR}/"
cp -r "$PROJECT_ROOT/hotspot" "config/includes.chroot${APP_DIR}/"
cp "$PROJECT_ROOT/deploy/mikrotik-controller.service" "config/includes.chroot${APP_DIR}/"
cp "$PROJECT_ROOT/deploy/nginx.conf" "config/includes.chroot${APP_DIR}/"

# Post-install hook — runs as root inside chroot during build.
# Note: systemd is NOT running in the chroot, so we create symlinks manually.
mkdir -p config/hooks/live
cat > config/hooks/live/01-setup-juanfi.chroot << 'INSTALL'
#!/bin/bash
set -e

APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"
APP_USER="$APP_NAME"

echo ">>> Setting up JuanFi Panel inside chroot..."

# Create service user
useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER" 2>/dev/null || true

# Install production deps
cd "$APP_DIR"
npm install --production --ignore-scripts 2>/dev/null || npm install --production

# Create data dir
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

# Enable systemd service (manual symlink — systemctl doesn't work in chroot)
ln -sf /etc/systemd/system/${APP_NAME}.service \
    /etc/systemd/system/multi-user.target.wants/${APP_NAME}.service

# Configure nginx
cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/mikrotik-controller
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/mikrotik-controller
# Enable nginx via symlink
ln -sf /lib/systemd/system/nginx.service \
    /etc/systemd/system/multi-user.target.wants/nginx.service

# Enable ssh
ln -sf /lib/systemd/system/ssh.service \
    /etc/systemd/system/multi-user.target.wants/ssh.service

# Set permissions
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
mkdir -p "$APP_DIR/hotspot"
setfacl -R -m u:"$APP_USER":rwx "$APP_DIR/hotspot" 2>/dev/null || true
setfacl -R -d -m u:"$APP_USER":rwx "$APP_DIR/hotspot" 2>/dev/null || true

# Pre-configure UFW rules (rules stored in /lib/ufw/user*.rules)
ufw allow 'Nginx Full' 2>/dev/null || true
ufw allow ssh 2>/dev/null || true
ufw allow 1812/udp 2>/dev/null || true
ufw allow 1813/udp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

# Set hostname
echo "juanfi-panel" > /etc/hostname

# Login banner showing the panel URL
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

# Clean up deploy files from app dir
rm -f "$APP_DIR/mikrotik-controller.service" "$APP_DIR/nginx.conf"
apt-get clean

echo ">>> JuanFi Panel setup complete"
INSTALL
chmod +x config/hooks/live/01-setup-juanfi.chroot

echo "[4/5] Building ISO (this takes 10-30 minutes)..."
lb build 2>&1 | tail -30

if [ -f "live-image-amd64.hybrid.iso" ]; then
    ISO_SIZE=$(du -h live-image-amd64.hybrid.iso | cut -f1)
    echo ""
    echo "=========================================="
    echo "  Build Complete!"
    echo "=========================================="
    echo ""
    echo "  ISO: $BUILD_DIR/live-image-amd64.hybrid.iso ($ISO_SIZE)"
    echo ""
    echo "  Flash to USB:"
    echo "    dd if=live-image-amd64.hybrid.iso of=/dev/sdX bs=4M status=progress"
    echo ""
    echo "  Boot the USB on any x86_64 machine."
    echo "  Panel auto-starts on port 80 (nginx) and 3000 (direct)."
    echo "  Default login: admin / admin123"
    echo ""
    echo "  To install to disk from the live USB:"
    echo "    Use the Debian installer (select 'Install' from boot menu)"
    echo ""
    echo "=========================================="
else
    echo ""
    echo "ERROR: Build failed. Check output above."
    echo "  Build dir: $BUILD_DIR"
    exit 1
fi
