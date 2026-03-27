// src/routes/webhooks.js — Inbound callbacks from M-Pesa, MTN MoMo, Airtel
const express = require('express');
const router  = express.Router();
const { updateTransaction, getTransactionByProviderRef } = require('../utils/transactionStore');
const { logger } = require('../utils/logger');

// ─── M-Pesa STK Push Callback ─────────────────────────────────────────────────
router.post('/mpesa', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      logger.warn('M-Pesa webhook: malformed payload');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const providerRef  = callback.CheckoutRequestID;
    const resultCode   = callback.ResultCode;
    const resultDesc   = callback.ResultDesc;

    const tx = await getTransactionByProviderRef(providerRef);
    if (!tx) {
      logger.warn(`M-Pesa webhook: unknown provider_ref ${providerRef}`);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const status = resultCode === 0 ? 'completed' : 'failed';
    await updateTransaction(tx.id, {
      status,
      failure_reason: resultCode !== 0 ? resultDesc : null,
      updated_at: new Date().toISOString()
    });

    logger.info(`M-Pesa webhook: ${tx.id} → ${status} (${resultDesc})`);

    // M-Pesa requires exactly this response shape
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  } catch (err) {
    logger.error(`M-Pesa webhook error: ${err.message}`);
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // always ACK
  }
});

// ─── MTN MoMo Callback ────────────────────────────────────────────────────────
router.post('/mtn', async (req, res) => {
  try {
    const { referenceId, status, reason } = req.body || {};

    if (!referenceId) {
      logger.warn('MTN webhook: missing referenceId');
      return res.sendStatus(200);
    }

    const tx = await getTransactionByProviderRef(referenceId);
    if (!tx) {
      logger.warn(`MTN webhook: unknown referenceId ${referenceId}`);
      return res.sendStatus(200);
    }

    const normalized = status === 'SUCCESSFUL' ? 'completed'
                     : status === 'FAILED'     ? 'failed'
                     : 'pending';

    await updateTransaction(tx.id, {
      status: normalized,
      failure_reason: normalized === 'failed' ? (reason || 'MTN transaction failed') : null,
      updated_at: new Date().toISOString()
    });

    logger.info(`MTN webhook: ${tx.id} → ${normalized}`);
    return res.sendStatus(200);

  } catch (err) {
    logger.error(`MTN webhook error: ${err.message}`);
    return res.sendStatus(200);
  }
});

// ─── Airtel Money Callback ────────────────────────────────────────────────────
router.post('/airtel', async (req, res) => {
  try {
    const { transaction } = req.body || {};
    if (!transaction) {
      logger.warn('Airtel webhook: malformed payload');
      return res.sendStatus(200);
    }

    const { id: providerRef, status, message } = transaction;
    const tx = await getTransactionByProviderRef(providerRef);

    if (!tx) {
      logger.warn(`Airtel webhook: unknown transaction id ${providerRef}`);
      return res.sendStatus(200);
    }

    const normalized = status === 'TS'  ? 'completed'   // Transaction Successful
                     : status === 'TF'  ? 'failed'      // Transaction Failed
                     : status === 'TA'  ? 'pending'     // Transaction Accepted
                     : 'pending';

    await updateTransaction(tx.id, {
      status: normalized,
      failure_reason: normalized === 'failed' ? (message || 'Airtel transaction failed') : null,
      updated_at: new Date().toISOString()
    });

    logger.info(`Airtel webhook: ${tx.id} → ${normalized}`);
    return res.sendStatus(200);

  } catch (err) {
    logger.error(`Airtel webhook error: ${err.message}`);
    return res.sendStatus(200);
  }
});

module.exports = router;

// ─── Snipe Callback ───────────────────────────────────────────────────────────
router.post('/snipe', async (req, res) => {
  try {
    const { transaction_id, status, message } = req.body || {};

    if (!transaction_id) {
      logger.warn('Snipe webhook: missing transaction_id');
      return res.sendStatus(200);
    }

    const tx = await getTransactionByProviderRef(transaction_id);
    if (!tx) {
      logger.warn(`Snipe webhook: unknown transaction_id ${transaction_id}`);
      return res.sendStatus(200);
    }

    const normalized = status === 'success'    ? 'completed'
                     : status === 'failed'     ? 'failed'
                     : status === 'processing' ? 'pending'
                     : 'pending';

    await updateTransaction(tx.id, {
      status:         normalized,
      failure_reason: normalized === 'failed' ? (message || 'Snipe transaction failed') : null,
      updated_at:     new Date().toISOString()
    });

    logger.info(`Snipe webhook: ${tx.id} → ${normalized}`);
    return res.sendStatus(200);

  } catch (err) {
    logger.error(`Snipe webhook error: ${err.message}`);
    return res.sendStatus(200);
  }
});
