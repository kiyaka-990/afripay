// src/middleware/errorHandler.js — Central error handler
const { logger } = require('../utils/logger');

// Map provider-specific error codes to clean AfriPay errors
const PROVIDER_ERROR_MAP = {
  // M-Pesa
  '1':    { code: 'INSUFFICIENT_FUNDS',   status: 422 },
  '17':   { code: 'MPESA_LIMIT_EXCEEDED', status: 422 },
  '1032': { code: 'PAYMENT_CANCELLED',    status: 422 },
  '1037': { code: 'MPESA_TIMEOUT',        status: 504 },
  // MTN
  'PAYER_NOT_FOUND':          { code: 'PHONE_NOT_REGISTERED', status: 422 },
  'NOT_ALLOWED':              { code: 'NETWORK_RESTRICTED',   status: 403 },
  'INTERNAL_PROCESSING_ERROR': { code: 'PROVIDER_ERROR',      status: 502 },
  // Airtel
  'ESB000033': { code: 'AIRTEL_LIMIT_EXCEEDED', status: 422 },
  'DP00800001006': { code: 'INVALID_MSISDN',    status: 400 }
};

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = req.requestId || 'unknown';

  // Axios / provider errors
  if (err.isAxiosError) {
    const providerCode = err.response?.data?.errorCode
                      || err.response?.data?.ResultCode
                      || String(err.response?.status);

    const mapped = PROVIDER_ERROR_MAP[providerCode];

    if (mapped) {
      logger.warn(`Provider error [${requestId}]: ${providerCode} → ${mapped.code}`);
      return res.status(mapped.status).json({
        success:    false,
        error:      mapped.code,
        message:    friendlyMessage(mapped.code),
        request_id: requestId
      });
    }

    // Generic provider failure
    logger.error(`Provider HTTP error [${requestId}]: ${err.response?.status} ${err.message}`);
    return res.status(502).json({
      success:    false,
      error:      'PROVIDER_ERROR',
      message:    'The payment provider returned an unexpected error. Please retry.',
      request_id: requestId
    });
  }

  // Timeout
  if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
    logger.warn(`Timeout [${requestId}]: ${err.message}`);
    return res.status(504).json({
      success:    false,
      error:      'PROVIDER_TIMEOUT',
      message:    'The payment provider did not respond in time. The payment may still process.',
      request_id: requestId
    });
  }

  // Unhandled
  logger.error(`Unhandled error [${requestId}]: ${err.message}`, { stack: err.stack });
  return res.status(500).json({
    success:    false,
    error:      'INTERNAL_ERROR',
    message:    'An unexpected error occurred.',
    request_id: requestId,
    docs:       'https://docs.afripay.dev/errors'
  });
}

function friendlyMessage(code) {
  const messages = {
    INSUFFICIENT_FUNDS:     'The customer has insufficient funds in their mobile wallet.',
    MPESA_LIMIT_EXCEEDED:   'This transaction exceeds the M-Pesa daily limit.',
    PAYMENT_CANCELLED:      'The customer cancelled the payment prompt.',
    MPESA_TIMEOUT:          'The customer did not respond to the M-Pesa prompt in time.',
    PHONE_NOT_REGISTERED:   'The phone number is not registered on this mobile money network.',
    NETWORK_RESTRICTED:     'This transaction type is not allowed in the customer\'s country.',
    PROVIDER_ERROR:         'The payment provider encountered an internal error.',
    AIRTEL_LIMIT_EXCEEDED:  'This transaction exceeds the Airtel Money limit.',
    INVALID_MSISDN:         'The phone number provided is not a valid Airtel number.'
  };
  return messages[code] || 'An error occurred with the payment provider.';
}

module.exports = { errorHandler };
