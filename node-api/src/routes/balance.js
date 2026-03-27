// src/routes/balance.js — GET /v1/balance
const express = require('express');
const router  = express.Router();
const mpesa   = require('../services/mpesa');
const mtnMomo = require('../services/mtnMomo');
const airtel  = require('../services/airtel');
const snipe   = require('../services/snipe');
const { logger } = require('../utils/logger');

router.get('/', async (req, res, next) => {
  try {
    const [mpesaResult, mtnResult, airtelResult, snipeResult] = await Promise.allSettled([
      mpesa.getBalance(),
      mtnMomo.getBalance(),
      airtel.getBalance(),
      snipe.getBalance()
    ]);

    const balances = {
      mpesa: mpesaResult.status === 'fulfilled'
        ? { available: mpesaResult.value.balance, currency: mpesaResult.value.currency, status: 'ok' }
        : { status: 'error', reason: mpesaResult.reason?.message || 'unavailable' },

      mtn_momo: mtnResult.status === 'fulfilled'
        ? { available: mtnResult.value.balance, currency: mtnResult.value.currency, status: 'ok' }
        : { status: 'error', reason: mtnResult.reason?.message || 'unavailable' },

      airtel: airtelResult.status === 'fulfilled'
        ? { available: airtelResult.value.balance, currency: airtelResult.value.currency, status: 'ok' }
        : { status: 'error', reason: airtelResult.reason?.message || 'unavailable' },

      snipe: snipeResult.status === 'fulfilled'
        ? { available: snipeResult.value.balance, currency: snipeResult.value.currency, status: 'ok' }
        : { status: 'error', reason: snipeResult.reason?.message || 'unavailable' }
    };

    logger.debug(`Balance check by API key: ${req.apiKey?.slice(0, 8)}...`);

    return res.json({
      success:      true,
      balances,
      retrieved_at: new Date().toISOString()
    });

  } catch (err) {
    logger.error(`Balance check error: ${err.message}`);
    next(err);
  }
});

module.exports = router;
