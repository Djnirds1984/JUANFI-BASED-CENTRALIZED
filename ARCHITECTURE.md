# Project Structure

```
JUANFI-BASED-CENTRALIZED/
├── src/                          # TypeScript source code
│   ├── server.ts                 # Main server entry point
│   ├── config.ts                 # Configuration loader
│   ├── database.ts               # SQLite database setup & schema
│   │
│   ├── api/                      # REST API routes
│   │   ├── auth.ts              # Authentication endpoints
│   │   ├── routers.ts           # Router management
│   │   ├── hotspot.ts           # Hotspot user management
│   │   ├── bandwidth.ts         # Bandwidth/queue management
│   │   ├── vouchers.ts          # Voucher generation & management
│   │   └── monitoring.ts        # System monitoring & stats
│   │
│   ├── services/                 # Business logic
│   │   ├── mikrotik.ts          # MikroTik RouterOS API client
│   │   ├── auth.ts              # Authentication service
│   │   └── monitor.ts           # Monitoring scheduler
│   │
│   └── middleware/               # Express middleware
│       └── auth.ts              # JWT authentication middleware
│
├── public/                       # Frontend static files
│   ├── index.html               # Main HTML page
│   ├── css/
│   │   └── style.css            # Dashboard styles
│   └── js/
│       ├── api.js               # API client wrapper
│       └── app.js               # Main application logic
│
├── deploy/                       # Deployment scripts
│   ├── install.sh               # Installation script for Ubuntu/Debian
│   ├── uninstall.sh             # Uninstallation script
│   ├── update.sh                # Update script with backup
│   └── mikrotik-controller.service  # Systemd service file
│
├── data/                         # Database files (created at runtime)
│   └── mikrotik-controller.db   # SQLite database
│
├── dist/                         # Compiled JavaScript (generated)
│
├── package.json                  # Node.js dependencies
├── tsconfig.json                 # TypeScript configuration
├── .env                          # Environment variables (create from .env.example)
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── README.md                     # Full documentation
└── QUICKSTART.md                 # Quick start guide
```

## Architecture Overview

### Backend (Node.js + TypeScript)

**Server Layer** (`src/server.ts`)
- Express.js HTTP server
- Socket.IO for real-time updates
- Middleware setup (CORS, Helmet, Morgan)
- Route mounting
- Graceful shutdown handling

**API Layer** (`src/api/`)
- RESTful endpoints for all features
- JWT-based authentication
- Input validation
- Error handling
- Response formatting

**Service Layer** (`src/services/`)
- `mikrotik.ts`: RouterOS API client wrapper
  - Connection management
  - Hotspot user operations
  - Queue management
  - System info retrieval
- `auth.ts`: Authentication logic
  - Password hashing (bcrypt)
  - JWT token generation/validation
- `monitor.ts`: Monitoring scheduler
  - Periodic metrics collection
  - Auto-reconnection
  - Historical data storage

**Database Layer** (`src/database.ts`)
- SQLite with better-sqlite3
- WAL mode for better concurrency
- Foreign key constraints
- Indexed queries
- Schema migrations

### Frontend (Vanilla JavaScript)

**Single Page Application**
- No framework dependencies
- Minimal bundle size
- Fast loading on SBC hardware
- Responsive design

**Components**
- Login screen
- Dashboard overview
- Router management
- Hotspot user management
- Bandwidth queue management
- Voucher generation
- Monitoring dashboard

### Database Schema

**routers** - Connected MikroTik devices
- Connection details
- Status tracking

**hotspot_users** - Local user records
- Synced with router
- Metadata storage

**bandwidth_profiles** - Queue templates
- Rate limits
- Priority settings

**vouchers** - Generated voucher codes
- Usage tracking
- Expiration dates

**admin_users** - System administrators
- Hashed passwords
- Role-based access

**monitoring_logs** - Historical metrics
- CPU, memory, uptime
- Time-series data

## Data Flow

### Router Connection
```
User → API → MikroTikService → RouterOS API → MikroTik Router
```

### Hotspot User Creation
```
User → API → Create in DB → MikroTikService → RouterOS API → Router
```

### Monitoring Collection
```
Scheduler → MikroTikService → RouterOS API → Router
         → Store in DB → Dashboard
```

### Voucher Generation
```
User → API → Generate codes → Store in DB → MikroTikService → Router
```

## Security Features

1. **Authentication**
   - JWT tokens (24h expiry)
   - Bcrypt password hashing
   - Protected API endpoints

2. **Input Validation**
   - Required field checks
   - Type validation
   - SQL injection prevention (parameterized queries)

3. **Network Security**
   - CORS configuration
   - Helmet.js security headers
   - HTTPS recommended for production

4. **System Security**
   - Dedicated system user (no root)
   - Systemd sandboxing
   - File permission restrictions

## Performance Considerations

### SBC Optimization
- SQLite (no separate DB server)
- Connection pooling for routers
- Efficient queries with indexes
- Minimal memory footprint (<100MB idle)

### Scalability
- Supports 50+ routers
- Handles 1000+ hotspot users
- Async operations for non-blocking I/O
- Background monitoring

## Deployment Architecture

### Development
```
Developer → npm run dev → TypeScript → Node.js → Local DB
```

### Production (SBC/Mini PC)
```
Internet → Nginx (HTTPS) → Node.js → SQLite
                              ↓
                         MikroTik Routers (API)
```

### Systemd Service
- Auto-start on boot
- Automatic restart on failure
- Logging to journalctl
- Resource limits

## API Documentation

See README.md for complete API reference.

### Authentication Flow
1. POST `/api/auth/login` with credentials
2. Receive JWT token
3. Include token in `Authorization: Bearer <token>` header
4. Token valid for 24 hours

### Rate Limiting
Not implemented in v1.0. Consider adding:
- express-rate-limit
- Per-IP throttling
- API quotas

## Testing

### Manual Testing
```bash
# Start development server
npm run dev

# Test API endpoints
curl http://localhost:3000/api/health
```

### Automated Testing
Not included in v1.0. Recommended additions:
- Jest for unit tests
- Supertest for API tests
- Coverage reporting

## Monitoring & Logging

### Application Logs
- Console output (development)
- journalctl (production)
- Configurable log levels

### Metrics Collection
- Every 5 minutes (configurable)
- CPU, memory, uptime
- Stored in SQLite
- Queryable via API

### Alerts
Not implemented in v1.0. Consider:
- Email notifications
- Webhook integration
- Threshold-based alerts

## Backup Strategy

### Database Backup
```bash
# Manual backup
cp /opt/mikrotik-controller/data/mikrotik-controller.db ~/backup.db

# Automated (cron)
0 2 * * * cp /opt/mikrotik-controller/data/mikrotik-controller.db /backups/db-$(date +\%Y\%m\%d).db
```

### Configuration Backup
```bash
cp /opt/mikrotik-controller/.env ~/env-backup
```

## Troubleshooting

### Common Issues
1. **Cannot connect to router**
   - Check API enabled on MikroTik
   - Verify credentials
   - Test network connectivity

2. **Service won't start**
   - Check logs: `journalctl -u mikrotik-controller`
   - Verify permissions
   - Check .env file

3. **High memory usage**
   - Reduce monitoring frequency
   - Clear old logs
   - Restart service

See QUICKSTART.md for detailed troubleshooting.
