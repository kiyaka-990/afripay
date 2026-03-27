// src/routes/status.js — GET /v1/status/:id
const express = require('express');
const router  = express.Router();
const { getTransaction } = require('../utils/transactionStore');
const { logger }         = require('../utils/logger');

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !id.startsWith('afp_')) {
      return res.status(400).json({
        success: false,
        error:   'INVALID_TRANSACTION_ID',
        message: 'Transaction ID must start with afp_',
        docs:    'https://docs.afripay.dev/endpoints/status'
      });
    }

    const tx = await getTransaction(id);

    if (!tx) {
      return res.status(404).json({
        success: false,
        error:   'TRANSACTION_NOT_FOUND',
        message: `No transaction found with ID ${id}`,
        docs:    'https://docs.afripay.dev/endpoints/status'
      });
    }

    // Ownership check — API key must match the one that created it
    if (tx.api_key !== req.apiKey) {
      return res.status(403).json({
        success: false,
        error:   'FORBIDDEN',
        message: 'This transaction does not belong to your API key'
      });
    }

    logger.debug(`Status check: ${id} → ${tx.status}`);

    return res.json({
      success:        true,
      transaction_id: tx.id,
      provider_ref:   tx.provider_ref,
      status:         tx.status,          // pending | completed | failed | cancelled
      network:        tx.network,
      phone:          tx.phone,
      amount:         tx.amount,
      currency:       tx.currency,
      reference:      tx.reference,
      failure_reason: tx.failure_reason || null,
      created_at:     tx.created_at,
      updated_at:     tx.updated_at || tx.created_at
    });

  } catch (err) {
    logger.error(`Status check error: ${err.message}`);
    next(err);
  }
});

module.exports = router;
