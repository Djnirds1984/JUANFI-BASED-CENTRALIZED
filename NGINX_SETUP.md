# Nginx Configuration Guide

Complete guide for setting up Nginx as a reverse proxy for MikroTik Controller with optional SSL/HTTPS support.

## Table of Contents

- [Overview](#overview)
- [Automatic Setup](#automatic-setup)
- [Manual Nginx Configuration](#manual-nginx-configuration)
- [SSL/HTTPS Setup with Let's Encrypt](#sslhttps-setup-with-lets-encrypt)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Nginx serves as a reverse proxy for the MikroTik Controller, providing:

- **Port 80/443 Access** - Access via standard HTTP/HTTPS ports instead of 3000
- **SSL/TLS Encryption** - Secure HTTPS connections with Let's Encrypt
- **WebSocket Support** - Proper handling of real-time connections
- **Security Headers** - Additional security protections
- **Load Balancing** - Ready for multiple backend instances (advanced)
- **Static File Caching** - Improved performance

---

## Automatic Setup

### During Installation

The `install.sh` script automatically:
1. Installs Nginx
2. Configures reverse proxy
3. Sets up firewall rules
4. Enables Nginx service

After installation, access via:
```
http://<your-device-ip>
```

### SSL Setup (Optional)

To add HTTPS support:

```bash
# Make sure domain points to your server first!
sudo bash deploy/setup-ssl.sh your-domain.com
```

This will:
1. Install Certbot
2. Obtain SSL certificate from Let's Encrypt
3. Configure Nginx for HTTPS
4. Set up HTTP to HTTPS redirect
5. Enable auto-renewal

---

## Manual Nginx Configuration

### Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Step 2: Copy Configuration

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/mikrotik-controller
```

### Step 3: Edit Configuration

```bash
sudo nano /etc/nginx/sites-available/mikrotik-controller
```

Update the `server_name` directive:

```nginx
server_name controller.yourdomain.com;  # Change to your domain or IP
```

For IP-only access:

```nginx
server_name _;  # Accepts any hostname/IP
```

### Step 4: Enable Site

```bash
# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Enable MikroTik Controller site
sudo ln -s /etc/nginx/sites-available/mikrotik-controller /etc/nginx/sites-enabled/
```

### Step 5: Test Configuration

```bash
sudo nginx -t
```

Expected output:
```
nginx: the configuration file /etc/nginx/sites-available/mikrotik-controller syntax is ok
nginx: configuration file /etc/nginx/sites-available/mikrotik-controller test is successful
```

### Step 6: Reload Nginx

```bash
sudo systemctl reload nginx
```

### Step 7: Verify

```bash
# Check Nginx status
sudo systemctl status nginx

# Test access
curl http://localhost
```

---

## SSL/HTTPS Setup with Let's Encrypt

### Prerequisites

1. **Domain name** pointing to your server's public IP
2. **Port 80** accessible from internet
3. **Nginx** installed and running
4. **MikroTik Controller** running on port 3000

### Step 1: Install Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### Step 2: Obtain SSL Certificate

**Using the automated script:**

```bash
sudo bash deploy/setup-ssl.sh your-domain.com
```

**Or manually:**

```bash
sudo certbot --nginx -d your-domain.com
```

Follow the prompts:
- Enter email address (optional)
- Agree to terms
- Choose whether to redirect HTTP to HTTPS (recommended: Yes)

### Step 3: Verify SSL

Open browser and navigate to:
```
https://your-domain.com
```

Check for:
- ✅ Padlock icon in address bar
- ✅ HTTPS in URL
- ✅ No security warnings

### Step 4: Test SSL Configuration

**Online tools:**
- [SSL Labs Test](https://www.ssllabs.com/ssltest/analyze.html?d=your-domain.com)
- [Why No Padlock](https://www.whynopadlock.com/)

**Command line:**

```bash
# Test certificate
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -dates

# Check expiration
sudo certbot certificates
```

### Step 5: Auto-Renewal

Certbot automatically sets up a systemd timer for renewal.

**Verify auto-renewal:**

```bash
sudo systemctl status certbot.timer
```

**Test renewal process:**

```bash
sudo certbot renew --dry-run
```

**Manual renewal (if needed):**

```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

## Advanced Configuration

### Custom Port Configuration

If you want to run on a different port:

```bash
# Edit .env
sudo nano /opt/mikrotik-controller/.env

# Change port
PORT=8080

# Restart service
sudo systemctl restart mikrotik-controller

# Update Nginx config
sudo nano /etc/nginx/sites-available/mikrotik-controller

# Change proxy_pass
proxy_pass http://localhost:8080;

# Reload Nginx
sudo systemctl reload nginx
```

### Rate Limiting

Add rate limiting to prevent abuse:

```nginx
# Add to http block in /etc/nginx/nginx.conf
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

# Add to server block in mikrotik-controller config
location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://localhost:3000;
    # ... other proxy settings
}
```

### Basic Authentication (Extra Security)

Add an extra layer of authentication:

```bash
# Install Apache utils
sudo apt install apache2-utils -y

# Create password file
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

Update Nginx config:

```nginx
location / {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://localhost:3000;
    # ... other proxy settings
}
```

### IP Whitelisting

Restrict access to specific IPs:

```nginx
server {
    listen 80;
    server_name controller.yourdomain.com;

    # Allow specific IPs
    allow 192.168.1.0/24;
    allow 10.0.0.100;
    deny all;

    location / {
        proxy_pass http://localhost:3000;
        # ... other proxy settings
    }
}
```

### Gzip Compression

Enable compression for better performance:

```nginx
server {
    # ... other settings

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

### Logging Configuration

Custom log format:

```nginx
log_format custom '$remote_addr - $remote_user [$time_local] '
                  '"$request" $status $body_bytes_sent '
                  '"$http_referer" "$http_user_agent" '
                  'rt=$request_time';

access_log /var/log/nginx/mikrotik-controller.access.log custom;
```

### WebSocket Optimization

For better WebSocket performance:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        
        # WebSocket specific
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

---

## Troubleshooting

### Nginx Won't Start

**Check configuration:**

```bash
sudo nginx -t
```

**Check logs:**

```bash
sudo journalctl -u nginx -n 50 --no-pager
sudo tail -f /var/log/nginx/error.log
```

**Common issues:**

1. **Port already in use:**
   ```bash
   sudo lsof -i :80
   sudo lsof -i :443
   
   # Stop conflicting service
   sudo systemctl stop apache2  # If Apache is running
   ```

2. **Syntax error in config:**
   ```bash
   sudo nginx -t
   # Fix the reported error
   ```

3. **Permission denied:**
   ```bash
   sudo chown -R www-data:www-data /var/log/nginx/
   ```

### 502 Bad Gateway

**Cause:** Nginx can't connect to backend

**Solutions:**

1. **Check if MikroTik Controller is running:**
   ```bash
   sudo systemctl status mikrotik-controller
   ```

2. **Check port 3000:**
   ```bash
   sudo netstat -tlnp | grep 3000
   curl http://localhost:3000
   ```

3. **Check Nginx error log:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

4. **Verify proxy_pass in config:**
   ```bash
   sudo grep proxy_pass /etc/nginx/sites-available/mikrotik-controller
   ```

### SSL Certificate Errors

**Certificate not trusted:**

```bash
# Check certificate chain
sudo certbot certificates

# Renew certificate
sudo certbot renew --force-renewal
```

**Domain mismatch:**

```bash
# Verify domain in certificate
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -text | grep DNS
```

**Mixed content warnings:**

Ensure all resources load via HTTPS. Check browser console for HTTP resources.

### WebSocket Connection Failed

**Check browser console for errors**

**Solutions:**

1. **Verify WebSocket configuration:**
   ```bash
   sudo grep -A5 "socket.io" /etc/nginx/sites-available/mikrotik-controller
   ```

2. **Check if Socket.IO is working:**
   ```bash
   curl http://localhost:3000/socket.io/?EIO=3&transport=polling
   ```

3. **Test from browser:**
   - Open DevTools → Network tab
   - Look for WebSocket connections
   - Check for errors

### Performance Issues

**High latency:**

1. **Enable keepalive:**
   ```nginx
   upstream backend {
       server localhost:3000;
       keepalive 32;
   }
   
   server {
       location / {
           proxy_pass http://backend;
           proxy_http_version 1.1;
           proxy_set_header Connection "";
       }
   }
   ```

2. **Enable caching:**
   ```nginx
   location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
       expires 30d;
       add_header Cache-Control "public, immutable";
   }
   ```

3. **Enable compression:**
   ```nginx
   gzip on;
   gzip_types text/plain text/css application/json application/javascript;
   ```

### Firewall Issues

**Cannot access from outside:**

```bash
# Check UFW status
sudo ufw status

# Allow HTTP/HTTPS
sudo ufw allow 'Nginx Full'

# Or allow specific ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

**Check iptables:**

```bash
sudo iptables -L -n | grep -E '80|443'
```

---

## Configuration Examples

### Development Setup (HTTP Only)

```nginx
server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Production Setup (HTTPS with Redirect)

```nginx
# HTTP redirect
server {
    listen 80;
    server_name controller.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name controller.example.com;

    ssl_certificate /etc/letsencrypt/live/controller.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/controller.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000" always;

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
}
```

### Multi-Domain Setup

```nginx
# First domain
server {
    listen 443 ssl http2;
    server_name controller1.example.com;
    
    ssl_certificate /etc/letsencrypt/live/controller1.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/controller1.example.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        # ... proxy settings
    }
}

# Second domain
server {
    listen 443 ssl http2;
    server_name controller2.example.com;
    
    ssl_certificate /etc/letsencrypt/live/controller2.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/controller2.example.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;  # Different backend
        # ... proxy settings
    }
}
```

---

## Useful Commands

```bash
# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Restart Nginx
sudo systemctl restart nginx

# Check Nginx status
sudo systemctl status nginx

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# List enabled sites
ls -la /etc/nginx/sites-enabled/

# Check SSL certificate
sudo certbot certificates

# Renew SSL certificate
sudo certbot renew --dry-run

# Check what's using a port
sudo lsof -i :80
sudo lsof -i :443
```

---

## Security Best Practices

1. **Always use HTTPS** in production
2. **Enable HSTS** header
3. **Keep Nginx updated**: `sudo apt update && sudo apt upgrade nginx`
4. **Restrict access** by IP when possible
5. **Use strong SSL ciphers**
6. **Enable rate limiting** for API endpoints
7. **Regular security audits** with tools like Mozilla Observatory
8. **Monitor logs** for suspicious activity
9. **Backup configuration** before changes
10. **Test changes** in staging first

---

## Support

For Nginx-specific issues:
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Nginx Community](https://community.nginx.org/)

For MikroTik Controller issues:
- Check logs: `sudo journalctl -u mikrotik-controller -f`
- See main README.md
- Open GitHub issue

---

**Nginx configuration complete! Your MikroTik Controller is now accessible via standard HTTP/HTTPS ports.**
