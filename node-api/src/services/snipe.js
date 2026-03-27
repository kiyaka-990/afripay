// src/services/snipe.js — Snipe Payment integration
// Snipe is a pan-African payment network supporting card, mobile money & USSD
// Docs: https://developers.snipepay.io

const axios  = require('axios');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.SNIPE_ENV === 'production'
  ? 'https://api.snipepay.io/v1'
  : 'https://sandbox.snipepay.io/v1';

// Token cache
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const { data } = await axios.post(`${BASE_URL}/oauth/token`, {
    client_id:     process.env.SNIPE_CLIENT_ID,
    client_secret: process.env.SNIPE_CLIENT_SECRET,
    grant_type:    'client_credentials'
  });

  tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000
  };

  logger.debug('Snipe token refreshed');
  return tokenCache.token;
}

function headers(token) {
  return {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Snipe-Key':  process.env.SNIPE_PUBLIC_KEY
  };
}

// ─── Collect (Customer pays) ──────────────────────────────────────────────────
async function collect({ phone, amount, currency, reference, description, callbackUrl }) {
  const token = await getAccessToken();

  const { data } = await axios.post(`${BASE_URL}/payments/collect`, {
    msisdn:       phone,
    amount,
    currency,
    reference,
    description:  description || 'AfriPay payment',
    callback_url: callbackUrl || process.env.SNIPE_CALLBACK_URL,
    channel:      'mobile_money'   // mobile_money | ussd | card
  }, { headers: headers(token), timeout: 30000 });

  logger.info(`Snipe collect initiated: ref=${data.transaction_id}`);

  return {
    provider_ref: data.transaction_id,
    status:       data.status,     // pending | processing | success | failed
    ussd_code:    data.ussd_code || null,
    message:      data.message
  };
}

// ─── Disburse (Business pays out) ────────────────────────────────────────────
async function disburse({ phone, amount, currency, reference, description }) {
  const token = await getAccessToken();

  const { data } = await axios.post(`${BASE_URL}/payments/disburse`, {
    msisdn:      phone,
    amount,
    currency,
    reference,
    description: description || 'AfriPay disbursement',
    channel:     'mobile_money'
  }, { headers: headers(token), timeout: 30000 });

  logger.info(`Snipe disburse initiated: ref=${data.transaction_id}`);

  return {
    provider_ref: data.transaction_id,
    status:       data.status,
    message:      data.message
  };
}

// ─── Balance ──────────────────────────────────────────────────────────────────
async function getBalance() {
  const token = await getAccessToken();
  const { data } = await axios.get(`${BASE_URL}/account/balance`, {
    headers: headers(token),
    timeout: 10000
  });

  return { balance: data.available_balance, currency: data.currency };
}

// ─── Transaction Status ───────────────────────────────────────────────────────
async function getStatus(transactionId) {
  const token = await getAccessToken();
  const { data } = await axios.get(`${BASE_URL}/payments/${transactionId}`, {
    headers: headers(token),
    timeout: 10000
  });

  return {
    status:       data.status,
    provider_ref: data.transaction_id,
    amount:       data.amount,
    currency:     data.currency,
    message:      data.message
  };
}

module.exports = { collect, disburse, getBalance, getStatus };
