// src/routes/health.js — GET /health
const express = require('express');
const router  = express.Router();
const { logger } = require('../utils/logger');

const START_TIME = Date.now();

router.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);

  const health = {
    status:    'ok',
    version:   process.env.npm_package_version || '1.0.0',
    env:       process.env.NODE_ENV || 'development',
    uptime_s:  uptime,
    timestamp: new Date().toISOString(),
    providers: {
      mpesa:    process.env.MPESA_CONSUMER_KEY    ? 'configured' : 'missing_credentials',
      mtn_momo: process.env.MTN_MOMO_API_USER     ? 'configured' : 'missing_credentials',
      airtel:   process.env.AIRTEL_CLIENT_ID      ? 'configured' : 'missing_credentials'
    }
  };

  const allOk = Object.values(health.providers).every(v => v === 'configured');
  if (!allOk) health.status = 'degraded';

  logger.debug('Health check');
  return res.status(allOk ? 200 : 207).json(health);
});

module.exports = router;
