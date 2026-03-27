// src/middleware/authenticate.js — API key validation
const crypto = require('crypto');
const { logger } = require('../utils/logger');

// In production: validate against DB / Redis key store
// Here: validate format + HMAC signature
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error:   'MISSING_API_KEY',
      message: 'Provide your API key as: Authorization: Bearer afp_...',
      docs:    'https://docs.afripay.dev/authentication'
    });
  }

  // Format check: must start with afp_ and be at least 32 chars
  if (!apiKey.startsWith('afp_') || apiKey.length < 32) {
    return res.status(401).json({
      success: false,
      error:   'INVALID_API_KEY_FORMAT',
      message: 'API key format is invalid. Keys begin with afp_ and are at least 32 characters.',
      docs:    'https://docs.afripay.dev/authentication'
    });
  }

  // HMAC integrity check — confirms the key was issued by AfriPay
  const secret = process.env.API_KEY_SECRET || 'dev_secret_change_in_production';
  const [payload, sig] = apiKey.split('.');

  if (sig) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
      .slice(0, 16);

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      logger.warn(`Auth failed: invalid signature for key ...${apiKey.slice(-6)}`);
      return res.status(401).json({
        success: false,
        error:   'INVALID_API_KEY',
        message: 'API key signature is invalid or has been tampered with.'
      });
    }
  }

  req.apiKey = apiKey;
  logger.debug(`Authenticated: ...${apiKey.slice(-6)}`);
  next();
}

module.exports = { authenticate };
