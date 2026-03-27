// src/server.js - AfriPay API Server
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const { logger } = require('./utils/logger');

const payRoutes      = require('./routes/pay');
const statusRoutes   = require('./routes/status');
const disburseRoutes = require('./routes/disburse');
const balanceRoutes  = require('./routes/balance');
const webhookRoutes  = require('./routes/webhooks');
const keysRoutes     = require('./routes/keys');
const healthRoutes   = require('./routes/health');
const billingRoutes  = require('./routes/billing');

const { rateLimiter }  = require('./middleware/rateLimiter');
const { authenticate } = require('./middleware/authenticate');
const { errorHandler } = require('./middleware/errorHandler');
const { requestId }    = require('./middleware/requestId');

const app = express();

// In Docker: dashboard/ is at /app/dashboard/ (same level as src/)
// In dev:    dashboard/ is two levels up from node-api/src/
const dashboardPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '..', 'dashboard')           // /app/dashboard
  : path.resolve(__dirname, '..', '..', 'dashboard');    // afripay/dashboard

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestId);
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.use(express.static(dashboardPath));

// ─── Public Routes ────────────────────────────────────────────────────────────
app.use('/health',      healthRoutes);
app.use('/v1/webhooks', webhookRoutes);
// Stripe webhook needs raw body — must be before authenticated routes
app.use('/v1/billing/webhook', billingRoutes);
app.use('/v1/billing/config',  billingRoutes);  // public — no auth

// ─── Authenticated Routes ─────────────────────────────────────────────────────
app.use('/v1', authenticate, rateLimiter);
app.use('/v1/pay',      payRoutes);
app.use('/v1/status',   statusRoutes);
app.use('/v1/disburse', disburseRoutes);
app.use('/v1/balance',  balanceRoutes);
app.use('/v1/keys',     keysRoutes);
app.use('/v1/billing',  billingRoutes);

// ─── Catch-all → dashboard ────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/v1') || req.path.startsWith('/health')) return next();
  const indexFile = path.join(dashboardPath, 'index.html');
  const fs = require('fs');

  // Try all possible paths where dashboard could live
  const candidates = [
    indexFile,
    path.resolve(__dirname, '..', 'dashboard', 'index.html'),       // /app/dashboard
    path.resolve(__dirname, '..', '..', 'dashboard', 'index.html'), // dev: afripay/dashboard
    path.resolve(process.cwd(), 'dashboard', 'index.html'),         // cwd/dashboard
  ];

  const found = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });

  if (found) {
    return res.sendFile(found);
  }

  logger.error(`Dashboard not found. Tried: ${candidates.join(', ')}`);
  res.status(500).json({
    success: false,
    error: 'DASHBOARD_NOT_FOUND',
    message: `Dashboard not found at ${indexFile}`,
    tried: candidates
  });
});

// ─── 404 & Error Handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, docs: 'https://docs.afripay.dev' });
});
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`AfriPay API  →  http://localhost:${PORT}`);
  logger.info(`Dashboard    →  http://localhost:${PORT}`);
  logger.info(`Health       →  http://localhost:${PORT}/health`);
  logger.info(`Dashboard path: ${dashboardPath}`);
});

module.exports = app;
