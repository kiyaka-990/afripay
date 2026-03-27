// src/middleware/rateLimiter.js — Tier-based rate limiting
const rateLimit = require('express-rate-limit');

// Requests allowed per 15-minute window per API key
const TIER_LIMITS = {
  free:    parseInt(process.env.RATE_LIMIT_FREE    || '100'),
  starter: parseInt(process.env.RATE_LIMIT_STARTER || '500'),
  pro:     parseInt(process.env.RATE_LIMIT_PRO     || '2000'),
  ultra:   parseInt(process.env.RATE_LIMIT_ULTRA   || '10000')
};

function getTier(apiKey = '') {
  if (apiKey.startsWith('afp_ultra_'))  return 'ultra';
  if (apiKey.startsWith('afp_pro_'))    return 'pro';
  if (apiKey.startsWith('afp_start_')) return 'starter';
  return 'free';
}

// Dynamic limiter — checks tier on every request
const rateLimiter = rateLimit({
  windowMs:          15 * 60 * 1000,  // 15 minutes
  max:               (req) => {
    const tier = getTier(req.apiKey);
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
  },
  keyGenerator:      (req) => req.apiKey || req.ip,
  standardHeaders:   true,
  legacyHeaders:     false,
  handler: (req, res) => {
    const tier  = getTier(req.apiKey);
    const limit = TIER_LIMITS[tier];
    res.status(429).json({
      success: false,
      error:   'RATE_LIMIT_EXCEEDED',
      message: `You've exceeded the ${limit} requests/15 min limit for the ${tier} tier.`,
      upgrade: tier !== 'ultra' ? 'https://afripay.dev/pricing' : null,
      retry_after_s: Math.ceil(res.getHeader('Retry-After') || 900)
    });
  }
});

module.exports = { rateLimiter, getTier, TIER_LIMITS };
