# Deployment Checklist

## Pre-Deployment

- [ ] Review and update `.env` configuration
- [ ] Change JWT_SECRET to a random secure value
- [ ] Change default admin password
- [ ] Test application locally (`npm run dev`)
- [ ] Build production version (`npm run build`)
- [ ] Verify all files are committed to git

## SBC/Mini PC Preparation

- [ ] Install Ubuntu 20.04+ or Debian 11+
- [ ] Update system: `sudo apt update && sudo apt upgrade`
- [ ] Set static IP address
- [ ] Configure hostname
- [ ] Enable SSH access
- [ ] Set up firewall (UFW):
  ```bash
  sudo ufw allow ssh
  sudo ufw allow 3000/tcp  # Or 80/443 if using reverse proxy
  sudo ufw enable
  ```

## MikroTik Router Preparation

- [ ] Enable API service (IP > Services > api)
- [ ] Set API port (default: 8728)
- [ ] Create API user with appropriate permissions
- [ ] Test API connectivity from SBC:
  ```bash
  telnet <router-ip> 8728
  ```
- [ ] Document router IP and credentials

## Installation

- [ ] Transfer files to SBC/Mini PC
- [ ] Make install script executable: `chmod +x deploy/install.sh`
- [ ] Run installation: `sudo bash deploy/install.sh`
- [ ] Verify service is running: `sudo systemctl status mikrotik-controller`
- [ ] Check logs for errors: `sudo journalctl -u mikrotik-controller -n 50`

## Initial Configuration

- [ ] Access web dashboard: `http://<sbc-ip>:3000`
- [ ] Login with default credentials (admin/admin123)
- [ ] **CHANGE ADMIN PASSWORD IMMEDIATELY**
- [ ] Add first MikroTik router
- [ ] Test connection to router
- [ ] Verify system info displays correctly

## Feature Testing

### Router Management
- [ ] Add router successfully
- [ ] Connect to router
- [ ] View router status
- [ ] Disconnect from router
- [ ] Delete router

### Hotspot Users
- [ ] View hotspot users from router
- [ ] Create new hotspot user
- [ ] Verify user appears in MikroTik
- [ ] Delete hotspot user

### Bandwidth Management
- [ ] View existing queues
- [ ] Create new queue
- [ ] Verify queue in MikroTik
- [ ] Delete queue

### Voucher System
- [ ] Generate batch of vouchers
- [ ] Verify vouchers created in database
- [ ] Check vouchers synced to router
- [ ] Delete voucher

### Monitoring
- [ ] View monitoring dashboard
- [ ] Verify CPU/memory data displays
- [ ] Check historical data collection
- [ ] Wait 5 minutes and verify new data appears

## Production Hardening

### HTTPS Setup (Recommended)
- [ ] Install Nginx: `sudo apt install nginx`
- [ ] Configure reverse proxy (see README.md)
- [ ] Install Certbot: `sudo apt install certbot python3-certbot-nginx`
- [ ] Obtain SSL certificate: `sudo certbot --nginx -d your-domain.com`
- [ ] Test HTTPS access
- [ ] Verify auto-renewal: `sudo certbot renew --dry-run`

### Firewall Configuration
- [ ] Allow only necessary ports
- [ ] Restrict API access by IP if possible
- [ ] Disable direct access to port 3000 (use reverse proxy)

### Backup Setup
- [ ] Create backup script
- [ ] Set up cron job for daily backups:
  ```bash
  sudo crontab -e
  # Add: 0 2 * * * /path/to/backup-script.sh
  ```
- [ ] Test restore procedure
- [ ] Store backups off-site

### Monitoring
- [ ] Set up log rotation
- [ ] Configure monitoring alerts (email/webhook)
- [ ] Set up uptime monitoring
- [ ] Document recovery procedures

## Documentation

- [ ] Document network topology
- [ ] Record router credentials (securely)
- [ ] Create admin user guide
- [ ] Document backup/restore procedure
- [ ] Document troubleshooting steps

## Performance Testing

- [ ] Test with multiple routers (if applicable)
- [ ] Generate many vouchers to test batch operations
- [ ] Monitor memory usage under load
- [ ] Check CPU utilization
- [ ] Verify database performance

## Security Review

- [ ] Changed default admin password?
- [ ] JWT_SECRET is random and secure?
- [ ] HTTPS enabled?
- [ ] Firewall configured?
- [ ] SSH key-based auth (no passwords)?
- [ ] System updates installed?
- [ ] Unnecessary services disabled?

## Final Verification

- [ ] All features working correctly?
- [ ] Service auto-starts on boot?
- [ ] Backups running successfully?
- [ ] Logs accessible and rotating?
- [ ] Documentation complete?
- [ ] Team trained on usage?

## Post-Deployment

- [ ] Monitor for 24 hours
- [ ] Check for errors in logs
- [ ] Verify all routers stay connected
- [ ] Confirm backups are working
- [ ] Test password reset procedure
- [ ] Document any issues encountered

## Maintenance Schedule

### Daily
- [ ] Check service status
- [ ] Review error logs
- [ ] Verify backups completed

### Weekly
- [ ] Review monitoring data
- [ ] Check disk space
- [ ] Review voucher usage

### Monthly
- [ ] Update system packages
- [ ] Review and clear old logs
- [ ] Test restore from backup
- [ ] Review user access logs

### Quarterly
- [ ] Full security review
- [ ] Performance optimization
- [ ] Update application if needed
- [ ] Review and update documentation

## Emergency Contacts

- System Administrator: _______________
- Network Administrator: _______________
- MikroTik Support: _______________
- Hosting Provider: _______________

## Notes

Document any custom configurations, issues, or important information here:

_____________________________________________
_____________________________________________
_____________________________________________
