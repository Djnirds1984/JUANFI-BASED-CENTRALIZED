#!/bin/bash
set -e

APP_NAME="mikrotik-controller"

echo "Uninstalling MikroTik Controller..."

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

echo ""
read -p "This will remove the application and ALL data. Continue? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Stopping service..."
systemctl stop "$APP_NAME" 2>/dev/null || true
systemctl disable "$APP_NAME" 2>/dev/null || true

echo "Removing systemd service..."
rm -f /etc/systemd/system/$APP_NAME.service
systemctl daemon-reload

echo "Removing application directory (/opt/$APP_NAME)..."
rm -rf "/opt/$APP_NAME"

echo "Removing application user..."
userdel -r "$APP_NAME" 2>/dev/null || true

echo ""
echo "MikroTik Controller has been uninstalled."
