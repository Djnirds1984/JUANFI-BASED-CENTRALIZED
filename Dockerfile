# Multi-stage Dockerfile for MikroTik RouterOS x86_64 Container
# Target: linux/amd64 architecture

# ============================================
# Stage 1: Build Stage
# ============================================
FROM --platform=linux/amd64 node:18-alpine AS builder

# Install build dependencies for native modules (better-sqlite3, ssh2)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    musl-dev \
    linux-headers

WORKDIR /app

# Copy package files first (for better layer caching)
COPY package*.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# ============================================
# Stage 2: Production Runtime
# ============================================
FROM --platform=linux/amd64 node:18-alpine

# Install runtime dependencies for native modules
RUN apk add --no-cache \
    libstdc++ \
    tini

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S mikrotik && \
    adduser -u 1001 -S mikrotik -G mikrotik

# Copy built application from builder stage
COPY --from=builder --chown=mikrotik:mikrotik /app/dist ./dist
COPY --from=builder --chown=mikrotik:mikrotik /app/node_modules ./node_modules
COPY --from=builder --chown=mikrotik:mikrotik /app/package*.json ./

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R mikrotik:mikrotik /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/mikrotik.db

# Expose port
EXPOSE 3000

# Use tini as init system (handles signals properly)
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/server.js"]
