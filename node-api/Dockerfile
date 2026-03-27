# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Security: run as non-root
RUN addgroup -S afripay && adduser -S afripay -G afripay

COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

RUN chown -R afripay:afripay /app
USER afripay

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
