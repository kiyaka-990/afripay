// src/routes/disburse.js — POST /v1/disburse (Business-to-Customer payout)
const express = require('express');
const Joi     = require('joi');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const mpesa   = require('../services/mpesa');
const mtnMomo = require('../services/mtnMomo');
const airtel  = require('../services/airtel');
const { detectNetwork, getCurrencyForCountry } = require('../utils/networkDetector');
const { logger }          = require('../utils/logger');
const { saveTransaction } = require('../utils/transactionStore');

const disburseSchema = Joi.object({
  phone:        Joi.string().min(9).max(15).required(),
  amount:       Joi.number().positive().max(500000).required(),
  currency:     Joi.string().length(3).uppercase().optional(),
  reference:    Joi.string().max(20).required(),
  description:  Joi.string().max(100).optional(),
  network:      Joi.string().valid('mpesa', 'mtn_momo', 'airtel', 'auto').default('auto')
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = disburseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error:   'VALIDATION_ERROR',
        message: error.details[0].message,
        docs:    'https://docs.afripay.dev/endpoints/disburse'
      });
    }

    const { phone, amount, reference, description } = value;
    let { currency, network: requestedNetwork } = value;

    const phoneInfo = detectNetwork(phone);
    if (!phoneInfo.is_valid) {
      return res.status(400).json({
        success: false,
        error:   'INVALID_PHONE',
        message: `Phone '${phone}' could not be identified to a supported network`,
        supported_countries: ['KE', 'UG', 'GH', 'TZ', 'RW', 'ZM', 'NG']
      });
    }

    const network = requestedNetwork === 'auto' ? phoneInfo.network : requestedNetwork;
    currency = currency || getCurrencyForCountry(phoneInfo.country_code);

    const transactionId = `afp_d_${uuidv4().replace(/-/g, '').slice(0, 18)}`;
    logger.info(`Disburse initiated: ${transactionId} | ${network} | ${amount} ${currency} → ${phoneInfo.normalized}`);

    let providerResponse;
    switch (network) {
      case 'mpesa':
        providerResponse = await mpesa.b2c({ phone: phoneInfo.normalized, amount, reference, description });
        break;
      case 'mtn_momo':
        providerResponse = await mtnMomo.transfer({ phone: phoneInfo.normalized, amount, currency, reference });
        break;
      case 'airtel':
        providerResponse = await airtel.disburse({ phone: phoneInfo.normalized, amount, currency, reference });
        break;
      default:
        return res.status(400).json({
          success: false,
          error:   'UNSUPPORTED_NETWORK',
          message: `Network '${network}' is not supported for disbursements`
        });
    }

    await saveTransaction({
      id:           transactionId,
      provider_ref: providerResponse.provider_ref,
      type:         'disburse',
      network,
      phone:        phoneInfo.normalized,
      amount,
      currency,
      reference,
      status:       'pending',
      api_key:      req.apiKey,
      created_at:   new Date().toISOString()
    });

    return res.status(202).json({
      success:        true,
      transaction_id: transactionId,
      provider_ref:   providerResponse.provider_ref,
      status:         'pending',
      type:           'disburse',
      network,
      phone:          phoneInfo.normalized,
      amount,
      currency,
      message:        'Disbursement queued. Funds will be sent to the recipient shortly.',
      check_status:   `GET /v1/status/${transactionId}`
    });

  } catch (err) {
    logger.error(`Disburse error: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

module.exports = router;
