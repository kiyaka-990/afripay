// src/routes/auth.js — User registration, login, logout, API key management
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { logger } = require('../utils/logger');

// ─── In-memory user store (replace with DB in production) ─────────────────────
// Structure: { email -> { passwordHash, salt, tier, apiKey, apiKeyCreatedAt, createdAt } }
const USERS = new Map();
const SESSIONS = new Map(); // sessionToken -> email
const REVOKED_KEYS = new Set(); // rotated/revoked API keys

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function generateApiKey(tier = 'free') {
  const secret = process.env.API_KEY_SECRET || 'dev_secret_change_in_production';
  const tierPrefix = { free: 'afp_free_', starter: 'afp_start_', pro: 'afp_pro_', ultra: 'afp_ultra_' };
  const prefix = tierPrefix[tier] || 'afp_free_';
  const payload = prefix + crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
  return `${payload}.${sig}`;
}

function generateSession() {
  return crypto.randomBytes(32).toString('hex');
}

function getUserBySession(token) {
  const email = SESSIONS.get(token);
  if (!email) return null;
  return { email, ...USERS.get(email) };
}

// ─── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'MISSING_FIELDS', message: 'Email and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'INVALID_EMAIL', message: 'Invalid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' });
    }
    if (USERS.has(email.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const apiKey = generateApiKey('free');
    const now = new Date().toISOString();

    USERS.set(email.toLowerCase(), {
      name: name || email.split('@')[0],
      passwordHash, salt,
      tier: 'free',
      apiKey,
      apiKeyCreatedAt: now,
      createdAt: now
    });

    const sessionToken = generateSession();
    SESSIONS.set(sessionToken, email.toLowerCase());

    logger.info(`User registered: ${email}`);

    return res.status(201).json({
      success: true,
      session_token: sessionToken,
      user: { email: email.toLowerCase(), name: name || email.split('@')[0], tier: 'free' },
      api_key: apiKey,
      message: 'Account created successfully'
    });
  } catch (err) {
    logger.error(`Register error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

// ─── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'MISSING_FIELDS', message: 'Email and password are required' });
    }

    const user = USERS.get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const sessionToken = generateSession();
    SESSIONS.set(sessionToken, email.toLowerCase());

    logger.info(`User logged in: ${email}`);

    return res.json({
      success: true,
      session_token: sessionToken,
      user: { email: email.toLowerCase(), name: user.name, tier: user.tier },
      api_key: user.apiKey,
      api_key_created_at: user.apiKeyCreatedAt
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.headers['x-session-token'] || req.body?.session_token;
  if (token) SESSIONS.delete(token);
  return res.json({ success: true, message: 'Logged out successfully' });
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.headers['x-session-token'];
  const user = getUserBySession(token);
  if (!user) return res.status(401).json({ success: false, error: 'NOT_AUTHENTICATED' });

  return res.json({
    success: true,
    user: { email: user.email, name: user.name, tier: user.tier, createdAt: user.createdAt },
    api_key: user.apiKey,
    api_key_created_at: user.apiKeyCreatedAt
  });
});

// ─── POST /auth/rotate-key ─────────────────────────────────────────────────────
router.post('/rotate-key', (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const user = getUserBySession(token);
    if (!user) return res.status(401).json({ success: false, error: 'NOT_AUTHENTICATED' });

    // Revoke old key
    REVOKED_KEYS.add(user.apiKey);

    // Generate new key with same tier
    const newKey = generateApiKey(user.tier);
    const now = new Date().toISOString();

    // Update user record
    const userData = USERS.get(user.email);
    userData.apiKey = newKey;
    userData.apiKeyCreatedAt = now;
    USERS.set(user.email, userData);

    logger.info(`API key rotated for: ${user.email}`);

    return res.json({
      success: true,
      api_key: newKey,
      api_key_created_at: now,
      message: 'API key rotated. Previous key is now invalid.'
    });
  } catch (err) {
    logger.error(`Rotate key error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

// Export revoked keys checker for authenticate middleware
module.exports = { router, REVOKED_KEYS, SESSIONS, USERS };
