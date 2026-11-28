#!/bin/bash
set -e

APP_NAME="mikrotik-controller"
APP_DIR="/opt/$APP_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# On SBCs the repo is usually cloned straight into APP_DIR, so SCRIPT_DIR and
# APP_DIR are the same tree: the build output is already deployed and copying
# dist/public/hotspot onto themselves would delete or break it.
if [ "$SCRIPT_DIR" = "$(cd "$APP_DIR" 2>/dev/null && pwd)" ]; then
    SAME_DIR=true
else
    SAME_DIR=false
fi

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
if [ "$SAME_DIR" = false ]; then
    rm -rf "$APP_DIR/dist"
    rm -rf "$APP_DIR/public"
    cp -r "$SCRIPT_DIR/dist" "$APP_DIR/"
    cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
    cp "$SCRIPT_DIR/package.json" "$APP_DIR/"
else
    echo "  Running from the install directory, build output already in place..."
fi
# Portal files (login/status/logout pages + assets/js). These are edited in the
# repo, so they must be redeployed on update too.
#
# NOTE: dashboard portal Save writes directly to $APP_DIR/hotspot on disk, so we
# back up the existing folder and copy repo files OVER it (without deleting) to
# avoid wiping any edits that were made through the UI but not committed.
if [ "$SAME_DIR" = false ] && [ -d "$SCRIPT_DIR/hotspot" ]; then
    if [ -d "$APP_DIR/hotspot" ]; then
        cp -r "$APP_DIR/hotspot" "$APP_DIR/hotspot.bak-$(date +%Y%m%d-%H%M%S)"
    fi
    cp -r "$SCRIPT_DIR/hotspot/." "$APP_DIR/hotspot/" 2>/dev/null || cp -r "$SCRIPT_DIR/hotspot" "$APP_DIR/hotspot"
fi
# Firmware images offered by Tools > SubVendo Flasher. They are committed next to
# the source releases, so mirror them into firmware/ where the tools API looks.
if [ "$SAME_DIR" = false ] && [ -d "$SCRIPT_DIR/aircoins-nodemcu" ]; then
    mkdir -p "$APP_DIR/firmware"
    cp "$SCRIPT_DIR"/aircoins-nodemcu/AirCoins-v*.bin "$APP_DIR/firmware/" 2>/dev/null || true
    echo "  Firmware images in $APP_DIR/firmware: $(ls -1 "$APP_DIR/firmware" 2>/dev/null | wc -l)"
fi
cd "$APP_DIR"
npm install --production

# A pruned or failed native build leaves better-sqlite3 without its binding, so the
# restarted service would die immediately with "Could not locate the bindings file".
# The binding is loaded lazily by the Database constructor, so a plain require()
# passes even when it is missing - open a real database to test it.
SQLITE_CHECK="const D=require('$APP_DIR/node_modules/better-sqlite3');new D(':memory:').close()"
if ! node -e "$SQLITE_CHECK" &>/dev/null; then
    echo "  better-sqlite3 binding missing, compiling from source (takes a few minutes on ARM)..."
    command -v make &>/dev/null && command -v g++ &>/dev/null && command -v python3 &>/dev/null \
        || apt-get install -y -qq python3 make g++ > /dev/null 2>&1
    npm rebuild better-sqlite3 --build-from-source
    node -e "$SQLITE_CHECK" || {
        echo "ERROR: better-sqlite3 still has no usable native binding."
        echo "  Retry manually: cd $APP_DIR && npm rebuild better-sqlite3 --build-from-source"
        exit 1
    }
fi

echo "[5/5] Restarting service..."
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "ERROR: $APP_DIR/dist/server.js is missing; refusing to start a service that will crash-loop."
    echo "  Build it manually: cd $APP_DIR && npm install --production=false && npm run build"
    exit 1
fi
# nginx defaults to a 1 MB request body, which rejects logo uploads before they
# reach the app. conf.d is included from the http block on Debian/Ubuntu.
if command -v nginx &>/dev/null && [ -d /etc/nginx/conf.d ]; then
    if ! grep -rqs "client_max_body_size 5m" /etc/nginx/conf.d /etc/nginx/sites-available 2>/dev/null; then
        printf 'client_max_body_size 5m;\n' > /etc/nginx/conf.d/mikrotik-controller-upload.conf
        if nginx -t &>/dev/null; then
            systemctl reload nginx || true
            echo "  Raised nginx client_max_body_size to 5m"
        else
            rm -f /etc/nginx/conf.d/mikrotik-controller-upload.conf
            echo "  WARNING: nginx config test failed; upload limit left unchanged"
        fi
    fi
fi
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
