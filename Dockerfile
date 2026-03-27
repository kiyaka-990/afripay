# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY node-api/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Security: non-root user
RUN addgroup -S afripay && adduser -S afripay -G afripay

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy API source
COPY node-api/src/ ./src/
COPY node-api/package.json ./

# Copy dashboard — served as static files by Express
COPY dashboard/ ./dashboard/

RUN chown -R afripay:afripay /app
USER afripay

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
