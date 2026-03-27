// src/routes/pay.js - POST /v1/pay — unified payment initiation
const express  = require('express');
const Joi      = require('joi');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const mpesa    = require('../services/mpesa');
const mtnMomo  = require('../services/mtnMomo');
const airtel   = require('../services/airtel');
const snipe    = require('../services/snipe');
const { detectNetwork, getCurrencyForCountry } = require('../utils/networkDetector');
const { logger }          = require('../utils/logger');
const { saveTransaction } = require('../utils/transactionStore');

const paySchema = Joi.object({
  phone:        Joi.string().min(9).max(15).required(),
  amount:       Joi.number().positive().max(150000).required(),
  currency:     Joi.string().length(3).uppercase().optional(),
  reference:    Joi.string().max(20).required(),
  description:  Joi.string().max(100).optional(),
  callback_url: Joi.string().uri().optional(),
  network:      Joi.string().valid('mpesa', 'mtn_momo', 'airtel', 'snipe', 'auto').default('auto')
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = paySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error:   'VALIDATION_ERROR',
        message: error.details[0].message,
        docs:    'https://docs.afripay.dev/endpoints/pay'
      });
    }

    const { phone, amount, reference, description, callback_url } = value;
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

    const transactionId = `afp_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
    logger.info(`Payment initiated: ${transactionId} | ${network} | ${phoneInfo.country_code} | ${amount} ${currency}`);

    let providerResponse;
    switch (network) {
      case 'mpesa':
        providerResponse = await mpesa.stkPush({ phone: phoneInfo.normalized, amount, reference, description, callbackUrl: callback_url });
        break;
      case 'mtn_momo':
        providerResponse = await mtnMomo.requestPayment({ phone: phoneInfo.normalized, amount, currency, reference, callbackUrl: callback_url });
        break;
      case 'airtel':
        providerResponse = await airtel.ussdPush({ phone: phoneInfo.normalized, amount, currency, reference, callbackUrl: callback_url });
        break;
      case 'snipe':
        providerResponse = await snipe.collect({ phone: phoneInfo.normalized, amount, currency, reference, description, callbackUrl: callback_url });
        break;
      default:
        return res.status(400).json({
          success: false,
          error:   'UNSUPPORTED_NETWORK',
          message: `Network '${network}' is not supported`,
          detected_network: phoneInfo.network
        });
    }

    await saveTransaction({
      id:           transactionId,
      provider_ref: providerResponse.provider_ref,
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
      network,
      phone:          phoneInfo.normalized,
      amount,
      currency,
      country:        phoneInfo.country,
      ussd_code:      providerResponse.ussd_code || null,
      message:        'Payment request sent. Customer will receive a prompt on their phone.',
      check_status:   `GET /v1/status/${transactionId}`
    });

  } catch (err) {
    logger.error(`Payment error: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

module.exports = router;
