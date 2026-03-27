// src/services/airtel.js - Airtel Money API integration
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.AIRTEL_ENV === 'production'
  ? 'https://openapi.airtel.africa'
  : 'https://openapiuat.airtel.africa';

let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const { data } = await axios.post(`${BASE_URL}/auth/oauth2/token`, {
    client_id:     process.env.AIRTEL_CLIENT_ID,
    client_secret: process.env.AIRTEL_CLIENT_SECRET,
    grant_type:    'client_credentials'
  });

  tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000
  };

  logger.debug('Airtel Money token refreshed');
  return tokenCache.token;
}

// USSD Push — request payment from customer
async function ussdPush({ phone, amount, currency, reference, callbackUrl }) {
  const token       = await getToken();
  const referenceId = uuidv4();

  const { data } = await axios.post(
    `${BASE_URL}/merchant/v1/payments/`,
    {
      reference: referenceId,
      subscriber: {
        country:  detectAirtelCountry(phone),
        currency,
        msisdn:   phone
      },
      transaction: {
        amount,
        country:  detectAirtelCountry(phone),
        currency,
        id:       reference
      }
    },
    {
      headers: {
        Authorization:   `Bearer ${token}`,
        'X-Country':     detectAirtelCountry(phone),
        'X-Currency':    currency,
        'Content-Type':  'application/json'
      }
    }
  );

  if (data.status?.response_code !== 'DP00800001001') {
    throw new Error(`Airtel payment request failed: ${data.status?.message}`);
  }

  return {
    provider_ref: data.data?.transaction?.id || referenceId,
    network:      'airtel'
  };
}

// Check transaction status
async function getTransactionStatus(transactionId, country, currency) {
  const token = await getToken();

  const { data } = await axios.get(
    `${BASE_URL}/standard/v1/payments/${transactionId}`,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'X-Country':    country,
        'X-Currency':   currency,
        'Content-Type': 'application/json'
      }
    }
  );

  const code = data.status?.response_code;
  return {
    status:         code === 'DP00800001001' ? 'success' : code === 'DP00800001000' ? 'pending' : 'failed',
    transaction_id: data.data?.transaction?.id,
    amount:         data.data?.transaction?.amount,
    message:        data.status?.message,
    network:        'airtel'
  };
}

// Disburse to mobile number
async function disburse({ phone, amount, currency, reference }) {
  const token       = await getToken();
  const referenceId = uuidv4();
  const country     = detectAirtelCountry(phone);

  const { data } = await axios.post(
    `${BASE_URL}/standard/v1/disbursements/`,
    {
      payee: {
        msisdn: phone,
        wallet_type: 'NORMAL'
      },
      reference: referenceId,
      pin:       process.env.AIRTEL_ENCRYPTED_PIN,
      transaction: {
        amount,
        id:       reference,
        type:     'B2C',
        country,
        currency
      }
    },
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'X-Country':    country,
        'X-Currency':   currency,
        'Content-Type': 'application/json'
      }
    }
  );

  return { provider_ref: referenceId, network: 'airtel' };
}

function detectAirtelCountry(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return 'KE';
  if (digits.startsWith('256')) return 'UG';
  if (digits.startsWith('255')) return 'TZ';
  if (digits.startsWith('233')) return 'GH';
  if (digits.startsWith('234')) return 'NG';
  return 'KE';
}

module.exports = { ussdPush, getTransactionStatus, disburse };
