#!/bin/bash
set -e

# SSL Setup Script for MikroTik Controller
# Uses Let's Encrypt for free SSL certificates

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

echo "=========================================="
echo "  MikroTik Controller - SSL Setup"
echo "=========================================="
echo ""

# Check if domain is provided
if [ -z "$1" ]; then
    echo "Usage: sudo bash setup-ssl.sh <your-domain.com>"
    echo ""
    echo "Example: sudo bash setup-ssl.sh controller.example.com"
    echo ""
    echo "Prerequisites:"
    echo "  - Domain must point to this server's public IP"
    echo "  - Port 80 must be accessible from internet"
    echo "  - Nginx must be installed and running"
    exit 1
fi

DOMAIN=$1

echo "Setting up SSL for: $DOMAIN"
echo ""

# Verify Nginx is installed
if ! command -v nginx &> /dev/null; then
    echo "ERROR: Nginx is not installed. Run install.sh first."
    exit 1
fi

# Install Certbot if not present
if ! command -v certbot &> /dev/null; then
    echo "[1/5] Installing Certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
    echo "  Certbot installed"
else
    echo "[1/5] Certbot already installed"
fi

# Update Nginx configuration with domain
echo "[2/5] Updating Nginx configuration..."
sed -i "s/server_name controller.local;/server_name $DOMAIN;/g" /etc/nginx/sites-available/mikrotik-controller

# Test Nginx configuration
nginx -t
if [ $? -ne 0 ]; then
    echo "ERROR: Nginx configuration test failed"
    exit 1
fi

# Reload Nginx
systemctl reload nginx
echo "  Nginx reloaded"

# Obtain SSL certificate
echo "[3/5] Obtaining SSL certificate from Let's Encrypt..."
echo ""
echo "  This will:"
echo "  - Verify domain ownership"
echo "  - Generate SSL certificate"
echo "  - Configure Nginx for HTTPS"
echo ""

certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email

if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: Failed to obtain SSL certificate"
    echo "  - Make sure domain points to this server"
    echo "  - Make sure port 80 is accessible"
    exit 1
fi

echo ""
echo "[4/5] SSL certificate obtained successfully!"

# Enable HTTPS redirect in Nginx config
echo "[5/5] Enabling HTTPS redirect..."

# Create HTTPS-enabled configuration
cat > /etc/nginx/sites-available/mikrotik-controller << 'EOF'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name DOMAIN_PLACEHOLDER;

    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    access_log /var/log/nginx/mikrotik-controller.ssl.access.log;
    error_log /var/log/nginx/mikrotik-controller.ssl.error.log;
}
EOF

# Replace domain placeholder
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/sites-available/mikrotik-controller

# Test and reload Nginx
nginx -t
if [ $? -ne 0 ]; then
    echo "ERROR: Nginx configuration test failed"
    exit 1
fi

systemctl reload nginx

# Set up auto-renewal
echo ""
echo "Setting up automatic certificate renewal..."
systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true

echo ""
echo "=========================================="
echo "  SSL Setup Complete!"
echo "=========================================="
echo ""
echo "  HTTPS URL: https://$DOMAIN"
echo "  HTTP redirects to HTTPS: Yes"
echo "  Auto-renewal: Enabled"
echo ""
echo "  Certificate location:"
echo "    /etc/letsencrypt/live/$DOMAIN/"
echo ""
echo "  Test your SSL:"
echo "    https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN"
echo ""
echo "  Renewal command (manual):"
echo "    sudo certbot renew"
echo ""
echo "=========================================="
