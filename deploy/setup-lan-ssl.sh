#!/bin/bash
# Serve the panel over HTTPS on its LAN address.
#
# Tools > SubVendo Flasher talks to the NodeMCU through the browser's Web Serial
# API, and Chrome/Edge only expose that API on a secure context. http://10.0.0.254
# is not one, so the page can never see the board however healthy the driver is.
# The public tunnel already provides https; this does the same thing for the local
# address, without needing a domain or an internet round trip.
#
# Self-signed is deliberate. The browser gates Web Serial on the origin being
# https, not on the certificate being publicly trusted, so the one-time
# "Your connection is not private" warning is expected: click Advanced ->
# Proceed, and the page is a secure context from then on.
#
# Usage: sudo bash deploy/setup-lan-ssl.sh [more-ips-or-names ...]
# Re-running keeps the existing certificate unless --force is passed.
set -euo pipefail

FORCE=false
EXTRA=()
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then FORCE=true; else EXTRA+=("$arg"); fi
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

CERT_DIR=/etc/ssl/mikrotik-controller
CERT="$CERT_DIR/lan-cert.pem"
KEY="$CERT_DIR/lan-key.pem"
CONF=/etc/nginx/conf.d/mikrotik-controller-ssl.conf
DAYS=3650

if [ ! -f /etc/nginx/nginx.conf ]; then
  echo "nginx not found; install it first (deploy/install.sh does this)." >&2
  exit 1
fi

# --- certificate -----------------------------------------------------------

# Every address the panel is reached at has to be in the SAN list, or Chrome
# treats the certificate as belonging to a different host.
san="DNS:localhost,IP:127.0.0.1"
seen=" localhost 127.0.0.1 "
add_san() {
  local entry="$1" kind="${2:-IP}"
  [ -z "$entry" ] && return 0
  case "$seen" in *" $entry "*) return 0 ;; esac
  seen="$seen$entry "
  san="$san,$kind:$entry"
}

add_san "$(hostname)" DNS
add_san "controller.local" DNS
for ip in $(hostname -I 2>/dev/null); do
  add_san "$ip" IP
done
for entry in "${EXTRA[@]:-}"; do
  [ -z "$entry" ] && continue
  case "$entry" in
    *[a-zA-Z]*) add_san "$entry" DNS ;;
    *) add_san "$entry" IP ;;
  esac
done

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [ "$FORCE" = true ] || [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  tmp=$(mktemp)
  cat >"$tmp" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = $(hostname)
[v3]
subjectAltName = $san
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
  openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days "$DAYS" \
    -config "$tmp" -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
  rm -f "$tmp"
  chmod 600 "$KEY"
  chmod 644 "$CERT"
  echo "Generated a self-signed certificate ($DAYS days)"
else
  echo "Keeping the existing certificate (pass --force to replace it)"
fi

# --- nginx -----------------------------------------------------------------

# Same proxy exactly as the HTTP site, so the app behaves identically either way.
cat >"$CONF" <<EOF
# Written by deploy/setup-lan-ssl.sh - HTTPS on the LAN address.
server {
    listen 443 ssl;
    server_name $(hostname) controller.local localhost;

    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    access_log /var/log/nginx/mikrotik-controller.ssl.access.log;
    error_log /var/log/nginx/mikrotik-controller.ssl.error.log;
}
EOF

nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "ufw: 443/tcp allowed"
fi

echo
echo "HTTPS is live. Then open, in Chrome or Edge:"
for ip in $(hostname -I 2>/dev/null); do
  echo "  https://$ip"
done
echo
echo "Expect a certificate warning the first time: Advanced -> Proceed."
echo "The page is then a secure context, and Tools > SubVendo Flasher can open the port."
echo "Certificate fingerprint:"
openssl x509 -in "$CERT" -noout -fingerprint -sha256 | sed 's/^/  /'
