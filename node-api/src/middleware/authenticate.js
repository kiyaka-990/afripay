// src/middleware/authenticate.js — API key validation
const crypto = require('crypto');
const { logger } = require('../utils/logger');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error:   'MISSING_API_KEY',
      message: 'Provide your API key as: Authorization: Bearer afp_...',
      docs:    'https://afripay.up.railway.app/docs'
    });
  }

  if (!apiKey.startsWith('afp_') || apiKey.length < 32) {
    return res.status(401).json({
      success: false,
      error:   'INVALID_API_KEY_FORMAT',
      message: 'API key format is invalid. Keys begin with afp_ and are at least 32 characters.',
      docs:    'https://afripay.up.railway.app/docs'
    });
  }

  // Check revoked keys
  try {
    const { REVOKED_KEYS } = require('../routes/auth');
    if (REVOKED_KEYS.has(apiKey)) {
      logger.warn(`Revoked key used: ...${apiKey.slice(-6)}`);
      return res.status(401).json({
        success: false,
        error:   'API_KEY_REVOKED',
        message: 'This API key has been rotated or revoked. Please use your new key.'
      });
    }
  } catch(e) { /* auth module not loaded yet */ }

  // HMAC integrity check
  const secret = process.env.API_KEY_SECRET || 'dev_secret_change_in_production';
  const parts = apiKey.split('.');
  if (parts.length === 2) {
    const [payload, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
      .slice(0, 16);

    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        logger.warn(`Auth failed: invalid signature for key ...${apiKey.slice(-6)}`);
        return res.status(401).json({
          success: false,
          error:   'INVALID_API_KEY',
          message: 'API key signature is invalid or has been tampered with.'
        });
      }
    } catch(e) {
      return res.status(401).json({ success: false, error: 'INVALID_API_KEY', message: 'Malformed API key.' });
    }
  }

  req.apiKey = apiKey;
  logger.debug(`Authenticated: ...${apiKey.slice(-6)}`);
  next();
}

module.exports = { authenticate };
