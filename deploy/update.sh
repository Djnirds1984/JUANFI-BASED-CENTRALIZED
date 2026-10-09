#!/bin/bash
set -e

APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=========================================="
echo "  MikroTik Controller - Update"
echo "=========================================="

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

echo "[1/5] Stopping service..."
systemctl stop "$APP_NAME"

echo "[2/5] Backing up database..."
if [ -f "$APP_DIR/data/mikrotik-controller.db" ]; then
    BACKUP_DIR="$APP_DIR/data/backups"
    mkdir -p "$BACKUP_DIR"
    cp "$APP_DIR/data/mikrotik-controller.db" "$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).db"
    echo "  Backup saved to $BACKUP_DIR"
fi

echo "[3/5] Building new version..."
cd "$SCRIPT_DIR"
npm install --production=false
npm run build

echo "[4/5] Deploying..."
rm -rf "$APP_DIR/dist"
rm -rf "$APP_DIR/public"
cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
cp "$SCRIPT_DIR/package.json" "$APP_DIR/"
# Portal files (login/status/logout pages + assets/js). These are edited in the
# repo, so they must be redeployed on update too.
#
# NOTE: dashboard portal Save writes directly to $APP_DIR/hotspot on disk, so we
# back up the existing folder and copy repo files OVER it (without deleting) to
# avoid wiping any edits that were made through the UI but not committed.
if [ -d "$SCRIPT_DIR/hotspot" ]; then
    if [ -d "$APP_DIR/hotspot" ]; then
        cp -r "$APP_DIR/hotspot" "$APP_DIR/hotspot.bak-$(date +%Y%m%d-%H%M%S)"
    fi
    cp -r "$SCRIPT_DIR/hotspot/." "$APP_DIR/hotspot/" 2>/dev/null || cp -r "$SCRIPT_DIR/hotspot" "$APP_DIR/hotspot"
fi
cd "$APP_DIR"
npm install --production

echo "[5/5] Restarting service..."
chown -R mikrotik-controller:mikrotik-controller "$APP_DIR"
# Ensure default ACLs on hotspot dir so files copied as root are still writable by service user
if command -v setfacl &>/dev/null; then
    mkdir -p "$APP_DIR/hotspot"
    setfacl -R -m mikrotik-controller:rwx "$APP_DIR/hotspot"
    setfacl -R -d -m mikrotik-controller:rwx "$APP_DIR/hotspot"
fi
systemctl start "$APP_NAME"

sleep 2
if systemctl is-active --quiet "$APP_NAME"; then
    echo ""
    echo "Update complete! Service is running."
    echo "  URL: http://$(hostname -I | awk '{print $1}'):3000"
else
    echo ""
    echo "ERROR: Service failed to start after update."
    echo "  Check logs: sudo journalctl -u $APP_NAME -n 50 --no-pager"
    echo "  Restore backup: sudo cp $APP_DIR/data/backups/LATEST.db $APP_DIR/data/mikrotik-controller.db"
    exit 1
fi
