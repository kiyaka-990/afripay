// src/services/mtnMomo.js - MTN Mobile Money API integration
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.MTN_ENV === 'production'
  ? 'https://proxy.momoapi.mtn.com'
  : 'https://sandbox.momodeveloper.mtn.com';

// Separate token caches per product
const tokenCache = { collections: null, disbursements: null };

async function getToken(product) {
  const cached = tokenCache[product];
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const userId  = process.env[`MTN_${product.toUpperCase()}_USER_ID`];
  const apiKey  = process.env[`MTN_${product.toUpperCase()}_API_KEY`];
  const subKey  = process.env[`MTN_${product.toUpperCase()}_SUBSCRIPTION_KEY`];

  const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');

  const { data } = await axios.post(
    `${BASE_URL}/${product}/token/`,
    {},
    {
      headers: {
        Authorization:          `Basic ${auth}`,
        'Ocp-Apim-Subscription-Key': subKey
      }
    }
  );

  tokenCache[product] = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000
  };

  logger.debug(`MTN MoMo ${product} token refreshed`);
  return tokenCache[product].token;
}

// Request payment from customer (Collections)
async function requestPayment({ phone, amount, currency, reference, callbackUrl }) {
  const token      = await getToken('collections');
  const subKey     = process.env.MTN_COLLECTIONS_SUBSCRIPTION_KEY;
  const referenceId = uuidv4();

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount:     String(Math.ceil(amount)),
      currency,
      externalId: reference,
      payer: {
        partyIdType: 'MSISDN',
        partyId:     phone
      },
      payerMessage: reference,
      payeeNote:    reference
    },
    {
      headers: {
        Authorization:               `Bearer ${token}`,
        'X-Reference-Id':            referenceId,
        'X-Target-Environment':      process.env.MTN_ENV === 'production' ? 'mtncameroon' : 'sandbox',
        'Ocp-Apim-Subscription-Key': subKey,
        'X-Callback-Url':            callbackUrl || process.env.MTN_CALLBACK_URL,
        'Content-Type':              'application/json'
      }
    }
  );

  return { provider_ref: referenceId, network: 'mtn_momo' };
}

// Check payment status
async function getPaymentStatus(referenceId) {
  const token  = await getToken('collections');
  const subKey = process.env.MTN_COLLECTIONS_SUBSCRIPTION_KEY;

  const { data } = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization:               `Bearer ${token}`,
        'X-Target-Environment':      process.env.MTN_ENV === 'production' ? 'mtncameroon' : 'sandbox',
        'Ocp-Apim-Subscription-Key': subKey
      }
    }
  );

  const statusMap = { SUCCESSFUL: 'success', FAILED: 'failed', PENDING: 'pending' };
  return {
    status:      statusMap[data.status] || 'pending',
    amount:      data.amount,
    currency:    data.currency,
    payer_phone: data.payer?.partyId,
    reason:      data.reason,
    network:     'mtn_momo'
  };
}

// Disburse — send money to recipient
async function transfer({ phone, amount, currency, reference, note }) {
  const token      = await getToken('disbursements');
  const subKey     = process.env.MTN_DISBURSEMENTS_SUBSCRIPTION_KEY;
  const referenceId = uuidv4();

  await axios.post(
    `${BASE_URL}/disbursement/v1_0/transfer`,
    {
      amount:     String(Math.ceil(amount)),
      currency,
      externalId: reference,
      payee: {
        partyIdType: 'MSISDN',
        partyId:     phone
      },
      payerMessage: note || reference,
      payeeNote:    note || reference
    },
    {
      headers: {
        Authorization:               `Bearer ${token}`,
        'X-Reference-Id':            referenceId,
        'X-Target-Environment':      process.env.MTN_ENV === 'production' ? 'mtncameroon' : 'sandbox',
        'Ocp-Apim-Subscription-Key': subKey,
        'Content-Type':              'application/json'
      }
    }
  );

  return { provider_ref: referenceId, network: 'mtn_momo' };
}

// Account Balance
async function getBalance(currency) {
  const token  = await getToken('collections');
  const subKey = process.env.MTN_COLLECTIONS_SUBSCRIPTION_KEY;

  const { data } = await axios.get(
    `${BASE_URL}/collection/v1_0/account/balance`,
    {
      headers: {
        Authorization:               `Bearer ${token}`,
        'X-Target-Environment':      process.env.MTN_ENV === 'production' ? 'mtncameroon' : 'sandbox',
        'Ocp-Apim-Subscription-Key': subKey
      }
    }
  );

  return { available_balance: data.availableBalance, currency: data.currency, network: 'mtn_momo' };
}

module.exports = { requestPayment, getPaymentStatus, transfer, getBalance };
