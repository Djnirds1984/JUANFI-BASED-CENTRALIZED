# RouterOS Container Deployment Guide
## MikroTik Controller - x86_64 (CHR)

This guide covers deploying the MikroTik Controller app as a container on a MikroTik RouterOS x86_64 (CHR) router.

---

## Prerequisites

### Requirements
- **RouterOS**: Version 7.x or later (Container support required)
- **Architecture**: x86_64 (CHR - Cloud Hosted Router)
- **Docker Desktop**: Installed on your Windows build PC
- **Storage**: At least 500MB free on router for container
- **RAM**: At least 512MB free on router

### Enable Container Feature
```bash
# In RouterOS terminal
/system/device-mode/set container=yes
```
> Note: Router will reboot to apply changes.

---

## Build Process (Windows PC)

### Option 1: Automated Build Script (Recommended)

```powershell
# Run in PowerShell from project root
.\build-routeros.ps1
```

This will:
1. Set up Docker Buildx for cross-platform builds
2. Build the image for `linux/amd64`
3. Export to `mikrotik-controller-amd64.tar`

### Option 2: Manual Build Commands

```powershell
# 1. Create and use a multi-platform builder
docker buildx create --name multiplatform-builder --use

# 2. Build for linux/amd64
docker buildx build --platform linux/amd64 -t mikrotik-controller:latest --load .

# 3. Export to tar file
docker save -o mikrotik-controller-amd64.tar mikrotik-controller:latest
```

---

## Transfer to Router

### Option 1: Via WinSCP / File Transfer
1. Open WinSCP
2. Connect to your MikroTik router (SFTP protocol)
3. Upload `mikrotik-controller-amd64.tar` to router's `/files` directory

### Option 2: Via FTP
```bash
# From Windows command prompt
ftp <router-ip>
# Login with your MikroTik credentials
put mikrotik-controller-amd64.tar
```

### Option 3: Via SMB/Share
If you have a shared folder on the router:
```powershell
Copy-Item mikrotik-controller-amd64.tar -Destination \\<router-ip>\share\
```

---

## Import Container to RouterOS

### Step 1: Import the Container Image
```bash
/container import file-name=mikrotik-controller-amd64.tar
```

### Step 2: Create Virtual Ethernet Interface
```bash
/interface/veth/add name=veth-mikrotik-controller address=172.17.0.2/16 gateway=172.17.0.1
```

### Step 3: Configure Container
```bash
/container config set registry-url=https://registry-1.docker.io
```

### Step 4: Add and Start Container
```bash
/container add \
    name=mikrotik-controller \
    image=mikrotik-controller:latest \
    interface=veth-mikrotik-controller \
    root-dir=/app/data \
    mount=/app/data,/data \
    envlist=mikrotik-controller-envs
```

### Step 5: Set Environment Variables
```bash
/container/envs/add name=mikrotik-controller-envs key=PORT value=3000
/container/envs/add name=mikrotik-controller-envs key=HOST value=0.0.0.0
/container/envs/add name=mikrotik-controller-envs key=JWT_SECRET value=your-super-secret-key-change-this
/container/envs/add name=mikrotik-controller-envs key=DB_PATH value=/data/mikrotik.db
/container/envs/add name=mikrotik-controller-envs key=NODE_ENV value=production
/container/envs/add name=mikrotik-controller-envs key=ADMIN_USERNAME value=admin
/container/envs/add name=mikrotik-controller-envs key=ADMIN_PASSWORD value=admin123
```

### Step 6: Start Container
```bash
/container/start mikrotik-controller
```

---

## Network Configuration

### Option 1: Port Forwarding (Simple)
Forward container port to router's local network:
```bash
/ip/firewall/nat/add \
    chain=dstnat \
    protocol=tcp \
    dst-port=3000 \
    action=dst-nat \
    to-addresses=172.17.0.2 \
    to-ports=3000
```

### Option 2: Bridge Network (Advanced)
Create a bridge for container networking:
```bash
/interface/bridge/add name=container-bridge
/interface/bridge/port/add bridge=container-bridge interface=veth-mikrotik-controller
/ip/address/add address=172.17.0.1/16 interface=container-bridge
```

---

## Verification

### Check Container Status
```bash
/container/print
```

Expected output:
```
Columns: NAME, TAG, STATUS, IMAGE
# NAME                   TAG      STATUS   IMAGE
0 mikrotik-controller    latest   running  mikrotik-controller:latest
```

### View Container Logs
```bash
/container/logs/print mikrotik-controller
```

### Test Access
From a device on the same network:
```
http://<router-ip>:3000
```

---

## Troubleshooting

### Container Won't Start
```bash
# Check logs
/container/logs/print mikrotik-controller

# Verify image was imported
/container/print

# Check available resources
/system/resource/print
```

### Can't Access Web Interface
1. Verify container is running: `/container/print`
2. Check port forwarding rules: `/ip/firewall/nat/print`
3. Verify network connectivity: `ping 172.17.0.2`
4. Check firewall rules allow port 3000

### Database Not Persisting
- Ensure mount is configured correctly: `/container/print`
- Verify `/data` directory exists and is writable
- Check container logs for database errors

### Native Module Errors (better-sqlite3)
This should not happen if built correctly with the provided Dockerfile. If you see errors:
```bash
# Rebuild from scratch
docker builder prune --all
docker buildx build --platform linux/amd64 -t mikrotik-controller:latest --no-cache --load .
docker save -o mikrotik-controller-amd64.tar mikrotik-controller:latest
```

---

## Maintenance

### Update Container
```bash
# 1. Stop current container
/container/stop mikrotik-controller

# 2. Remove old container
/container/remove mikrotik-controller

# 3. Import new version
/container import file-name=mikrotik-controller-amd64-v2.tar

# 4. Re-add container with same settings
/container add name=mikrotik-controller image=mikrotik-controller:latest ...

# 5. Start new container
/container/start mikrotik-controller
```

### Backup Database
```bash
# From router terminal
/container/exec mikrotik-controller
# Inside container:
cp /data/mikrotik.db /data/mikrotik-backup-$(date +%Y%m%d).db
exit
```

### View Resource Usage
```bash
# Container resource usage
/container/print detail

# System resources
/system/resource/print
```

---

## Security Recommendations

1. **Change default credentials**: Update `ADMIN_USERNAME` and `ADMIN_PASSWORD`
2. **Use strong JWT_SECRET**: Generate a random 64-character string
3. **Enable HTTPS**: Use reverse proxy or SSL termination
4. **Restrict access**: Use firewall rules to limit who can access port 3000
5. **Regular updates**: Keep both RouterOS and container updated

---

## Performance Notes

- **Memory**: Container uses ~100-150MB RAM under normal load
- **CPU**: Minimal impact on router CPU
- **Storage**: ~200MB for container + database growth over time
- **Network**: Negligible overhead for management traffic

---

## Support

For issues related to:
- **RouterOS Containers**: [MikroTik Documentation](https://help.mikrotik.com/docs/display/ROS/Containers)
- **Application Issues**: Check container logs and application repository
- **Build Problems**: Verify Docker Desktop is updated and WSL2 is enabled

---

## Quick Reference

```bash
# Import container
/container import file-name=mikrotik-controller-amd64.tar

# Start container
/container/start mikrotik-controller

# Stop container
/container/stop mikrotik-controller

# View logs
/container/logs/print mikrotik-controller

# Check status
/container/print

# Remove container
/container/remove mikrotik-controller
```
