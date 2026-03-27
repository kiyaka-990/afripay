// src/routes/keys.js — GET /v1/keys/me
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { logger } = require('../utils/logger');

// Tier definitions — in production these would come from a DB
const TIER_CONFIG = {
  free:    { rate_limit: 100,   max_amount: 10000,  features: ['pay', 'status'] },
  starter: { rate_limit: 500,   max_amount: 50000,  features: ['pay', 'status', 'disburse'] },
  pro:     { rate_limit: 2000,  max_amount: 150000, features: ['pay', 'status', 'disburse', 'balance'] },
  ultra:   { rate_limit: 10000, max_amount: 500000, features: ['pay', 'status', 'disburse', 'balance', 'batch'] }
};

router.get('/me', (req, res) => {
  try {
    const apiKey = req.apiKey;

    // Derive a stable key fingerprint (last 8 chars + SHA256 prefix)
    const fingerprint = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex')
      .slice(0, 8);

    // In production: look up tier from DB. Here: infer from key prefix
    const tierMap = { 'afp_free_': 'free', 'afp_start_': 'starter', 'afp_pro_': 'pro', 'afp_ultra_': 'ultra' };
    let tier = 'free';
    for (const [prefix, t] of Object.entries(tierMap)) {
      if (apiKey.startsWith(prefix)) { tier = t; break; }
    }

    const config = TIER_CONFIG[tier] || TIER_CONFIG.free;

    logger.debug(`Keys/me: fingerprint=${fingerprint} tier=${tier}`);

    return res.json({
      success: true,
      key: {
        fingerprint:   `...${apiKey.slice(-8)}`,
        tier,
        rate_limit:    `${config.rate_limit} requests / 15 min`,
        max_amount:    config.max_amount,
        features:      config.features,
        environments:  ['sandbox', 'production'],
        created_at:    null, // populated from DB in production
        docs:          'https://docs.afripay.dev/authentication'
      }
    });

  } catch (err) {
    logger.error(`Keys/me error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
